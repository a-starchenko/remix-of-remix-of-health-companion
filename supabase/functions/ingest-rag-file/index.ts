// @ts-nocheck — Deno runtime; not checked by Node.js TypeScript server
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedTexts } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Server-side guardrails — mirror the client checks
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "csv", "json"]);

const MAX_CHARS_PER_CHUNK = 1200;
const OVERLAP_SENTENCES = 1;
const MAX_CHUNKS = 200;
const EMBED_BATCH = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// Split on sentence-ending punctuation, keeping the punctuation with its sentence.
function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const matches = clean.match(/[^.!?]+[.!?]+(?:["')\]]+)?|.+$/g);
  return (matches ?? [clean]).map((s) => s.trim()).filter(Boolean);
}

function joinedLength(sentences: string[]): number {
  if (sentences.length === 0) return 0;
  return sentences.reduce((a, s) => a + s.length, 0) + (sentences.length - 1);
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (joinedLength([...cur, w]) > MAX_CHARS_PER_CHUNK && cur.length) {
      out.push(cur.join(" "));
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

// Pack whole sentences into chunks bounded by a character budget, with a
// one-sentence overlap between consecutive chunks for context continuity.
function chunkText(text: string): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let cur: string[] = [];

  for (const sentence of sentences) {
    if (chunks.length >= MAX_CHUNKS) break;

    if (sentence.length > MAX_CHARS_PER_CHUNK) {
      if (cur.length) {
        chunks.push(cur.join(" "));
        cur = [];
      }
      for (const piece of splitLongSentence(sentence)) {
        if (chunks.length >= MAX_CHUNKS) break;
        chunks.push(piece);
      }
      continue;
    }

    if (joinedLength([...cur, sentence]) > MAX_CHARS_PER_CHUNK && cur.length) {
      chunks.push(cur.join(" "));
      cur = cur.slice(-OVERLAP_SENTENCES);
    }
    cur.push(sentence);
  }
  if (cur.length && chunks.length < MAX_CHUNKS) chunks.push(cur.join(" "));

  return chunks.slice(0, MAX_CHUNKS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { file_id, text } = await req.json();
    if (!file_id || typeof text !== "string") {
      return json({ error: "file_id and text required" }, 400);
    }

    // RLS-enforced: a user can only ever touch their own rows.
    const { data: file, error: fileErr } = await supabase
      .from("rag_files")
      .select("id, user_id, file_name, size_bytes")
      .eq("id", file_id)
      .single();
    if (fileErr || !file || file.user_id !== user.id) return json({ error: "File not found" }, 404);

    const ext = fileExtension(file.file_name ?? "");
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      await supabase.from("rag_files").update({ status: "error", error_message: `Unsupported file type: .${ext || "?"}` }).eq("id", file_id);
      return json({ error: "Unsupported file type" }, 415);
    }
    if (typeof file.size_bytes === "number" && file.size_bytes > MAX_FILE_BYTES) {
      await supabase.from("rag_files").update({ status: "error", error_message: "File exceeds 20MB limit" }).eq("id", file_id);
      return json({ error: "File too large (max 20MB)" }, 413);
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await supabase.from("rag_files").update({ status: "error", error_message: "No text extracted" }).eq("id", file_id);
      return json({ error: "No text extracted from file" }, 400);
    }

    // Embed all chunks via OpenRouter, batched (network I/O, not CPU).
    const embeddings: (number[] | null)[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = await embedTexts(chunks.slice(i, i + EMBED_BATCH));
      embeddings.push(...batch);
    }

    const rows = chunks
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
      return json({ error: "Embedding failed" }, 500);
    }

    await supabase.from("rag_chunks").delete().eq("file_id", file_id);
    const { error: insErr } = await supabase.from("rag_chunks").insert(rows);
    if (insErr) {
      await supabase.from("rag_files").update({ status: "error", error_message: insErr.message }).eq("id", file_id);
      return json({ error: insErr.message }, 500);
    }

    await supabase.from("rag_files").update({ status: "ready", chunk_count: rows.length, error_message: null }).eq("id", file_id);
    return json({ ok: true, chunks: rows.length });
  } catch (e) {
    console.error("ingest error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
