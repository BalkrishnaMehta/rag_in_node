"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Button } from "../ui/button";

const getDocuments = async () => {
  const supabase = createClientComponentClient();
  const { data, error } = await supabase
    .from("qa_database_documents")
    .select("*");
  if (error) {
    throw new Error(`Insert failed: ${error.message}`);
  }
  return data;
};

export default function List() {
  const [documents, setDocuments] = useState<any[]>([]);
  useEffect(() => {
    const fetchDocuments = async () => {
      const data = await getDocuments();
      if (data) {
        setDocuments(data);
      }
    };
    fetchDocuments();
  }, []);

  const handleRetry = async (document: any) => {
    try {
      const response = await fetch("http://localhost:8000/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: document.name,
          id: document.uuid,
          metadata: document.metadata,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${errorText}`);
      }

      const data = await response.json();
      console.log(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    // Todo: Add a table with the documents using shadcn/ui/table
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            {/* <TableHead>ID</TableHead> */}
            <TableHead>Name</TableHead>
            <TableHead>File Size</TableHead>
            <TableHead>File Type</TableHead>
            <TableHead>File URL</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.uuid}>
              <TableCell>{document.name}</TableCell>
              <TableCell>{document.metadata.file_size}</TableCell>
              <TableCell>{document.metadata.file_type}</TableCell>
              <TableCell>{document.metadata.file_url}</TableCell>
              <TableCell>{document.status}</TableCell>
              <TableCell>
                <Button variant="outline" onClick={() => handleRetry(document)}>
                  Retry
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
