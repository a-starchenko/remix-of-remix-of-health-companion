-- Staged ingestion inserts chunks with a null embedding first, then fills the
-- embeddings in later batches. That UPDATE runs through the caller's JWT, so RLS
-- needs an explicit update policy (the original migration only had select/insert/delete).
CREATE POLICY "Users update own rag chunks" ON public.rag_chunks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
