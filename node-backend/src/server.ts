import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
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
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Queue, Worker, QueueEvents } from "bullmq";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { randomUUID } from "crypto";

dotenv.config();

interface Metadata {
  file_type: string;
  file_url: string;
  file_size: string;
}

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const redisUrl = new URL(process.env.REDIS_URL!);
const redisConnection = {
  host: redisUrl.hostname || "localhost",
  port: parseInt(redisUrl.port || "6379"),
  password: redisUrl.password || undefined,
};

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 8000;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small",
});

const ingestQueue = new Queue("document-ingestion", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 3,
  },
});

const queueEvents = new QueueEvents("document-ingestion", {
  connection: redisConnection,
});

queueEvents.on("completed", ({ jobId }) => {
  console.log(`Ingestion job ${jobId} completed`);
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`Ingestion job ${jobId} failed: ${failedReason}`);
});

async function updateDocumentStatus(
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

async function loadXLSXLocally(filePath: string): Promise<Document[]> {
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

async function loadDocumentFromPath(
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

async function initializeCustomPGVectorStore(
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

async function processIngestionJob(job: {
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

      await pgVectorStore.addDocuments(
        docs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            document_id: id,
          },
        }))
      );

      // const { error: deleteError } = await supabase
      //   .from("qa_database_documents")
      //   .delete()
      //   .eq("uuid", id);
      // if (deleteError)
      //   throw new Error(`Failed to delete document: ${deleteError.message}`);

      const { data, error } = await supabase
        .from("qa_database_documents")
        .update({ status: "ready" })
        .eq("cmetadata->>id", id)
        .select()
        .single();
      if (error) {
        throw new Error(`Failed to update document: ${error.message}`);
      }
      console.log("error", error);
      console.log(`Ingestion ${id} completed`);
      await pgVectorStore.end();
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  } catch (err: any) {
    await updateDocumentStatus(supabase, id, "failed").catch(() => {});
    throw err;
  }
}

const worker = new Worker("document-ingestion", processIngestionJob, {
  connection: redisConnection,
  concurrency: 1,
});

worker.on("error", (error) => {
  console.error("Worker error:", error.message);
});

app.post("/ingest", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      id,
      metadata,
    }: { name: string; id: string; metadata: Metadata } = req.body;

    if (
      !name ||
      !id ||
      !metadata ||
      !metadata.file_type ||
      !metadata.file_url ||
      !metadata.file_size
    ) {
      throw new Error("Missing required fields: id, metadata");
    }

    await updateDocumentStatus(supabase, id, "queued");
    await ingestQueue.add(
      "ingest",
      {
        name,
        id,
        metadata,
      },
      {
        jobId: id,
      }
    );

    res.json({ message: "Ingestion job queued successfully" });
  } catch (err: any) {
    res
      .status(500)
      .json({ error: `Failed to queue ingestion: ${err.message}` });
  }
});

process.on("SIGTERM", async () => {
  console.log("Shutting down server...");
  await worker.close();
  await ingestQueue.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
