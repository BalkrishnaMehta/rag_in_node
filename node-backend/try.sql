
CREATE TYPE status AS ENUM (
    'queued',
    'processing',
    'splitting',
    'embedding',
    'indexing',
    'ready',
    'failed'
  );
ALTER TABLE qa_database_documents
ADD COLUMN status status NOT NULL DEFAULT 'queued';


CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.qa_database_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT qa_database_chunks_pkey PRIMARY KEY (id),
  CONSTRAINT qa_database_chunks_document_id_fkey
    FOREIGN KEY (document_id)
    REFERENCES public.qa_database_documents(id)
    ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX qa_database_chunks_embedding_idx
ON public.qa_database_chunks
USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding VECTOR(1536),
  match_count INTEGER,
  match_threshold FLOAT,
  filter JSONB
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.qa_database_chunks c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
