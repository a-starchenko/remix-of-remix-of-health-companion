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
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server-side only
```

The `VITE_` prefix makes a variable available in the browser bundle. The service-role key **must never** be prefixed with `VITE_`.

---

## Schema overview

All tables live in the `public` schema. Migrations are the single source of truth — never hand-click schema changes in the dashboard.

| Table | Purpose |
|---|---|
| `profiles` | One row per user; auto-created by `handle_new_user` trigger |
| `user_settings` | Per-user AI preferences |
| `user_roles` | RBAC roles (`admin`, `moderator`, `user`) |
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
At query time, call `match_rag_chunks(query_embedding, match_user_id, match_count)` — a `SECURITY DEFINER` function that runs cosine similarity search:

```sql
SELECT c.id, c.file_id, c.content,
       1 - (c.embedding <=> query_embedding) AS similarity
FROM public.rag_chunks c
WHERE c.user_id = match_user_id AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> query_embedding
LIMIT match_count;
```

The HNSW index on `rag_chunks.embedding` supports up to 2000 dimensions. `gte-small` at 384 dims fits comfortably within this limit.

---

## Storage

Bucket `rag-files` (private). Files are stored at `<user_id>/<filename>`.  
Storage policies allow each user to read, upload, and delete only their own folder:

```sql
USING (bucket_id = 'rag-files' AND auth.uid()::text = (storage.foldername(name))[1])
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
