export interface Metadata {
  file_type: string;
  file_url: string;
  file_size: string;
}

export const REQUIRED_ENV_VARS = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_URL",
];
