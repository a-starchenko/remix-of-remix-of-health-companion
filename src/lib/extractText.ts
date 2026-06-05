// Client-side text extraction for RAG ingestion
// Supports: txt, md, pdf, docx

import mammoth from "mammoth";

// Single source of truth for what the Knowledge Base accepts. Mirrors the
// server-side guardrails in supabase/functions/ingest-rag-file/index.ts.
export const SUPPORTED_EXTENSIONS = ["txt", "md", "csv", "json", "pdf", "docx"] as const;

export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

export function isSupportedFile(file: File): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(getExtension(file.name));
}

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;

  // Reject anything outside the allow-list
  if (!isSupportedFile(file)) {
    const ext = getExtension(file.name);
    throw new Error(
      `Unsupported file type${ext ? `: .${ext}` : ""}. Allowed: ${SUPPORTED_EXTENSIONS.map((e) => "." + e).join(", ")}.`,
    );
  }

  if (
    type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  ) {
    return await file.text();
  }

  if (name.endsWith(".docx") || type.includes("officedocument.wordprocessingml")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  }

  if (name.endsWith(".pdf") || type === "application/pdf") {
    // Lazy load pdfjs to keep initial bundle smaller
    const pdfjs: any = await import("pdfjs-dist");
    // Use the bundled worker
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = (worker as any).default;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it: any) => it.str).join(" ");
      pages.push(text);
    }
    return pages.join("\n\n");
  }

  if (name.endsWith(".pptx")) {
    throw new Error("PPTX files are not yet supported. Please convert to PDF or DOCX.");
  }

  // Fallback: try reading as text
  try {
    return await file.text();
  } catch {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
}
