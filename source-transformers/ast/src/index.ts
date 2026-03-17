import path from 'node:path';

import type {
  DocumentInput,
  DocumentIR,
  LayoutConfig
} from '@vmprint/engine';
import {
  CURRENT_DOCUMENT_VERSION,
  CURRENT_IR_VERSION,
  resolveDocumentPaths,
  serializeDocumentIR,
  toLayoutConfig
} from './document';
import type { SourceTransformer } from '@vmprint/contracts';
import { createSpatialDocumentFixture, type SpatialDocumentFixture } from './spatialize';

export type { DocumentInput, DocumentIR, LayoutConfig } from '@vmprint/engine';
export type { SourceTransformer } from '@vmprint/contracts';
export type { SpatialDocumentFixture } from './spatialize';

export interface AstSourceInput {
  document: DocumentInput;
  documentPath: string;
}

export interface AstSourceTransformResult {
  document: DocumentIR;
  layoutConfig: LayoutConfig;
  spatialDocument: SpatialDocumentFixture;
}

export class AstSourceTransformer implements SourceTransformer<AstSourceInput, AstSourceTransformResult> {
  transform(input: AstSourceInput): AstSourceTransformResult {
    const document = resolveDocumentPaths(input.document, input.documentPath);
    const layoutConfig = toLayoutConfig(document, false);
    return {
      document,
      layoutConfig,
      spatialDocument: createSpatialDocumentFixture(document, path.basename(input.documentPath), layoutConfig)
    };
  }
}

export function transformAstSource(document: DocumentInput, documentPath: string): AstSourceTransformResult {
  return new AstSourceTransformer().transform({ document, documentPath });
}

export {
  CURRENT_DOCUMENT_VERSION,
  CURRENT_IR_VERSION,
  createSpatialDocumentFixture,
  resolveDocumentPaths,
  serializeDocumentIR,
  toLayoutConfig
};
