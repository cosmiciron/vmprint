import {
  normalizeToSemantic as normalizeToSemanticCore,
  type SemanticDocument,
  type SemanticNode,
  type SemanticNodeKind,
  type SourceRange
} from '@vmprint/markdown-core';
import type { MdNode } from './markdown';
import { Draft2FinalError } from './errors';

export type { SourceRange, SemanticNodeKind, SemanticNode, SemanticDocument };

export function normalizeToSemantic(ast: MdNode, inputPath: string): SemanticDocument {
  try {
    return normalizeToSemanticCore(ast);
  } catch (error: unknown) {
    if (error instanceof Draft2FinalError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Draft2FinalError('normalize', inputPath, message, 3, { cause: error });
  }
}
