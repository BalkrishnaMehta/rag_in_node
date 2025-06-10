"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Button } from "../ui/button";
import { useState } from "react";
import { Input } from "../ui/input";
import { toast } from "sonner";

export default function File() {
  const [ingestResult, setIngestResult] = useState<{
    message: string;
    chunks: number;
    filename: string;
  } | null>(null);
  const [loading, setLoading] = useState<"ingest" | "generate" | null>(null);
  const [error, setError] = useState<string>("");
  const supabase = createClientComponentClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");

  const handleUpload = async (selectedFile: File) => {
    try {
      // Step 1: Log in the user
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: "21amtics434@gmail.com",
          password: "Qwer@1234",
        });

      if (authError) {
        toast.error("Authentication failed: " + authError.message);
        return;
      }

      // Step 2: Get the session token
      const accessToken = authData.session.access_token;

      // Step 3: Generate file path and upload file with Authorization header
      const filePath = `${crypto.randomUUID()}/${selectedFile.name}`;

      const { data: file, error: uploadError } = await supabase.storage
        .from("files")
        .upload(filePath, selectedFile, {
          headers: { Authorization: `Bearer ${accessToken}` }, // Include session token
        });

      console.log("file", file);

      if (uploadError) {
        toast.error(
          "There was an error uploading the file: " + uploadError.message
        );
        return;
      }

      console.log("uploading file");
      setLoading("ingest");
      setError("");
      setIngestResult(null);

      const { data, error } = await supabase
        .from("qa_database_documents")
        .insert({
          name: Math.random().toString(36).substring(2, 15),
          metadata: {
            file_size: selectedFile.size,
            file_url: file.path,
            file_type: selectedFile.name.split(".").pop()?.toLowerCase(),
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
          metadata: data.metadata,
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
          <div className="h-40 flex justify-center items-center border-b pb-8 gap-4">
            <Input
              type="file"
              name="file"
              className="cursor-pointer w-full max-w-xs"
              onChange={async (e) => {
                const selectedFile = e.target.files?.[0];

                if (!selectedFile) return;
                setSelectedFile(selectedFile);
              }}
            />
            <Button
              onClick={() => handleUpload(selectedFile!)}
              className="disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!selectedFile}>
              Upload
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
