---
name: Supabase Setup
description: Stand up the Supabase data layer — schema migrations, pgvector RAG tables, RLS policies, storage bucket, and env vars — and how to extend it.
---

# Skill: Supabase Setup

How this project's Supabase data layer is organised, and how to extend it.

---

## Project setup

1. Create a project at <https://supabase.com> and note the **Project URL**, **anon/public key**, **project ID**, and **service-role key**.
2. Fill in `.env` (never commit it):

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

The `VITE_` prefix makes a variable available in the browser bundle.

> This setup does **not** need a service-role key. All Edge Functions act under the caller's JWT (anon client + RLS), so a user can only ever touch their own rows. Only reach for `SUPABASE_SERVICE_ROLE_KEY` (auto-injected into Edge Functions by the Supabase runtime) when you have a deliberate server-side job that must bypass RLS — and never prefix it with `VITE_`.

---

## Schema overview

All tables live in the `public` schema. Migrations are the single source of truth — never hand-click schema changes in the dashboard.

| Table | Purpose |
|---|---|
| `profiles` | One row per user; auto-created by `handle_new_user` trigger |
| `conversations` | Chat sessions (`id`, `user_id`, `title`, `created_at`, `updated_at`) |
| `messages` | Individual chat turns (`id`, `conversation_id`, `user_id`, `role`, `content`, `created_at`) |
| `rag_files` | Uploaded document metadata (equivalent to `kb_documents`) |
| `rag_chunks` | Parsed text chunks + `vector(384)` embeddings for RAG |

---

## Migrations

Migration files live in `supabase/migrations/` and are named `<timestamp>_<slug>.sql`.  
The Supabase CLI is installed as a devDependency — use `npx supabase` (no global install needed).

```bash
npx supabase login
npx supabase link --project-ref <project-id>
npx supabase db push        # apply pending migrations
npx supabase db reset --linked  # wipe and reapply all migrations from scratch
```

To create a new migration:

```bash
npx supabase migration new <slug>
# edit the generated file, then:
npx supabase db push
```

**Editing an existing migration** is only safe if it has **not yet been applied** to any real project. If the migration has already run — create a new one on top of it instead. This rule applied when fixing the embedding model: the `rag_chunks` migration was edited in-place (changing `vector(768)` → `vector(384)`) because the project had not yet been deployed.

---

## Row Level Security

RLS is enabled on **every** table. The standard pattern:

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own <table>" ON public.<table>
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own <table>" ON public.<table>
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own <table>" ON public.<table>
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own <table>" ON public.<table>
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
```

For tables without a direct `user_id` column (e.g. `messages` which joins through `conversations`), add a `user_id` column and populate it on insert so the same pattern applies.

---

## Embeddings (pgvector + RAG)

The `vector` extension is enabled:

```sql
create extension if not exists vector;
```

`rag_chunks.embedding` is `vector(384)`.  
Embeddings are generated via **Supabase AI `gte-small`** (384 dims, built-in, no API key required) inside Edge Functions:

```ts
const model = new Supabase.ai.Session("gte-small");
const embedding = await model.run(text, { mean_pool: true, normalize: true });
```

Chat completions use **OpenRouter** (`OPENROUTER_API_KEY`). Embeddings use Supabase AI. The HNSW index (`vector_cosine_ops`) on `rag_chunks.embedding` enables fast cosine similarity search.

At upload time, call the `ingest-rag-file` Edge Function which splits the document, generates embeddings, and inserts rows.  
At query time, call `match_rag_chunks(query_embedding, match_count)` — a `SECURITY INVOKER` function that derives the owner from `auth.uid()` (not a caller-supplied argument) and runs cosine similarity search under the caller's RLS:

```sql
SELECT c.id, c.file_id, c.content,
       1 - (c.embedding <=> query_embedding) AS similarity
FROM public.rag_chunks c
WHERE c.user_id = auth.uid() AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> query_embedding
LIMIT match_count;
```

Because the owner comes from `auth.uid()`, the Edge Function calls this RPC with the **anon client + the user's JWT** — no service-role key is needed for retrieval.

The HNSW index on `rag_chunks.embedding` supports up to 2000 dimensions. `gte-small` at 384 dims fits comfortably within this limit.

---

## Storage

Bucket `rag-files` (private). Files are stored at `<user_id>/<timestamp>-<sanitised_filename>`.  
Storage policies allow each user to read, upload, and delete only their own folder:

```sql
USING (bucket_id = 'rag-files' AND auth.uid()::text = (storage.foldername(name))[1])
```

**Create the bucket (migration):**
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('rag-files', 'rag-files', false)
ON CONFLICT (id) DO NOTHING;
```

