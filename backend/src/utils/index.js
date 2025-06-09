"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.updateDocumentStatus = updateDocumentStatus;
exports.loadXLSXLocally = loadXLSXLocally;
exports.loadDocumentFromPath = loadDocumentFromPath;
exports.initializeCustomPGVectorStore = initializeCustomPGVectorStore;
exports.processIngestionJob = processIngestionJob;
const textsplitters_1 = require("@langchain/textsplitters");
const supabase_1 = require("../service/supabase");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const XLSX = __importStar(require("xlsx"));
const pdf_1 = require("@langchain/community/document_loaders/fs/pdf");
const docx_1 = require("@langchain/community/document_loaders/fs/docx");
const csv_1 = require("@langchain/community/document_loaders/fs/csv");
const text_1 = require("langchain/document_loaders/fs/text");
const documents_1 = require("@langchain/core/documents");
const pgvector_1 = require("@langchain/community/vectorstores/pgvector");
const crypto_1 = require("crypto");
const openai_1 = require("../service/openai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function updateDocumentStatus(supabase, documentId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        const { error } = yield supabase
            .from("qa_database_documents")
            .update({ status })
            .eq("uuid", documentId);
        if (error)
            throw new Error(`Failed to update status to ${status}: ${error.message}`);
    });
}
function loadXLSXLocally(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const workbook = XLSX.readFile(filePath);
        const docs = [];
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                header: 1,
            });
            const content = jsonData
                .map((row) => row.join(" | "))
                .join("\n");
            docs.push(new documents_1.Document({ pageContent: content, metadata: { sheet: sheetName } }));
        }
        return docs;
    });
}
function loadDocumentFromPath(filePath, ext) {
    return __awaiter(this, void 0, void 0, function* () {
        const loaders = {
            txt: () => new text_1.TextLoader(filePath).load(),
            md: () => new text_1.TextLoader(filePath).load(),
            pdf: () => new pdf_1.PDFLoader(filePath).load(),
            csv: () => new csv_1.CSVLoader(filePath).load(),
            docx: () => new docx_1.DocxLoader(filePath).load(),
            xls: () => loadXLSXLocally(filePath),
        };
        const loader = loaders[ext];
        if (!loader)
            throw new Error(`Unsupported file extension: ${ext}`);
        return loader();
    });
}
function initializeCustomPGVectorStore(name, id, metadata) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield pgvector_1.PGVectorStore.initialize(openai_1.embeddings, {
            postgresConnectionOptions: {
                connectionString: process.env.SUPABASE_DB_URL,
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
    });
}
function processIngestionJob(job) {
    return __awaiter(this, void 0, void 0, function* () {
        const { name, id, metadata } = job.data;
        try {
            yield updateDocumentStatus(supabase_1.supabase, id, "processing");
            // const { data, error } = await supabase
            //   .from("qa_database_documents")
            //   .select("uuid")
            //   .eq("uuid", id)
            //   .single();
            // if (error || !data) {
            //   throw new Error(`Document ${id} not found in qa_database_documents`);
            // }
            const { data: file, error: downloadError } = yield supabase_1.supabase.storage
                .from("files")
                .download(metadata.file_url);
            if (downloadError) {
                throw new Error(`Failed to download file: ${downloadError.message}`);
            }
            const tempFilePath = path_1.default.join(os_1.default.tmpdir(), `${Date.now()}-${metadata.file_url.split("/").pop()}`);
            yield fs_1.promises.writeFile(tempFilePath, Buffer.from(yield file.arrayBuffer()));
            try {
                yield updateDocumentStatus(supabase_1.supabase, id, "splitting");
                const rawDocs = yield loadDocumentFromPath(tempFilePath, metadata.file_type);
                const splitter = new textsplitters_1.RecursiveCharacterTextSplitter({
                    chunkSize: 1000,
                    chunkOverlap: 200,
                });
                const docs = yield splitter.splitDocuments(rawDocs);
                yield updateDocumentStatus(supabase_1.supabase, id, "embedding");
                const newId = (0, crypto_1.randomUUID)();
                console.log("🚀 ~ index.ts:146 ~ newId:", newId);
                const pgVectorStore = yield initializeCustomPGVectorStore(name, newId, metadata);
                yield updateDocumentStatus(supabase_1.supabase, id, "embedding");
                yield pgVectorStore.addDocuments(docs.map((doc) => ({
                    pageContent: doc.pageContent,
                    metadata: Object.assign(Object.assign({}, doc.metadata), { document_id: newId }),
                })));
                yield updateDocumentStatus(supabase_1.supabase, id, "ready");
                // const { error: deleteError } = await supabase
                //   .from("qa_database_documents")
                //   .delete()
                //   .eq("uuid", id);
                // if (deleteError)
                //   throw new Error(`Failed to delete document: ${deleteError.message}`);
                console.log("🚀 ~ index.ts:181 ~ id:", id);
                try {
                    yield supabase_1.supabase
                        .from("qa_database_documents")
                        .update({ status: "ready" })
                        .eq("cmetadata->>id", newId)
                        .select()
                        .single();
                    console.log(`Ingestion ${id} completed`);
                }
                catch (error) {
                    console.log("🚀 ~ index.ts:179 ~ error:", error);
                }
                yield pgVectorStore.end();
            }
            finally {
                yield fs_1.promises.unlink(tempFilePath).catch(() => { });
            }
        }
        catch (err) {
            yield updateDocumentStatus(supabase_1.supabase, id, "failed").catch(() => { });
            throw err;
        }
    });
}
