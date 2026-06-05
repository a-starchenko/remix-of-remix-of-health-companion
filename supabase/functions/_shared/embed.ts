// @ts-nocheck — Deno runtime; not checked by Node.js TypeScript server
// Shared embedding helper. Both ingest (documents) and chat (query) must use
// this so vectors live in the same space and cosine search is meaningful.

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const EMBED_MODEL = Deno.env.get("OPENROUTER_EMBED_MODEL") ?? "google/gemini-embedding-001";
// pgvector indexes cap at 2000 dims; gemini-embedding-001 defaults to 3072, so
// we always request a smaller.
export const EMBED_DIMENSIONS = Number(Deno.env.get("OPENROUTER_EMBED_DIMENSIONS")) || 1536;

// gemini-embedding-001 only pre-normalizes the full 3072-dim output, so we
// L2-normalize ourselves to keep cosine similarity correct at 1536.
function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

const isRetryable = (status: number) => status === 429 || status >= 500;
const MAX_RETRIES = 3;

async function postEmbeddings(inputs: string[]): Promise<Response> {
  const body = JSON.stringify({
    model: EMBED_MODEL,
    input: inputs,
    dimensions: EMBED_DIMENSIONS,
    encoding_format: "float",
  });
  let attempt = 0;
  while (true) {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (res.ok || !isRetryable(res.status) || attempt >= MAX_RETRIES) return res;
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    attempt++;
  }
}

// Embed a batch of texts. Returns one vector per input, aligned by index
// (null for any input the provider failed to embed).
export async function embedTexts(inputs: string[]): Promise<(number[] | null)[]> {
  if (inputs.length === 0) return [];

  const res = await postEmbeddings(inputs);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Embeddings API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const out: (number[] | null)[] = new Array(inputs.length).fill(null);
  for (const item of data.data ?? []) {
    if (typeof item.index !== "number" || !Array.isArray(item.embedding)) continue;
    if (item.embedding.length !== EMBED_DIMENSIONS) {
      // Provider ignored `dimensions` — fail loud rather than corrupt the index.
      throw new Error(
        `Embedding has ${item.embedding.length} dims, expected ${EMBED_DIMENSIONS}.`,
      );
    }
    out[item.index] = l2normalize(item.embedding as number[]);
  }
  return out;
}

export async function embedOne(text: string): Promise<number[] | null> {
  const [vec] = await embedTexts([text]);
  return vec ?? null;
}
