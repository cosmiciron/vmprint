/**
 * Node.js entry point for @vmprint/transmuter-mkd.
 * Reads a Markdown file from disk and resolves all image references
 * (relative paths and http/https URLs) as base64-encoded data inline.
 *
 * Import as: import { transmuteFile } from '@vmprint/transmuter-mkd/node'
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { transmute } from './index';
import type { TransmuteOptions, DocumentInput, ResolvedImage } from './index';

export type { DocumentInput, ResolvedImage } from './index';

export type TransmuteFileOptions = Omit<TransmuteOptions, 'resolveImage'>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferMime(buf: Buffer): 'image/png' | 'image/jpeg' | null {
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
    return null;
}

function bufToResolved(buf: Buffer): ResolvedImage | null {
    const mimeType = inferMime(buf);
    if (!mimeType) return null;
    return { data: buf.toString('base64'), mimeType };
}

function fetchUrl(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        lib.get(url, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow one redirect
                fetchUrl(res.headers.location).then(resolve, reject);
                return;
            }
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// ─── Image resolver ───────────────────────────────────────────────────────────

function makeNodeResolver(dir: string): (src: string) => ResolvedImage | null {
    const cache = new Map<string, ResolvedImage | null>();
    return (src: string) => {
        if (cache.has(src)) return cache.get(src)!;
        let result: ResolvedImage | null = null;
        try {
            const imgPath = path.isAbsolute(src) ? src : path.join(dir, src);
            const buf = fs.readFileSync(imgPath);
            result = bufToResolved(buf);
        } catch {
            result = null;
        }
        cache.set(src, result);
        return result;
    };
}

// ─── Async resolver (URLs) ────────────────────────────────────────────────────

async function preloadUrls(
    markdown: string,
    dir: string
): Promise<Map<string, ResolvedImage | null>> {
    const srcs = new Set<string>();
    const pattern = /!\[[^\]]*\]\(([^)\s]+)/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(markdown)) !== null) srcs.add(m[1]);

    const map = new Map<string, ResolvedImage | null>();
    await Promise.all([...srcs].map(async (src) => {
        if (/^data:/i.test(src)) return;
        if (/^https?:\/\//i.test(src)) {
            try {
                const buf = await fetchUrl(src);
                map.set(src, bufToResolved(buf));
            } catch {
                map.set(src, null);
            }
        } else {
            // Local files are resolved synchronously in the main resolver; skip here
            const imgPath = path.isAbsolute(src) ? src : path.join(dir, src);
            try {
                const buf = fs.readFileSync(imgPath);
                map.set(src, bufToResolved(buf));
            } catch {
                map.set(src, null);
            }
        }
    }));
    return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a Markdown file and transmute it into a VMPrint DocumentInput.
 *
 * All image references in the document are resolved and base64-encoded inline:
 * - Relative or absolute **file paths** are read from disk.
 * - **http/https URLs** are fetched (one redirect followed).
 * - **data URIs** pass through the transmuter unchanged.
 * - Unresolvable images emit a placeholder element (no error thrown).
 */
export async function transmuteFile(
    filePath: string,
    options?: TransmuteFileOptions
): Promise<DocumentInput> {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    const markdown = fs.readFileSync(absPath, 'utf8');

    const preloaded = await preloadUrls(markdown, dir);

    const resolveImage = (src: string): ResolvedImage | null => {
        if (preloaded.has(src)) return preloaded.get(src) ?? null;
        return null;
    };

    return transmute(markdown, { ...options, resolveImage });
}
