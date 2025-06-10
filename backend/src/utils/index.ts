import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { supabase } from "../service/supabase";
import { Metadata } from "../types";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as XLSX from "xlsx";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { Document } from "@langchain/core/documents";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { embeddings } from "../service/openai";

import dotenv from "dotenv";
dotenv.config();
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET!;

export async function updateDocumentStatus(
  supabase: any,
  documentId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("qa_database_documents")
    .update({ status })
    .eq("uuid", documentId);
  if (error)
    throw new Error(`Failed to update status to ${status}: ${error.message}`);
}

export async function loadXLSXLocally(filePath: string): Promise<Document[]> {
  const workbook = XLSX.readFile(filePath);
  const docs: Document[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
    }) as unknown[][];

    const headers = jsonData[0] as string[];
    const content = jsonData
      .map((row, index) =>
        index === 0 ? (row as any[]).join(" | ") : (row as any[]).join(" | ")
      )
      .join("\n");

    docs.push(
      new Document({
        pageContent: content,
        metadata: {
          sheet: sheetName,
          rowCount: jsonData.length - 1,
          headers: headers.join(", "),
        },
      })
    );
  }

  return docs;
}

export async function loadDocumentFromPath(
  filePath: string,
  ext: string
): Promise<Document[]> {
  const loaders: { [key: string]: () => Promise<Document[]> } = {
    txt: () => new TextLoader(filePath).load(),
    md: () => new TextLoader(filePath).load(),
    pdf: () => new PDFLoader(filePath).load(),
    csv: () => new CSVLoader(filePath).load(),
    docx: () => new DocxLoader(filePath).load(),
    xls: () => loadXLSXLocally(filePath),
    xlsx: () => loadXLSXLocally(filePath),
  };

  const loader = loaders[ext.toLowerCase()];
  if (!loader) throw new Error(`Unsupported file extension: ${ext}`);
  return loader();
}

export async function initializeCustomPGVectorStore(
  name: string,
  id: string,
  metadata: Metadata
) {
  return await PGVectorStore.initialize(embeddings, {
    postgresConnectionOptions: {
      connectionString: process.env.SUPABASE_DB_URL!,
      ssl: { rejectUnauthorized: false },
    },
    tableName: "qa_database_chunks",
    collectionTableName: "qa_database_documents",
    collectionName: name,
    collectionMetadata: {
      id,
      file_type: metadata.file_type,
      file_url: metadata.file_url,
      file_size: metadata.file_size,
    },
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "content",
      metadataColumnName: "cmetadata",
    },
  });
}

export async function processIngestionJob(job: {
  data: { name: string; id: string; metadata: Metadata };
}): Promise<void> {
  const { name, id, metadata } = job.data;

  try {
    await updateDocumentStatus(supabase, id, "processing");

    const { data: file, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(metadata.file_url);
    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    const tempFilePath = path.join(
      os.tmpdir(),
      `${Date.now()}-${metadata.file_url.split("/").pop()}`
    );
    await fs.writeFile(tempFilePath, Buffer.from(await file.arrayBuffer()));

    try {
      const rawDocs = await loadDocumentFromPath(
        tempFilePath,
        metadata.file_type
      );

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const docs = await splitter.splitDocuments(rawDocs);

      const pgVectorStore = await initializeCustomPGVectorStore(
        name,
        id,
        metadata
      );

      await pgVectorStore.addDocuments(
        docs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            document_id: id,
          },
        }))
      );
      await updateDocumentStatus(supabase, id, "ready");

      await pgVectorStore.end();
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  } catch (err: any) {
    await updateDocumentStatus(supabase, id, "failed").catch(() => {});
    throw err;
  }
}
