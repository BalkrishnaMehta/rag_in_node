"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.worker = exports.ingestQueue = void 0;
const bullmq_1 = require("bullmq");
const utils_1 = require("../utils");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const redisUrl = new URL(process.env.REDIS_URL);
const redisConnection = {
    host: redisUrl.hostname || "localhost",
    port: parseInt(redisUrl.port || "6379"),
    password: redisUrl.password || undefined,
};
exports.ingestQueue = new bullmq_1.Queue("document-ingestion", {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
    },
});
const queueEvents = new bullmq_1.QueueEvents("document-ingestion", {
    connection: redisConnection,
});
queueEvents.on("completed", ({ jobId }) => {
    console.log(`Ingestion job ${jobId} completed`);
});
queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(`Ingestion job ${jobId} failed: ${failedReason}`);
});
exports.worker = new bullmq_1.Worker("document-ingestion", utils_1.processIngestionJob, {
    connection: redisConnection,
    concurrency: 1,
});
exports.worker.on("error", (error) => {
    console.error("Worker error:", error.message);
});
