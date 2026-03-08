import { remark } from 'remark';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export type MdPosition = {
  start?: { line: number; column: number };
  end?: { line: number; column: number };
};

export type MdNode = {
  type: string;
  children?: MdNode[];
  value?: string;
  lang?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  spread?: boolean;
  url?: string;
  alt?: string;
  title?: string;
  checked?: boolean | null;
  identifier?: string;
  referenceType?: string;
  align?: Array<'left' | 'right' | 'center' | null>;
  label?: string;
  position?: MdPosition;
};

export const KEEP_WITH_NEXT_PATTERN = /^\s*<!--\s*keep-with-next\s*-->\s*$/i;

export function parseMarkdownAst(markdown: string): MdNode {
  const processor = remark().use(remarkParse).use(remarkGfm);
  return processor.parse(markdown) as unknown as MdNode;
}
