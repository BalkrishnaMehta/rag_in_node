import { OpenAIEmbeddings } from "@langchain/openai";

export const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small",
});
