"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddings = void 0;
const openai_1 = require("@langchain/openai");
exports.embeddings = new openai_1.OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-small",
});
