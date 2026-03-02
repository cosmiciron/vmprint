import fs from 'node:fs';
import path from 'node:path';
import { Draft2FinalError } from '../../errors';
import type { SemanticNode } from '../../semantic';

export type ResolvedImage = {
    data: string;
    mimeType: 'image/png' | 'image/jpeg';
};

function imageSourceForError(inputPath: string, node: SemanticNode): string {
    const range = node.sourceRange;
    if (!range) return inputPath;
    return `${inputPath}:${range.lineStart}:${range.colStart}`;
}

function failImageCompile(inputPath: string, node: SemanticNode, message: string, cause?: unknown): never {
    throw new Draft2FinalError(
        'format',
        imageSourceForError(inputPath, node),
        message,
        3,
        cause ? { cause } : undefined,
    );
}

export function inferMimeTypeFromBytes(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
    if (
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return 'image/png';
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return 'image/jpeg';
    }
    return null;
}

export function normalizeDataUriMimeType(raw: string): string {
    const normalized = raw.trim().toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

export function resolveDataUriImage(rawSrc: string, inputPath: string, node: SemanticNode): ResolvedImage {
    const match = rawSrc.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
        failImageCompile(inputPath, node, 'Invalid image data URI. Expected: data:<mime>;base64,<data>.');
    }

    const mimeTypeRaw = normalizeDataUriMimeType(match[1]);
    const base64Data = match[2].replace(/\s+/g, '');
    const bytes = Buffer.from(base64Data, 'base64');
    const inferredMime = inferMimeTypeFromBytes(bytes);

    if (mimeTypeRaw !== 'image/png' && mimeTypeRaw !== 'image/jpeg') {
        failImageCompile(
            inputPath,
            node,
            `Unsupported image MIME type "${mimeTypeRaw}". Supported types: image/png, image/jpeg.`,
        );
    }
    if (!inferredMime) {
        failImageCompile(inputPath, node, 'Image data URI is not a valid PNG or JPEG payload.');
    }
    if (inferredMime !== mimeTypeRaw) {
        failImageCompile(
            inputPath,
            node,
            `Image data URI MIME type "${mimeTypeRaw}" does not match decoded bytes ("${inferredMime}").`,
        );
    }

    return { data: base64Data, mimeType: mimeTypeRaw as 'image/png' | 'image/jpeg' };
}

export function resolveLocalImage(rawSrc: string, inputPath: string, node: SemanticNode): ResolvedImage {
    const markdownDir = path.dirname(path.resolve(inputPath));
    const candidatePath = path.isAbsolute(rawSrc) ? rawSrc : path.resolve(markdownDir, rawSrc);
    const decodedCandidatePath = candidatePath.includes('%')
        ? (() => {
              try {
                  return decodeURIComponent(candidatePath);
              } catch {
                  return candidatePath;
              }
          })()
        : candidatePath;
    const filePath = fs.existsSync(candidatePath) ? candidatePath : decodedCandidatePath;

    if (!fs.existsSync(filePath)) {
        failImageCompile(inputPath, node, `Image file not found: ${filePath}`);
    }

    let bytes: Buffer;
    try {
        bytes = fs.readFileSync(filePath);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failImageCompile(inputPath, node, `Failed to read image file "${filePath}": ${message}`, error);
    }

    const inferredMime = inferMimeTypeFromBytes(bytes);
    if (!inferredMime) {
        failImageCompile(inputPath, node, `Unsupported image file "${filePath}". Only PNG and JPEG are supported.`);
    }

    return { data: bytes.toString('base64'), mimeType: inferredMime };
}

export function createImageResolver(inputPath: string): (node: SemanticNode) => ResolvedImage {
    const cache = new Map<string, ResolvedImage>();
    return (node: SemanticNode): ResolvedImage => {
        const src = (node.src || '').trim();
        if (!src) {
            failImageCompile(inputPath, node, 'Image source is empty.');
        }

        const cached = cache.get(src);
        if (cached) return cached;

        if (/^https?:\/\//i.test(src)) {
            failImageCompile(inputPath, node, `Remote HTTP/HTTPS images are not supported: ${src}`);
        }

        const resolved = /^data:/i.test(src)
            ? resolveDataUriImage(src, inputPath, node)
            : resolveLocalImage(src, inputPath, node);
        cache.set(src, resolved);
        return resolved;
    };
}
