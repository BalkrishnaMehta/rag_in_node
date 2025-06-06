import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as XLSX from "xlsx";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// Load environment variables
dotenv.config();

// Validate environment variables
const REQUIRED_ENV_VARS = [
  "SUPABASE_DB_URL",
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 8000;

// Initialize services
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small",
});

const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
});

const promptTemplate = ChatPromptTemplate.fromTemplate(`
You are an assistant for question-answering tasks. 
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you don't know. 
Use three sentences maximum and keep the answer concise.

Question: {question}
Context: {context}

Answer:
`);

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

app.post("/ingest", async (req: Request, res: Response): Promise<void> => {
  const { id, file_url, file_type } = req.body;

  try {
    if (!id || !file_url || !file_type) {
      throw new Error("Missing required fields: id, file_url, file_type");
    }

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
      res.json({ message: "Ingested successfully", chunks: docs.length });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  } catch (err: any) {
    await updateDocumentStatus(supabase, id, "failed").catch(() => {});
    res.status(500).json({ error: `Ingestion failed: ${err.message}` });
  }
});

// app.post("/generate", async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { question } = req.body;
//     if (!question || typeof question !== "string") {
//       res.status(400).json({ error: "Invalid or missing question" });
//       return;
//     }

//     const vectorStore = await PGVectorStore.initialize(embeddings, {
//       postgresConnectionOptions: {
//         connectionString: process.env.SUPABASE_DB_URL!,
//         ssl: { rejectUnauthorized: false },
//       },
//       tableName: "chunks",
//       columns: {
//         idColumnName: "id",
//         vectorColumnName: "embedding",
//         contentColumnName: "content",
//       },
//     });

//     const retrievedDocs = await vectorStore.similaritySearch(question);
//     if (!retrievedDocs || retrievedDocs.length === 0) {
//       res.status(404).json({ error: "No relevant documents found" });
//       return;
//     }

//     const docsContent = retrievedDocs.map((doc) => doc.pageContent).join("\n");
//     const messages = await promptTemplate.invoke({
//       question,
//       context: docsContent,
//     });
//     const response = await llm.invoke(messages);

//     res.json({
//       answer: response.content,
//       question,
//       contextCount: retrievedDocs.length,
//     });
//   } catch (err: any) {
//     console.error("Generate failed:", err);
//     res
//       .status(500)
//       .json({ error: `Failed to generate answer: ${err.message}` });
//   }
// });

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
