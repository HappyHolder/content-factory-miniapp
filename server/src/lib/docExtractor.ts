// docExtractor — pulls plain text out of an uploaded project document so the
// content-manager assistant/planner can reason over it. PDF via pdf-parse, DOCX
// via mammoth, Markdown/plain-text as-is. No embeddings — the extracted text is
// truncated + chunked straight into prompts (see docs/content-manager-plan.md).

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

// Hard cap on stored text. ~200k chars ≈ 50k tokens — plenty for a whitepaper,
// bounded so one huge upload can't blow the DB row or a downstream prompt.
export const MAX_DOC_TEXT_CHARS = 200_000;

export type DocKind = 'pdf' | 'docx' | 'markdown' | 'text';

export interface ExtractedDoc {
  kind: DocKind;
  text: string;      // normalized, capped at MAX_DOC_TEXT_CHARS
  truncated: boolean; // true if the source exceeded the cap
}

/** Maps a mime type + filename to a supported DocKind, or null if unsupported. */
export function classifyDoc(mime: string, name: string): DocKind | null {
  const lowerName = name.toLowerCase();
  const m = (mime || '').toLowerCase();

  if (m === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) return 'docx';
  if (m === 'text/markdown' || m === 'text/x-markdown' || lowerName.endsWith('.md') || lowerName.endsWith('.markdown'))
    return 'markdown';
  // Treat any remaining text/* (or .txt) as plain text.
  if (m.startsWith('text/') || lowerName.endsWith('.txt')) return 'text';

  return null;
}

/** Collapses excessive whitespace and trims. Keeps paragraph breaks. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')     // trailing spaces on a line
    .replace(/\n{3,}/g, '\n\n')      // collapse blank-line runs
    .replace(/[ \t]{2,}/g, ' ')      // runs of spaces/tabs
    .trim();
}

/**
 * Extracts plain text from an uploaded document buffer.
 * @throws Error with a user-facing message on unsupported type or parse failure.
 */
export async function extractDocText(
  buffer: Buffer,
  mime: string,
  name: string,
): Promise<ExtractedDoc> {
  const kind = classifyDoc(mime, name);
  if (!kind) {
    throw new Error('Unsupported file type. Use PDF, DOCX, Markdown or TXT.');
  }

  let raw: string;
  try {
    if (kind === 'pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const parsed = await parser.getText();
        raw = parsed.text ?? '';
      } finally {
        await parser.destroy();
      }
    } else if (kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      raw = result.value ?? '';
    } else {
      // markdown / text — decode as UTF-8
      raw = buffer.toString('utf-8');
    }
  } catch (err) {
    throw new Error(
      `Failed to read the document: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  const normalized = normalizeText(raw);
  if (!normalized) {
    throw new Error('No readable text found in the document.');
  }

  const truncated = normalized.length > MAX_DOC_TEXT_CHARS;
  return {
    kind,
    text: truncated ? normalized.slice(0, MAX_DOC_TEXT_CHARS) : normalized,
    truncated,
  };
}