**Per-user path convention:** `<user_id>/<Date.now()>-<sanitised_filename>`  
Sanitise with `.replace(/[^\w.\-]/g, "_")` to keep paths URL-safe.

**Storage policies (four policies on `storage.objects`):**
```sql
-- Read
CREATE POLICY "Users read own rag files storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rag-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Upload
CREATE POLICY "Users upload own rag files storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rag-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Delete
CREATE POLICY "Users delete own rag files storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rag-files' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## Knowledge Base: File Upload Flow

The full upload pipeline has two phases: **client-side** (text extraction + storage upload + DB insert) then **server-side** (chunking + embedding).

### 1 — Accepted file formats and size gate (client)

```ts
const ACCEPTED = ".txt,.md,.csv,.json,.pdf,.docx";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

if (file.size > MAX_BYTES) throw new Error("Max 20MB per file.");
```

### 2 — Text extraction (client, `src/lib/extractText.ts`)

| Format | Method |
|--------|--------|
| `.txt`, `.md`, `.csv`, `.json` | `File.text()` |
| `.docx` | `mammoth.extractRawText({ arrayBuffer })` |
| `.pdf` | `pdfjs-dist` — iterate pages, join `item.str` values |

```ts
import { extractText } from "@/lib/extractText";
const text = await extractText(file); // throws on unsupported type
```

### 3 — Upload to Storage (client)

```ts
const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
const { error } = await supabase.storage
  .from("rag-files")
  .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
```

### 4 — Insert document metadata (client)

```ts
const { data: row } = await supabase
  .from("rag_files")
  .insert({
    user_id: user.id,
    file_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    storage_path: path,
    status: "pending",
  })
  .select()
  .single();
```

### 5 — Chunk + embed (Edge Function `ingest-rag-file`)

Invoke from the client after the DB insert:

```ts
await supabase.functions.invoke("ingest-rag-file", {
  body: { file_id: row.id, text },
});
```

Inside the function:

**Chunking strategy** — fixed-size sliding window with overlap:
```ts
function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
    i += size - overlap;
  }
  return chunks;
}
```

Max 200 chunks per file (`MAX_CHUNKS = 200`).

**Embedding** — Supabase AI `gte-small` (384 dims, no API key):
```ts
const model = new Supabase.ai.Session("gte-small");
const vec = await model.run(chunkText, { mean_pool: true, normalize: true });
```

Each chunk row:
```ts
{ user_id, file_id, chunk_index, content, embedding: Array.from(vec) }
```

On success the edge function sets `rag_files.status = "ready"` and `rag_files.chunk_count = n`.  
On failure it sets `status = "error"` with `error_message`.

### 6 — Delete

```ts
await supabase.storage.from("rag-files").remove([file.storage_path]);
await supabase.from("rag_files").delete().eq("id", file.id);
// rag_chunks rows cascade-delete via FK: rag_chunks.file_id → rag_files.id ON DELETE CASCADE
```

---

## Edge Functions (Deno)

Edge Functions run in the Deno runtime on Supabase — not Node.js. The file `supabase/functions/deno.json` tells Cursor/VS Code to treat these files as Deno code, eliminating false `Deno`/`esm.sh` type errors in the editor. It does not affect runtime behaviour.

---

## TypeScript client

```ts
// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
```

The `Database` type in `src/integrations/supabase/types.ts` is the generated type for all tables and functions. Update it whenever the schema changes:

```bash
npx supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

---

## Adding a new table (checklist)

1. Create a migration file: `npx supabase migration new <slug>`
2. Write `CREATE TABLE`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and all four CRUD policies
3. Add `GRANT SELECT, INSERT, UPDATE, DELETE ON … TO authenticated` + `GRANT ALL ON … TO service_role`
4. Add a `updated_at` trigger if the table has that column
5. If adding a `vector` column, keep dimensions ≤ 2000 to stay within the pgvector HNSW/IVFFlat index limit
6. Add the table's `Row`, `Insert`, `Update`, and `Relationships` types to `src/integrations/supabase/types.ts`
7. Run `npx supabase db push`. If migrations are in a broken state (e.g. partially applied), run `npx supabase db reset --linked` to wipe and reapply from scratch
