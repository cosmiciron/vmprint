import {
  KEEP_WITH_NEXT_PATTERN,
  parseMarkdownAst as parseMarkdownAstCore,
  type MdNode,
  type MdPosition
} from '@vmprint/markdown-core';
import { Draft2FinalError } from './errors';

export type { MdNode, MdPosition };
export { KEEP_WITH_NEXT_PATTERN };

export function parseMarkdownAst(markdown: string, inputPath: string, options?: { allowFootnotes?: boolean }): MdNode {
  void options;
  try {
    return parseMarkdownAstCore(markdown);
  } catch (error: unknown) {
    if (error instanceof Draft2FinalError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Draft2FinalError('parse', inputPath, `Failed to parse Markdown: ${message}`, 3, { cause: error });
  }
}
