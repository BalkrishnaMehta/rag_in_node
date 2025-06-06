// import { createClient } from "@supabase/supabase-js";
// import { streamText } from "ai";
// import { createOpenAI } from "@ai-sdk/openai";
// import { OpenAIEmbeddings } from "@langchain/openai";
// import { codeBlock } from "common-tags";

// const corsHeaders = {
//   "Access-Control-Allow-Origin": "*",
//   "Access-Control-Allow-Headers":
//     "authorization, x-client-info, apikey, content-type",
//   "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
// };

// interface Message {
//   role: "user" | "assistant";
//   content: string;
// }

// const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
// const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

// Deno.serve(async (req: Request) => {
//   // Handle CORS preflight
//   if (req.method === "OPTIONS") {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   // Validate request method
//   if (req.method !== "POST") {
//     return new Response(JSON.stringify({ error: "Method not allowed" }), {
//       status: 405,
//       headers: { ...corsHeaders, "Content-Type": "application/json" },
//     });
//   }

//   // Validate environment variables
//   if (!supabaseUrl || !supabaseAnonKey || !openaiApiKey) {
//     return new Response(
//       JSON.stringify({ error: "Missing environment variables" }),
//       {
//         status: 500,
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//       }
//     );
//   }

//   try {
//     // Validate authorization
//     const authorization = req.headers.get("Authorization");
//     if (!authorization) {
//       return new Response(JSON.stringify({ error: "Missing authorization" }), {
//         status: 401,
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//       });
//     }

//     // Parse and validate request body
//     const { input, messages = [] } = await req.json();
//     if (!input || typeof input !== "string") {
//       return new Response(
//         JSON.stringify({ error: "Invalid or missing input" }),
//         {
//           status: 400,
//           headers: { ...corsHeaders, "Content-Type": "application/json" },
//         }
//       );
//     }
//     if (
//       !Array.isArray(messages) ||
//       !messages.every(
//         (msg: Message) =>
//           msg &&
//           typeof msg === "object" &&
//           ["user", "assistant"].includes(msg.role) &&
//           typeof msg.content === "string"
//       )
//     ) {
//       return new Response(
//         JSON.stringify({ error: "Invalid messages format" }),
//         {
//           status: 400,
//           headers: { ...corsHeaders, "Content-Type": "application/json" },
//         }
//       );
//     }

//     // Initialize clients
//     const supabase = createClient(supabaseUrl, supabaseAnonKey, {
//       global: { headers: { authorization } },
//       auth: { persistSession: false },
//     });

//     // Generate embedding
//     const embeddings = new OpenAIEmbeddings({
//       apiKey: openaiApiKey,
//       model: "text-embedding-3-small",
//     });
//     const embedding = await embeddings.embedQuery(input);

//     // Perform vector search
//     const { data: documents, error: matchError } = await supabase.rpc(
//       "match_chunks",
//       {
//         query_embedding: embedding,
//         match_count: 5,
//         match_threshold: 0.5,
//         filter: {},
//       }
//     );

//     if (matchError) {
//       console.error("Vector search failed:", matchError);
//       return new Response(
//         JSON.stringify({
//           error: "Vector search failed",
//           details: matchError.message,
//         }),
//         {
//           status: 500,
//           headers: { ...corsHeaders, "Content-Type": "application/json" },
//         }
//       );
//     }

//     // Prepare context and messages
//     const context = documents?.length
//       ? documents
//           .map((doc: { content: string }) => doc.content || "")
//           .join("\n\n")
//       : "No documents found";

//   } catch (error) {
//     console.error("Error in chat function:", error);
//     return new Response(
//       JSON.stringify({
//         error: "Internal server error",
//         details: (error as Error).message,
//       }),
//       {
//         status: 500,
//         headers: { ...corsHeaders, "Content-Type": "application/json" },
//       }
//     );
//   }
// });
