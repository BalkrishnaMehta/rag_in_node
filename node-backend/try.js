import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  "https://rvwenhwxdyintdjxywxn.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2d2VuaHd4ZHlpbnRkanh5d3huIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTAzOTQ4NCwiZXhwIjoyMDY0NjE1NDg0fQ.57NH6fh-K3xmPLDN5yhagxBK-dhT8_Oced_IRCSjWqE"
);

export async function getDocumentByMetadataId1() {
  const { data, error } = await supabase
    .from("qa_database_documents")
    .update({ status: "ready" })
    .eq("cmetadata->>id", "1e5e1158-2098-44bd-aa30-f340f5965244")
    .select()
    .single();
  if (error) throw error;
  console.log(data);
  return data;
}

getDocumentByMetadataId1();
