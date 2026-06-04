# Health Companion

An AI-powered health assistant with a personal knowledge base. Users can upload documents (PDF, DOCX, TXT) and chat with an AI that retrieves relevant context from those documents using RAG (Retrieval-Augmented Generation).

Built with Vite + React + TypeScript, Supabase (auth, database, storage, embeddings), and OpenRouter for LLM access.

**Live demo:** [remix-of-remix-of-health-companion.vercel.app](https://remix-of-remix-of-health-companion.vercel.app/chat)

Sign in with the throwaway test account to try it end to end:

- **Email:** `test@email.com`
- **Password:** `password`

---

# Part 1 — How I built it

## Approach

I started from a [Lovable](https://lovable.dev) starter, which gave me the Vite + React + shadcn/ui scaffold and the initial UI surfaces. From there I built the product-specific layers: the Supabase data model, authentication, the RAG ingestion/retrieval pipeline, and the OpenRouter chat function.

I worked **skill-first**: each capability is captured as a reproduction *skill* under [`skills/`](skills/) as I built it. These doubled as my working notes and as runnable playbooks that let the whole setup be reproduced on a fresh project (see *Reproduction skills* below). The backend, security model, and AI integration were all authored and reviewed by me.

## Time spent

I spent roughly **5–6 hours**, in a single session. The two largest chunks were **not** feature breadth — they were the **data layer** and **security/spec alignment + cleanup**. Most of the effort went into getting RLS and RAG scoping right (every table scoped to `auth.uid()`, retrieval via a `SECURITY INVOKER` RPC so no service-role key is needed) and into trimming the starter down to only what the spec required. Building the actual screens was comparatively quick because the Lovable scaffold and shadcn primitives were already in place.

---

# Part 2 — Running it locally

## Stack

- **Frontend**: Vite, React, TypeScript, shadcn/ui, Tailwind CSS
- **Backend**: Supabase (Postgres + pgvector, Auth, Storage, Edge Functions)
- **AI**: OpenRouter → forced tool-calling pattern; embeddings via Supabase `gte-small`

## Prerequisites

- Node.js
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key

## Steps

```sh
# 1. Clone the repo
git clone <YOUR_GIT_URL>
cd remix-of-remix-of-health-companion

# 2. Install dependencies
npm install

# 3. Copy the env template and fill in your values
cp .env.example .env.local

# 4. Start the dev server
npm run dev
```

## Environment variables

Create a `.env.local` file (never commit it). All required variables:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ID |
| `OPENROUTER_API_KEY` | OpenRouter API key — **server-side only, never exposed to browser** |
| `OPENROUTER_MODEL` | Model slug (default: `google/gemma-4-31b-it:free`; must support tool-calling) |

> `VITE_` prefix makes a variable available client-side. Variables **without** `VITE_` are server-side only.

## Project structure

```
src/
  components/   # UI components
  pages/        # Route pages
  hooks/        # React hooks
  integrations/ # Supabase client setup
  lib/          # Shared utilities
supabase/
  migrations/   # SQL migrations — source of truth for the schema
  functions/    # Edge Functions (Deno): chat, ingest-rag-file
skills/         # Reproduction skills (one SKILL.md per skill)
```

## Reproduction skills

Runnable playbooks an AI agent (Codex or Claude) can follow to reproduce this setup on a new project. Each lives in its own folder as a `SKILL.md`:

- [`skills/fork-starter/SKILL.md`](skills/fork-starter/SKILL.md) — remix the Lovable starter and connect GitHub
- [`skills/ground-rules/SKILL.md`](skills/ground-rules/SKILL.md) — project-wide conventions (TypeScript-only, secrets, LLM routing)
- [`skills/supabase-setup/SKILL.md`](skills/supabase-setup/SKILL.md) — schema migrations, RLS, pgvector RAG, storage, env vars
- [`skills/supabase-auth/SKILL.md`](skills/supabase-auth/SKILL.md) — email/password auth for a Vite SPA + route protection
- [`skills/shadcn-ui/SKILL.md`](skills/shadcn-ui/SKILL.md) — design-system seed (components.json, theme tokens, component inventory) reproduced via the shadcn CLI/MCP
- [`skills/openrouter/SKILL.md`](skills/openrouter/SKILL.md) — OpenRouter forced tool-calling, retry/backoff, model swapping
- [`skills/vercel-deploy/SKILL.md`](skills/vercel-deploy/SKILL.md) — push-to-deploy on Vercel with env vars
