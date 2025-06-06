import express, { Request, Response } from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { Pool } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import { Annotation } from "@langchain/langgraph";

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 8000;
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Validate environment variables
if (!process.env.SUPABASE_DB_URL || !process.env.OPENAI_API_KEY) {
  throw new Error("Missing SUPABASE_DB_URL or OPENAI_API_KEY");
}

// Initialize vector store
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-large",
});

let vectorStore: PGVectorStore;

const initializeVectorStore = async () => {
  vectorStore = await PGVectorStore.initialize(embeddings, {
    postgresConnectionOptions: {
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    },
    tableName: "documents",
    columns: {
      idColumnName: "id",
      vectorColumnName: "embedding",
      contentColumnName: "content",
    },
  });
};

// Test Supabase connection on startup
const testDatabaseConnection = async (): Promise<void> => {
  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query("SELECT NOW()");
  } catch (err: any) {
    throw new Error(`Database connection failed: ${err.message}`);
  } finally {
    await pool.end();
  }
};

// Define state annotations
const InputStateAnnotation = Annotation.Root({
  question: Annotation<string>,
});

const StateAnnotation = Annotation.Root({
  question: Annotation<string>,
  context: Annotation<Document[]>,
  answer: Annotation<string>,
});

// Initialize prompt template and LLM
const promptTemplate = ChatPromptTemplate.fromTemplate(`
  You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise.

  Question: {question}

  Context: {context}

  Answer:
`);

const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o-mini",
});

// Define RAG steps
const retrieve = async (state: typeof InputStateAnnotation.State) => {
  const retrievedDocs = await vectorStore.similaritySearch(state.question);
  return { context: retrievedDocs };
};

const generate = async (state: typeof StateAnnotation.State) => {
  const docsContent = state.context.map((doc) => doc.pageContent).join("\n");
  const messages = await promptTemplate.invoke({
    question: state.question,
    context: docsContent,
  });
  const response = await llm.invoke(messages);
  return { answer: response.content };
};

// Start server
testDatabaseConnection()
  .then(async () => {
    await initializeVectorStore();

    // Ingest endpoint
    app.post(
      "/ingest",
      upload.single("file"),
      async (req: Request, res: Response): Promise<void> => {
        try {
          const file = req.file;
          if (!file) {
            res.status(400).json({ error: "No file uploaded" });
            return;
          }

          const { mimetype, originalname, buffer } = file;

          // Validate file type
          const supportedMimeTypes = [
            "application/pdf",
            "text/plain",
            "text/markdown",
          ];
          if (!supportedMimeTypes.includes(mimetype)) {
            res.status(400).json({ error: "Unsupported file type" });
            return;
          }

          // Create temporary file
          const tempFilePath = path.join(
            os.tmpdir(),
            `${Date.now()}-${originalname}`
          );
          await fs.writeFile(tempFilePath, buffer);

          try {
            // Load file
            const loader =
              mimetype === "application/pdf"
                ? new PDFLoader(tempFilePath)
                : new TextLoader(tempFilePath);
            const rawDocs = await loader.load();

            // Split documents
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize: 1000,
              chunkOverlap: 200,
            });
            const docs = await splitter.splitDocuments(rawDocs);

            // Add documents to vector store
            await vectorStore.addDocuments(docs);

            res.json({
              message: "File ingested successfully",
              chunks: docs.length,
              filename: originalname,
            });
          } finally {
            // Cleanup
            await fs.unlink(tempFilePath).catch(() => {});
          }
        } catch (err: any) {
          res
            .status(500)
            .json({ error: `Failed to process file: ${err.message}` });
        }
      }
    );

    // Generate endpoint
    app.post(
      "/generate",
      async (req: Request, res: Response): Promise<void> => {
        try {
          const { question } = req.body;
          if (!question || typeof question !== "string") {
            res.status(400).json({ error: "Invalid or missing question" });
            return;
          }

          // Step 1: Retrieve
          const retrieveResult = await retrieve({ question });
          if (!retrieveResult.context || retrieveResult.context.length === 0) {
            res.status(404).json({ error: "No relevant documents found" });
            return;
          }

          // Step 2: Generate
          const generateResult = await generate({
            question,
            context: retrieveResult.context,
            answer: "",
          });

          res.json({
            answer: generateResult.answer,
            question,
            contextCount: retrieveResult.context.length,
          });
        } catch (err: any) {
          res
            .status(500)
            .json({ error: `Failed to generate answer: ${err.message}` });
        }
      }
    );

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
