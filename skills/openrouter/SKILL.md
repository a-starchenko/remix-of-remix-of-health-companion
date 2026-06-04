---
name: OpenRouter Forced Tool-Calling
description: Call any LLM through OpenRouter with forced tool-calling for typed output, retry/backoff on 429/5xx, a single swappable model config, and RAG context injection.
---

# Skill: OpenRouter — forced tool-calling, retry/backoff, model swapping

Shared reference for every edge function that calls OpenRouter in this project.

---

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | Supabase dashboard → Edge Functions → Secrets | API key — **never sent to the browser** |
| `OPENROUTER_MODEL` | Supabase dashboard → Edge Functions → Secrets | Active model; defaults to `google/gemma-4-31b-it:free` |

**How to set secrets in Supabase:**
Supabase Dashboard → **Edge Functions** → **Secrets** → Add secret.

To swap the model without a code deploy, update `OPENROUTER_MODEL` in the Supabase dashboard and re-invoke the function.

---

## Forced tool-calling pattern

OpenRouter is called with **exactly one tool** (`answer`) and `tool_choice` set to force its use.
This guarantees typed output — the model cannot return free text.

```typescript
const chatTool = {
  type: "function" as const,
  function: {
    name: "answer",
    description: "Answer the user's health question.",
    parameters: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "The answer in Markdown. Use tables when they help.",
        },
      },
      required: ["reply"],
    },
  },
};

// In the fetch body:
{
  model: CHAT_MODEL,
  messages: [...],
  tools: [chatTool],
  tool_choice: { type: "function", function: { name: "answer" } },
}
```

**Reading the result** — always parse `tool_calls[0].function.arguments`, never free text:

```typescript
const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
const args = JSON.parse(toolCall.function.arguments);
const reply: string = args.reply; // always Markdown
```

Do **not** use `response_format` / structured output — this project uses forced tool-calling exclusively.

---

## Retry / backoff helper

Retries on transient errors (429 rate-limit, 502/503/529 gateway errors) with exponential backoff.
Respects the `retry-after` response header when present.

```typescript
const RETRYABLE = new Set([429, 502, 503, 529]);
const BASE_DELAY_MS = 1_000;
const MAX_RETRIES = 4;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.ok || !RETRYABLE.has(res.status) || attempt >= MAX_RETRIES) {
      return res;
    }
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
    const waitMs = isFinite(retryAfterSec)
      ? retryAfterSec * 1_000
      : BASE_DELAY_MS * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
}
```

---

## Request / response shape

**Input** (POST body):
```json
{
  "messages": [{ "role": "user", "content": "What foods are high in iron?" }],
  "question": "What foods are high in iron?"
}
```

`question` is optional — if omitted, the last `user` message is used as the RAG query.

**Output**:
```json
{
  "reply": "## Foods High in Iron\n\n| Food | Iron (mg per 100g) |\n|...",
  "usedContext": false
}
```

`reply` is always Markdown — render it with a Markdown renderer (e.g. `react-markdown` + `remark-gfm`).

---

## Model selection guide

| Model slug | Notes |
|---|---|
| `google/gemma-4-31b-it:free` | Default. Free tier, 256K context, native tool_choice support |
| `mistralai/mistral-7b-instruct:free` | Fallback free option |
| `openai/gpt-5-mini` | Paid; flagship GPT-5 Mini, reliable tool calling, 1M context |
| `anthropic/claude-sonnet-4-6` | Paid; latest Sonnet, strong on coding and agents |

Change via `OPENROUTER_MODEL` env var — no code change required.

---

## Deploying edge functions

Edge functions live on Supabase — Vercel knows nothing about them. `git push` only updates the frontend.

**First time — login to Supabase CLI:**
```bash
npx supabase login
```
Відкриється браузер для підтвердження.

**Deploy a single function:**
```bash
npx supabase functions deploy chat
```

**Deploy all functions at once** (recommended after adding a new one):
```bash
npx supabase functions deploy
```

**List deployed functions** (verify nothing is missing):
```bash
npx supabase functions list
```

