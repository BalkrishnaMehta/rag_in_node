import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { supabase } from "./service/supabase";
import { Metadata, REQUIRED_ENV_VARS } from "./types";
import { updateDocumentStatus } from "./utils";
import { ingestQueue, worker } from "./queue/ingestion-worker";

dotenv.config();

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 8000;

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
