import type { DocumentInput, Element } from '@vmprint/markdown-core';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function replaceToken(text: string, token: string, value: string): string {
  return text.split(token).join(value);
}

function collectCoverFields(elements: Element[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const element of elements) {
    const props = asRecord(element.properties);
    if (element.type === 'cover-line') {
      const key = asString(props._coverKey, '');
      const value = asString(props._coverValue, '');
      if (key) out[key] = value;
    }
    const coverFields = props._coverFields;
    if (coverFields && typeof coverFields === 'object' && !Array.isArray(coverFields)) {
      for (const [key, value] of Object.entries(coverFields as Record<string, unknown>)) {
        if (typeof value === 'string' && key && value) out[key] = value;
      }
    }
  }
  return out;
}

/**
 * Derives the surname from an author string following Chinese naming conventions:
 * - If the first character is a CJK ideograph, that character is the surname.
 * - Otherwise falls back to the last whitespace-separated word (Western convention).
 */
function deriveSurname(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return '作者';
  const firstChar = [...trimmed][0];
  if (firstChar) {
    const code = firstChar.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df);   // CJK Extension B
    if (isCjk) return firstChar;
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

function deriveShortTitle(elements: Element[]): string {
  const title = elements.find((element) => element.type === 'cover-title' || element.type === 'chapter-heading');
  const raw = typeof title?.content === 'string' && title.content.trim().length > 0
    ? title.content.trim()
    : (title?.children || []).map((child) => child.content || '').join('').trim();
  if (!raw) return '无题';
  // Chinese characters are wider visually; keep short title within 20 characters.
  return raw.length <= 20 ? raw : `${raw.slice(0, 18)}…`;
}

const UNSUPPORTED_FOOTNOTE_MODES = ['end-of-page'];

export function validateZhManuscriptCompliance(
  ir: DocumentInput,
  config: Record<string, unknown>
): void {
  const manuscript = asRecord(config.manuscript);

  if (asBool(manuscript.strict, false)) {
    const footnotesCfg = asRecord(manuscript.footnotes);
    const footnoteMode = asString(footnotesCfg.mode, '');
    if (footnoteMode && UNSUPPORTED_FOOTNOTE_MODES.includes(footnoteMode)) {
      throw new Error(
        `稿件严格模式：注释模式 "${footnoteMode}" 不受支持。支持的模式：endnotes（尾注）。`
      );
    }

    const coverPageCfg = asRecord(manuscript.coverPage);
    const requireFields = Array.isArray(coverPageCfg.requireFields) ? coverPageCfg.requireFields as string[] : [];
    if (requireFields.length > 0) {
      const coverFields = collectCoverFields(ir.elements || []);
      const missing = requireFields.filter((f) => !coverFields[f]);
      if (missing.length > 0) {
        throw new Error(`稿件封面缺少必填字段：${missing.join('、')}`);
      }
    }
  }

  const coverFields = collectCoverFields(ir.elements || []);

  const runningHeader = asRecord(manuscript.runningHeader);
  if (asBool(runningHeader.enabled, true)) {
    // Default: just book title + page number, right-aligned — matches Chinese book convention.
    // {author}, {surname}, {shortTitle}, and {n} are all supported as tokens.
    const format = asString(runningHeader.format, '{shortTitle}\u3000{n}');
    const author = coverFields.author || coverFields['byline-derived'] || '作者';
    const surname = deriveSurname(author);
    const shortTitle = deriveShortTitle(ir.elements || []);
    ir.layout.pageNumberStart = 1;
    ir.header = {
      firstPage: null,
      default: {
        elements: [{
          type: 'paragraph',
          content: replaceToken(
            replaceToken(
              replaceToken(
                replaceToken(format, '{author}', author),
                '{surname}', surname
              ),
              '{shortTitle}', shortTitle
            ),
            '{n}',
            '{pageNumber}'
          ),
          properties: {
            style: {
              textAlign: 'right',
              fontSize: 9,
              marginTop: 40
            }
          }
        }]
      }
    };
  }
}
