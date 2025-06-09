"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Button } from "../ui/button";
import { useState } from "react";

export default function File() {
  const [ingestResult, setIngestResult] = useState<{
    message: string;
    chunks: number;
    filename: string;
  } | null>(null);
  const [loading, setLoading] = useState<"ingest" | "generate" | null>(null);
  const [error, setError] = useState<string>("");
  const supabase = createClientComponentClient();

  const handleUpload = async () => {
    console.log("uploading file");
    setLoading("ingest");
    setError("");
    setIngestResult(null);

    try {
      const { data, error } = await supabase
        .from("qa_database_documents")
        .insert({
          name: Math.random().toString(36).substring(2, 15),
          cmetadata: {
            file_size: "10mb",
            // file_url: "ac25f419-6909-46ec-ba51-fb0522926f56/sample.pdf",
            // file_url: "2fa8df31-6e0b-46a0-bcb0-3ddc369a2223/1.pdf",
            file_url: "2fa8df31-6e0b-46a0-bcb0-3ddc369a2223/resume.pdf",
            file_type: "pdf",
          },
        })
        .select("*")
        .single();

      if (error) {
        throw new Error(`Insert failed: ${error.message}`);
      }

      console.log("Inserted row ID:", data.uuid);

      const response = await fetch("http://localhost:8000/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          id: data.uuid,
          metadata: data.cmetadata,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const data2 = await response.json();
      setIngestResult(data2);
    } catch (err: any) {
      setError(err.message || "Error uploading file");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="max-w-6xl m-4 sm:m-10 flex flex-col gap-8 grow items-stretch">
      <div className="h-40 flex justify-center items-center border-b pb-8 gap-4">
        <div className="mb-6">
          <div className="flex items-center space-x-4">
            <Button
              onClick={handleUpload}
              disabled={loading === "ingest"}
              className={`px-4 py-2 rounded-md text-white font-medium transition-colors ${
                loading === "ingest"
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {loading === "ingest" ? "Uploading..." : "Upload"}
            </Button>
          </div>
          {ingestResult && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md text-green-800">
              <p>
                {ingestResult.message}: {ingestResult.filename} (
                {ingestResult.chunks} chunks)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
