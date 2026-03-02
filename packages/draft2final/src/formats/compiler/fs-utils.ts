import fs from 'node:fs';
import path from 'node:path';

/**
 * Read a file synchronously, returning its content or null if it cannot be read.
 */
export function tryReadFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Resolve a format-relative asset path using a three-candidate lookup:
 *   1. dist path:  __dirname/<formatName>/<...segments>   (compiled output)
 *   2. src path:   __dirname/../<formatName>/<...segments> (tsx / ts-node from src/)
 *   3. cwd path:   cwd/src/formats/<formatName>/<...segments>
 *
 * Returns the first existing path, or null if none exist. Works for both files and directories.
 */
export function resolveFormatAsset(formatName: string, ...segments: string[]): string | null {
    const candidates = [
        path.resolve(__dirname, formatName, ...segments),
        path.resolve(__dirname, '..', formatName, ...segments),
        path.resolve(process.cwd(), 'src', 'formats', formatName, ...segments),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}
