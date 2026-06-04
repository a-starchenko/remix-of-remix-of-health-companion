# Health Companion

An AI-powered health assistant with a personal knowledge base. Users can upload documents (PDF, DOCX, TXT) and chat with an AI that retrieves relevant context from those documents using RAG (Retrieval-Augmented Generation).

Built with Vite + React + TypeScript, Supabase (auth, database, storage, embeddings), and OpenRouter for LLM access.

**Live demo:** [remix-of-remix-of-health-companion.vercel.app](https://remix-of-remix-of-health-companion.vercel.app/chat)

Sign in with the throwaway test account to try it end to end:

- **Email:** `test@email.com`
- **Password:** `password`

## Stack

- **Frontend**: Vite, React, TypeScript, shadcn/ui, Tailwind CSS
- **Backend**: Supabase (Postgres + pgvector, Auth, Storage, Edge Functions)
- **AI**: OpenRouter → forced tool-calling pattern; embeddings via Supabase `gte-small`

## Local setup

### Prerequisites

- Node.js
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key

### Steps

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
skills/         # Reproduction skills (one SKILL.md per skill)
```

## Reproduction skills

Runnable playbooks an AI agent (Codex or Claude) can follow to reproduce this setup on a new project. Each lives in its own folder as a `SKILL.md`:

- [`skills/fork-starter/SKILL.md`](skills/fork-starter/SKILL.md) — remix the Lovable starter and connect GitHub
- [`skills/ground-rules/SKILL.md`](skills/ground-rules/SKILL.md) — project-wide conventions (TypeScript-only, secrets, LLM routing)
- [`skills/supabase-setup/SKILL.md`](skills/supabase-setup/SKILL.md) — schema migrations, RLS, pgvector RAG, storage, env vars
- [`skills/supabase-auth/SKILL.md`](skills/supabase-auth/SKILL.md) — email/password auth for a Vite SPA + route protection
- [`skills/openrouter/SKILL.md`](skills/openrouter/SKILL.md) — OpenRouter forced tool-calling, retry/backoff, model swapping
- [`skills/vercel-deploy/SKILL.md`](skills/vercel-deploy/SKILL.md) — push-to-deploy on Vercel with env vars
