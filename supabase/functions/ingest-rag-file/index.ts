// @ts-nocheck — Deno runtime; not checked by Node.js TypeScript server
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const embedModel = new Supabase.ai.Session("gte-small");

function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
    i += size - overlap;
  }
  return chunks;
}

async function embedBatch(inputs: string[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = [];
  for (const input of inputs) {
    try {
      const result = await embedModel.run(input, { mean_pool: true, normalize: true });
      out.push(Array.from(result as number[]));
    } catch (e) {
      console.error("embed err", e);
      out.push(null);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { file_id, text } = await req.json();
    if (!file_id || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "file_id and text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // All DB work runs through the RLS-enforced anon client (caller's JWT),
    // so a user can only ever ingest into their own rows.
    const { data: file, error: fileErr } = await supabase
      .from("rag_files")
      .select("id, user_id")
      .eq("id", file_id)
      .single();
    if (fileErr || !file || file.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await supabase.from("rag_files").update({ status: "error", error_message: "No text extracted" }).eq("id", file_id);
      return new Response(JSON.stringify({ error: "No text extracted from file" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const MAX_CHUNKS = 200;
    const trimmed = chunks.slice(0, MAX_CHUNKS);
    const embeddings = await embedBatch(trimmed);

    const rows = trimmed
      .map((content, idx) => ({
        user_id: user.id,
        file_id,
        chunk_index: idx,
        content,
        embedding: embeddings[idx] as any,
      }))
      .filter((r) => r.embedding);

    if (rows.length === 0) {
      await supabase.from("rag_files").update({ status: "error", error_message: "Embedding failed" }).eq("id", file_id);
      return new Response(JSON.stringify({ error: "Embedding failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("rag_chunks").delete().eq("file_id", file_id);
    const { error: insErr } = await supabase.from("rag_chunks").insert(rows);
    if (insErr) {
      console.error("insert err", insErr);
      await supabase.from("rag_files").update({ status: "error", error_message: insErr.message }).eq("id", file_id);
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabase.from("rag_files").update({ status: "ready", chunk_count: rows.length, error_message: null }).eq("id", file_id);

    return new Response(JSON.stringify({ ok: true, chunks: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ingest error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
