// @ts-nocheck — Deno runtime; not checked by Node.js TypeScript server
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHAT_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "google/gemma-4-31b-it:free";

// ---------------------------------------------------------------------------
// Tool definition — forced tool-calling pattern (Issue 05)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Retry / backoff helper
// ---------------------------------------------------------------------------
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
    console.warn(`OpenRouter ${res.status} — retry ${attempt + 1}/${MAX_RETRIES} in ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
}

// ---------------------------------------------------------------------------
// RAG context retrieval — embed question → pgvector cosine search → inject
// ---------------------------------------------------------------------------
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

async function retrieveContext(userId: string, question: string): Promise<string> {
  if (!question) return "";
  const qvec = await embed(question.slice(0, 4000));
  if (!qvec) return "";
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: matches, error } = await admin.rpc("match_rag_chunks", {
    query_embedding: qvec as any,
    match_user_id: userId,
    match_count: 6,
  });
  if (error) {
    console.error("match_rag_chunks error", error);
    return "";
  }
  if (!matches?.length) return "";
  return matches
    .map((m: any, i: number) => `[Source ${i + 1}]\n${m.content}`)
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { messages, question } = body as {
      messages: { role: string; content: string }[];
      question?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages required" }, 400);
    }

    // Derive question from last user message when not explicitly provided
    const effectiveQuestion =
      question ??
      ([...messages].reverse().find((m) => m.role === "user")?.content ?? "");

    const context = await retrieveContext(user.id, effectiveQuestion);

    const systemPrompt = [
      "You are a helpful AI health assistant.",
      "Always call the `answer` tool with a well-formatted Markdown reply.",
      "Use tables (GitHub-flavored markdown) when the data is tabular.",
      "Use headings, lists, bold, and code blocks where appropriate.",
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

    const openrouterRes = await fetchWithRetry(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          tools: [chatTool],
          tool_choice: { type: "function", function: { name: "answer" } },
        }),
      }
    );

    if (!openrouterRes.ok) {
      const text = await openrouterRes.text();
      console.error("OpenRouter error", openrouterRes.status, text);
      if (openrouterRes.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "AI request failed" }, 500);
    }

    const data = await openrouterRes.json();

    // Extract reply from forced tool call
    let reply = "";
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        reply = args.reply ?? "";
      } catch {
        console.error("Failed to parse tool arguments", toolCall.function.arguments);
      }
    }

    // Fallback to free-text content if the model ignored tool_choice
    if (!reply) {
      reply = data.choices?.[0]?.message?.content ?? "";
      console.warn("tool_choice not honoured — fell back to free-text content");
    }

    return json({ reply, usedContext: !!context });
  } catch (e) {
    console.error("chat error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
