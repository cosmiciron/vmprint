import {
  transmuteMarkdown,
  type DocumentInput,
  type Element,
  type ElementStyle,
  type DocumentLayout,
  type ResolvedImage
} from '@vmprint/markdown-core';
import type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export type { DocumentInput, Element, ElementStyle, DocumentLayout, ResolvedImage };
export type { Transmuter, TransmuterOptions } from '@vmprint/contracts';

export type MarkdownTransmuteOptions = TransmuterOptions & {
  resolveImage?: (src: string) => ResolvedImage | null;
};

export function transmute(markdown: string, options?: MarkdownTransmuteOptions): DocumentInput {
  return transmuteMarkdown(markdown, options);
}

export type MarkdownTransmuter = Transmuter<string, DocumentInput, MarkdownTransmuteOptions>;

export const transmuter: MarkdownTransmuter = {
  transmute
};
