-- Harden match_rag_chunks: derive the owner from auth.uid() instead of a
-- caller-supplied match_user_id, and run as SECURITY INVOKER so the caller's
-- RLS on rag_chunks applies. This removes the need for a service-role client
-- when retrieving RAG context for the authenticated user.

DROP FUNCTION IF EXISTS public.match_rag_chunks(vector, uuid, int);

CREATE OR REPLACE FUNCTION public.match_rag_chunks(
  query_embedding vector(384),
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
