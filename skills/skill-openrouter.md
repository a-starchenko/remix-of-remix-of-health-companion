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

**Deploy a function:**
```bash
npx supabase functions deploy chat
```

> Changes to `supabase/functions/**` require a manual `deploy` call (or a GitHub Action) — they are never picked up by Vercel automatically.

---

## Extension points

- To add more typed fields (e.g. `sources`, `confidence`), extend the `chatTool.function.parameters.properties` object and add them to `required`.
