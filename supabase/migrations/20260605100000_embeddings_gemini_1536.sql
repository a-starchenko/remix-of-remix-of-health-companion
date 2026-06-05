-- Switch embeddings from Supabase gte-small (384-dim) to OpenRouter
-- google/gemini-embedding-001 at 1536 dims. The old vectors live in a different
-- space and are incompatible, so existing chunks are cleared and users are asked
-- to re-upload. 1536 keeps us under pgvector's 2000-dim index limit.

-- Old 384-dim vectors can't be reinterpreted as 1536 — drop them.
TRUNCATE TABLE public.rag_chunks;

-- The HNSW index pins the column dimension, so drop it before retyping.
DROP INDEX IF EXISTS public.rag_chunks_embedding_idx;

ALTER TABLE public.rag_chunks
  ALTER COLUMN embedding TYPE vector(1536);

CREATE INDEX rag_chunks_embedding_idx
  ON public.rag_chunks USING hnsw (embedding vector_cosine_ops);

-- Recreate the matcher with the new dimension (same auth.uid()/INVOKER semantics).
DROP FUNCTION IF EXISTS public.match_rag_chunks(vector, int);

CREATE OR REPLACE FUNCTION public.match_rag_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  file_id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.id, c.file_id, c.content,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.rag_chunks c
  WHERE c.user_id = auth.uid() AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_rag_chunks(vector, int) TO authenticated;

-- Flag previously-ingested files so the UI prompts a re-upload under the new model.
UPDATE public.rag_files
  SET status = 'error',
      error_message = 'Knowledge base was re-indexed to a new embedding model — please delete and re-upload this file.',
      chunk_count = 0
  WHERE status <> 'error';
