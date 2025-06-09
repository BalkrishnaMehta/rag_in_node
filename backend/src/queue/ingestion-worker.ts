import { Queue, Worker, QueueEvents } from "bullmq";
import { processIngestionJob } from "../utils";
import dotenv from "dotenv";
dotenv.config();

const redisUrl = new URL(process.env.REDIS_URL!);
const redisConnection = {
  host: redisUrl.hostname || "localhost",
  port: parseInt(redisUrl.port || "6379"),
  password: redisUrl.password || undefined,
};

export const ingestQueue = new Queue("document-ingestion", {
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
export const worker = new Worker("document-ingestion", processIngestionJob, {
  connection: redisConnection,
  concurrency: 1,
});

worker.on("error", (error) => {
  console.error("Worker error:", error.message);
});
