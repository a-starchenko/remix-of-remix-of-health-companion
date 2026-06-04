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

// Server-side guardrails — mirror the client checks so a direct API call can't
// bypass them (spec §3.1: ".pdf .docx .txt .md .csv .json, ≤ 20 MB each").
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "csv", "json"]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

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
      .select("id, user_id, file_name, size_bytes")
      .eq("id", file_id)
      .single();
    if (fileErr || !file || file.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Enforce size and type server-side (client checks are not authoritative).
    const ext = fileExtension(file.file_name ?? "");
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      await supabase.from("rag_files").update({ status: "error", error_message: `Unsupported file type: .${ext || "?"}` }).eq("id", file_id);
      return new Response(JSON.stringify({ error: "Unsupported file type" }), { status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (typeof file.size_bytes === "number" && file.size_bytes > MAX_FILE_BYTES) {
      await supabase.from("rag_files").update({ status: "error", error_message: "File exceeds 20MB limit" }).eq("id", file_id);
      return new Response(JSON.stringify({ error: "File too large (max 20MB)" }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
