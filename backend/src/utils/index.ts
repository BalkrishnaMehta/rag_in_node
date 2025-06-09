import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { supabase } from "../service/supabase";
import { Metadata } from "../types";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as XLSX from "xlsx";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { Document } from "@langchain/core/documents";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { randomUUID } from "crypto";
import { embeddings } from "../service/openai";

import dotenv from "dotenv";
dotenv.config();

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
    }) as unknown[][];
    const content = jsonData
      .map((row) => (row as any[]).join(" | "))
      .join("\n");
    docs.push(
      new Document({ pageContent: content, metadata: { sheet: sheetName } })
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
  };

  const loader = loaders[ext];
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

    // const { data, error } = await supabase
    //   .from("qa_database_documents")
    //   .select("uuid")
    //   .eq("uuid", id)
    //   .single();
    // if (error || !data) {
    //   throw new Error(`Document ${id} not found in qa_database_documents`);
    // }

    const { data: file, error: downloadError } = await supabase.storage
      .from("files")
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
      await updateDocumentStatus(supabase, id, "splitting");
      const rawDocs = await loadDocumentFromPath(
        tempFilePath,
        metadata.file_type
      );

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const docs = await splitter.splitDocuments(rawDocs);

      await updateDocumentStatus(supabase, id, "embedding");
      const pgVectorStore = await initializeCustomPGVectorStore(
        name,
        id,
        metadata
      );
      await updateDocumentStatus(supabase, id, "embedding");

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

      // const { error: deleteError } = await supabase
      //   .from("qa_database_documents")
      //   .delete()
      //   .eq("uuid", id);
      // if (deleteError)
      //   throw new Error(`Failed to delete document: ${deleteError.message}`);
      console.log("🚀 ~ index.ts:181 ~ id:", id);
      //   try {
      //     await supabase
      //       .from("qa_database_documents")
      //       .update({ status: "ready" })
      //       .eq("cmetadata->>id", id)
      //       .select()
      //       .single();
      //     console.log(`Ingestion ${id} completed`);
      //   } catch (error) {
      //     console.log("🚀 ~ index.ts:179 ~ error:", error);
      //   }
      await pgVectorStore.end();
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  } catch (err: any) {
    await updateDocumentStatus(supabase, id, "failed").catch(() => {});
    throw err;
  }
}