> Changes to `supabase/functions/**` require a manual `deploy` call (or a GitHub Action) — they are never picked up by Vercel automatically.

> **Common gotcha:** "Failed to send a request to the Edge Function" with no Supabase logs means the function was never deployed — the request never reaches the server. Run `npx supabase functions list` to check, then `npx supabase functions deploy <name>`.

---

## RAG pattern — grounding answers in uploaded documents

The chat edge function injects relevant user-document excerpts into the system prompt before the OpenRouter call. The pipeline:

### Why `gte-small` instead of a separate embeddings API

`gte-small` (384-dim) runs inside Supabase Edge Runtime via `Supabase.ai.Session` — no external API key, no extra latency hop, no cost. It is the same model used at upload time, so query and document vectors live in the same embedding space.

### Embedding the question

```typescript
const embedModel = new Supabase.ai.Session("gte-small");

async function embed(text: string): Promise<number[] | null> {
  try {
    const result = await embedModel.run(text, { mean_pool: true, normalize: true });
    return Array.from(result as number[]);
  } catch (e) {
    console.error("embed failed", e);
    return null;
  }
}
```

Both `mean_pool: true` and `normalize: true` are required so the vectors are comparable via cosine similarity.

### Cosine similarity search with pgvector

The `match_rag_chunks` SQL function (defined in `supabase/migrations/`) is called via RPC. It uses the `<=>` operator (cosine distance) with an HNSW index for fast approximate nearest-neighbour lookup:

```sql
SELECT c.id, c.file_id, c.content,
       1 - (c.embedding <=> query_embedding) AS similarity
FROM public.rag_chunks c
WHERE c.user_id = auth.uid() AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> query_embedding
LIMIT match_count;
```

Security: the function is `SECURITY INVOKER` and derives the owner from `auth.uid()` (not a caller-supplied argument), so the caller's RLS on `rag_chunks` applies and users can never see each other's chunks. This is why the edge function can call it with the **anon client + the user's JWT** — no service-role key needed.

### Retrieving context in the edge function

```typescript
// `client` is the RLS-enforced anon client built from the caller's JWT —
// retrieval is scoped to auth.uid() by the SECURITY INVOKER RPC, so no
// service-role key is involved.
async function retrieveContext(
  client: SupabaseClient,
  question: string
): Promise<string> {
  if (!question) return "";
  const qvec = await embed(question.slice(0, 4000)); // truncate to stay within model input limit
  if (!qvec) return "";
  const { data: matches, error } = await client.rpc("match_rag_chunks", {
    query_embedding: qvec as any,
    match_count: 6,
  });
  if (error || !matches?.length) return "";
  return matches
    .map((m: any, i: number) => `[Source ${i + 1}]\n${m.content}`)
    .join("\n\n---\n\n");
}
```

Returns `""` when the user has no documents — the system prompt simply omits the context block and the assistant falls back to general knowledge.

### Context injection into the system prompt

```typescript
const context = await retrieveContext(supabase, effectiveQuestion);

const systemPrompt = [
  "You are a helpful AI health assistant.",
  "Always call the `answer` tool with a well-formatted Markdown reply.",
  context
    ? [
        "",
        "The user has uploaded a personal knowledge base.",
        "Use the following retrieved excerpts to ground your answer when relevant.",
        "If the answer is not in the context, say so and answer from general knowledge.",
        "",
        "=== KNOWLEDGE BASE CONTEXT ===",
        context,
        "=== END CONTEXT ===",
      ].join("\n")
    : "",
]
  .filter(Boolean)
  .join("\n");
```

The response includes `usedContext: boolean` so the frontend can show a "grounded in your documents" indicator.

---

## Extension points

- To add more typed fields (e.g. `sources`, `confidence`), extend the `chatTool.function.parameters.properties` object and add them to `required`.
- To surface source citations, return `matches` array (with `file_id` / chunk index) alongside `reply` and look up the filename from `rag_files`.
- To tune retrieval quality: increase `match_count` (more context, higher token cost) or add a similarity threshold (`WHERE 1 - (c.embedding <=> query_embedding) > 0.7`).
