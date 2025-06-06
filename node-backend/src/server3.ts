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

dotenv.config();

const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
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
    .eq("id", documentId);
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

async function processIngestionJob(job: any): Promise<void> {
  const { id, file_url, file_type } = job.data;

  try {
    await updateDocumentStatus(supabase, id, "processing");
    const { data: file, error: downloadError } = await supabase.storage
      .from("files")
      .download(file_url);

    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    const tempFilePath = path.join(
      os.tmpdir(),
      `${Date.now()}-${file_url.split("/").pop()}`
    );
    await fs.writeFile(tempFilePath, Buffer.from(await file.arrayBuffer()));

    try {
      await updateDocumentStatus(supabase, id, "splitting");
      const rawDocs = await loadDocumentFromPath(tempFilePath, file_type);

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const docs = await splitter.splitDocuments(rawDocs);

      await updateDocumentStatus(supabase, id, "embedding");
      const vectors = await embeddings.embedDocuments(
        docs.map((d) => d.pageContent)
      );

      await updateDocumentStatus(supabase, id, "indexing");
      for (let i = 0; i < docs.length; i++) {
        const { error: insertError } = await supabase
          .from("qa_database_chunks")
          .insert({
            document_id: id,
            content: docs[i].pageContent,
            embedding: vectors[i],
          });
        if (insertError)
          throw new Error(`Failed to insert chunk: ${insertError.message}`);
      }

      await updateDocumentStatus(supabase, id, "ready");
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  } catch (err: any) {
    await updateDocumentStatus(supabase, id, "failed").catch(() => {});
    throw err;
  }
}

// Initialize worker to process ingestion jobs sequentially
const worker = new Worker("document-ingestion", processIngestionJob, {
  connection: redisConnection,
  concurrency: 1, // Process one job at a time to prevent server overload
});

worker.on("error", (error) => {
  console.error("Worker error:", error.message);
});

app.post("/ingest", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, file_url, file_type } = req.body;

    if (!id || !file_url || !file_type) {
      throw new Error("Missing required fields: id, file_url, file_type");
    }

    // Add job to queue with document ID as unique identifier
    await ingestQueue.add(
      "ingest",
      { id, file_url, file_type },
      {
        jobId: id, // Prevents duplicate jobs for the same document ID
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
