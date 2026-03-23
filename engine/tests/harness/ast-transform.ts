import path from 'node:path';

import type {
    DocumentInput,
    DocumentIR,
    LayoutConfig
} from '../../src';
import {
    CURRENT_DOCUMENT_VERSION,
    CURRENT_IR_VERSION,
    resolveDocumentPaths,
    serializeDocumentIR,
    toLayoutConfig
} from '../../src';
import { createSpatialDocumentFixture, type SpatialDocumentFixture } from './spatialize';

export type { DocumentInput, DocumentIR, LayoutConfig } from '../../src';
export type { SpatialDocumentFixture } from './spatialize';

export interface AstSourceTransformResult {
    document: DocumentIR;
    layoutConfig: LayoutConfig;
    spatialDocument: SpatialDocumentFixture;
}

export function transformAstSource(document: DocumentInput, documentPath: string): AstSourceTransformResult {
    const resolvedDocument = resolveDocumentPaths(document, documentPath);
    const layoutConfig = toLayoutConfig(resolvedDocument, false);
    return {
        document: resolvedDocument,
        layoutConfig,
        spatialDocument: createSpatialDocumentFixture(resolvedDocument, path.basename(documentPath), layoutConfig)
    };
}

export {
    CURRENT_DOCUMENT_VERSION,
    CURRENT_IR_VERSION,
    createSpatialDocumentFixture,
    resolveDocumentPaths,
    serializeDocumentIR,
    toLayoutConfig
};
