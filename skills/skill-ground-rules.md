# Skill: Ground Rules

Project-wide conventions every contributor and AI agent must follow.

## Language

- **TypeScript only** — no `.js` files in `src/`, no Python. Strict mode on.
- All new files must be `.ts` or `.tsx`.
- Scripts, tooling, and any automation in this repo are also TypeScript (run via `tsx` or `bun`) — not Python.

## Secret management

- Variables prefixed `VITE_` are bundled into the client — **only put public keys there** (Supabase anon key, project URL).
- `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are **server-side only**. They must never appear in any `VITE_` variable or be imported in a file that runs in the browser.
- Never commit `.env` or `.env.local`. Use `.env.example` with empty values as the template.

## LLM routing

- All LLM calls go through **OpenRouter** — no direct calls to OpenAI, Anthropic, or Google APIs.
- The model is controlled by the `OPENROUTER_MODEL` env var. Default: `google/gemma-4-31b-it:free`.
- Use **forced tool-calling** to get typed output — define one `answer` tool and set `tool_choice` to force it. Never parse free text from the model.

## Forced tool-calling pattern

```typescript
const chatTool = {
  type: "function" as const,
  function: {
    name: "answer",
    description: "Answer the user's health question.",
    parameters: {
      type: "object",
      properties: {
        reply: { type: "string", description: "Markdown answer." },
      },
      required: ["reply"],
    },
  },
};

// In the request:
tool_choice: { type: "function", function: { name: "answer" } }

// Read result from:
response.choices[0].message.tool_calls[0].function.arguments
```

## API routes

- Server-side routes live in `src/pages/api/` (Vite + vite-plugin-api) or Supabase Edge Functions.
- Routes that call OpenRouter or use the service-role key must be server-side only.

## Supabase

- Schema is managed via migration files in `supabase/migrations/` — never hand-click the dashboard.
- RLS must be enabled on every table, policies scoped to `auth.uid() = user_id`.
- Embeddings use Supabase AI `gte-small` (built-in, no extra API key).

## No secrets in repo

Before every commit:
1. Check `git diff --staged` for any API key patterns.
2. Ensure `.env` and `.env.local` are in `.gitignore`.
