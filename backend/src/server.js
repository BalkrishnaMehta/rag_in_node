"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_1 = require("./service/supabase");
const types_1 = require("./types");
const utils_1 = require("./utils");
const ingestion_worker_1 = require("./queue/ingestion-worker");
dotenv_1.default.config();
for (const key of types_1.REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
        throw new Error(`Missing environment variable: ${key}`);
    }
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const port = process.env.PORT || 8000;
app.post("/ingest", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, id, metadata, } = req.body;
        if (!name ||
            !id ||
            !metadata ||
            !metadata.file_type ||
            !metadata.file_url ||
            !metadata.file_size) {
            throw new Error("Missing required fields: id, metadata");
        }
        yield (0, utils_1.updateDocumentStatus)(supabase_1.supabase, id, "queued");
        yield ingestion_worker_1.ingestQueue.add("ingest", {
            name,
            id,
            metadata,
        }, {
            jobId: id,
        });
        res.json({ message: "Ingestion job queued successfully" });
    }
    catch (err) {
        res
            .status(500)
            .json({ error: `Failed to queue ingestion: ${err.message}` });
    }
}));
process.on("SIGTERM", () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Shutting down server...");
    yield ingestion_worker_1.worker.close();
    yield ingestion_worker_1.ingestQueue.close();
    process.exit(0);
}));
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
