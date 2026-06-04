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

const CHAT_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "google/gemma-3-27b-it:free";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // RAG: embed last user message and retrieve top chunks
    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
    let context = "";
    if (lastUser?.content) {
      const qvec = await embed(String(lastUser.content).slice(0, 4000));
      if (qvec) {
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: matches, error } = await admin.rpc("match_rag_chunks", {
          query_embedding: qvec as any,
          match_user_id: user.id,
          match_count: 6,
        });
        if (error) console.error("match error", error);
        if (matches && matches.length) {
          context = matches
            .map((m: any, i: number) => `[Source ${i + 1}]\n${m.content}`)
            .join("\n\n---\n\n");
        }
      }
    }

    const systemPrompt = `You are a helpful AI assistant. Always respond in well-formatted Markdown. Use tables (GitHub-flavored markdown) whenever the data is tabular. Use headings, lists, bold, and code blocks where appropriate.${
      context
        ? `\n\nThe user has uploaded a personal knowledge base. Use the following retrieved excerpts to ground your answer when relevant. If the answer is not in the context, say so and answer from general knowledge.\n\n=== KNOWLEDGE BASE CONTEXT ===\n${context}\n=== END CONTEXT ===`
        : ""
    }`;

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("AI error", r.status, text);
      if (r.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (r.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI request failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ reply, usedContext: !!context }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
