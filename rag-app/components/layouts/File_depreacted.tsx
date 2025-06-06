"use client";

import { Button } from "../ui/button";
import { toast } from "sonner";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useEffect, useState } from "react";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { Dashboard } from "@uppy/react";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";

export default function File() {
  const supabase = createClientComponentClient();
  const [uppy, setUppy] = useState<Uppy | null>(null);
  const [userSession, setUserSession] = useState<string | null>(null);
  const STORAGE_BUCKET = "files"; // Replace with your actual bucket name

  // Initialize Supabase authentication and get session token
  useEffect(() => {
    async function initializeAuth() {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: "21amtics434@gmail.com",
          password: "Qwer@1234",
        });

        if (error) {
          toast.error("Authentication failed: " + error.message);
          return;
        }

        setUserSession(data.session.access_token);
      } catch (err: any) {
        toast.error("Unexpected error during authentication: " + err.message);
      }
    }

    initializeAuth();
  }, [supabase]);

  // Initialize Uppy with TUS plugin
  useEffect(() => {
    if (!userSession) return;

    const uppyInstance = new Uppy({
      autoProceed: false,
      allowMultipleUploads: true,
    })
      .use(Tus, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        headers: {
          authorization: `Bearer ${userSession}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        },
        chunkSize: 6 * 1024 * 1024, // Required: 6MB chunk size for Supabase
        allowedMetaFields: [
          "bucketName",
          "objectName",
          "contentType",
          "cacheControl",
        ],
        uploadDataDuringCreation: true,
        onError: (error) => {
          toast.error("Upload failed: " + error.message);
          console.error("TUS Error:", error);
        },
        onSuccess: () => {
          toast.success("File uploaded successfully!");
        },
      })
      .on("file-added", (file) => {
        const supabaseMetadata = {
          bucketName: STORAGE_BUCKET,
          objectName: `${crypto.randomUUID()}/${file.name}`,
          contentType: file.type, 
          cacheControl: "3600",
        };
        file.meta = { ...file.meta, ...supabaseMetadata };
        console.log("File added with metadata:", file);
      });

    setUppy(uppyInstance);

    return () => {
      uppyInstance.clear();
    };
  }, [userSession]);

  return (
    <div className="max-w-6xl m-4 sm:m-10 flex flex-col gap-8 grow items-stretch">
      <div className="h-40 flex justify-center items-center border-b py-8 gap-4">
        {uppy && (
          <>
            <Dashboard
              uppy={uppy}
              height={300}
              width={600}
              proudlyDisplayPoweredByUppy={false}
              showProgressDetails
              note="Select a file to upload to Supabase"
            />
          </>
        )}
      </div>
    </div>
  );
}

// "use client";

// import { Input } from "../ui/input";
// import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
// import { toast } from "sonner";
// import { Button } from "../ui/button";
// import { useEffect, useState } from "react";

// export default function File() {
//   const supabase = createClientComponentClient();
//   const [selectedFile, setSelectedFile] = useState<File | null>(null);

//   async function uploadFile(selectedFile: File) {
//     try {
//       // Step 1: Log in the user
//       const { data, error: authError } = await supabase.auth.signInWithPassword(
//         {
//           email: "21amtics434@gmail.com",
//           password: "Qwer@1234",
//         }
//       );

//       if (authError) {
//         toast.error("Authentication failed: " + authError.message);
//         return;
//       }

//       // Step 2: Get the session token
//       const accessToken = data.session.access_token;

//       // Step 3: Generate file path and upload file with Authorization header
//       const filePath = `${crypto.randomUUID()}/${selectedFile.name}`;

//       const { error: uploadError } = await supabase.storage
//         .from("files")
//         .upload(filePath, selectedFile, {
//           headers: { Authorization: `Bearer ${accessToken}` }, // Include session token
//         });

//       if (uploadError) {
//         toast.error(
//           "There was an error uploading the file: " + uploadError.message
//         );
//         return;
//       }

//       toast.success("File uploaded successfully!");
//       console.log("Uploaded to:", filePath);
//     } catch (err: any) {
//       toast.error("Unexpected error: " + err.message);
//     }
//   }
//   return (
//     <div className="max-w-6xl m-4 sm:m-10 flex flex-col gap-8 grow items-stretch">
//       <div className="h-40 flex justify-center items-center border-b pb-8 gap-4">
//         <Input
//           type="file"
//           name="file"
//           className="cursor-pointer w-full max-w-xs"
//           onChange={async (e) => {
//             const selectedFile = e.target.files?.[0];

//             if (!selectedFile) return;
//             setSelectedFile(selectedFile);
//           }}
//         />
//         <Button
//           onClick={() => uploadFile(selectedFile!)}
//           className="disabled:opacity-50 disabled:cursor-not-allowed"
//           disabled={!selectedFile}>
//           Upload
//         </Button>
//       </div>
//     </div>
//   );
// }
