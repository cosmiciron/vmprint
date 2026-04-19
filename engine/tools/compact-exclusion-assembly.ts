/**
 * Compacts all exclusionAssembly members arrays in a document JSON file into
 * the compact layers format, modifying the file in-place after creating a backup.
 *
 * Usage:
 *   tsx tools/compact-exclusion-assembly.ts <file.json>
 *
 * The original file is backed up as <file.json>.bak before any changes are written.
 * All exclusionAssembly objects in the document are compacted in a single pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

interface RawMember {
    x: number;
    y: number;
    w: number;
    h: number;
    resistance?: number;
}

interface CompactLayer {
    r?: number;
    rects: [number, number, number, number][];
}

function compactMembers(members: RawMember[]): { layers: CompactLayer[] } {
    const layerMap = new Map<number | undefined, [number, number, number, number][]>();
    for (const m of members) {
        const r = m.resistance;
        if (!layerMap.has(r)) layerMap.set(r, []);
        layerMap.get(r)!.push([m.x, m.y, m.w, m.h]);
    }
    const sortKey = (r: number | undefined) => (r === undefined ? 1 : r);
    const layers: CompactLayer[] = [...layerMap.entries()]
        .sort((a, b) => sortKey(b[0]) - sortKey(a[0]))
        .map(([r, rects]) => (r === undefined ? { rects } : { r, rects }));
    return { layers };
}

function walkAndCompact(node: unknown): { node: unknown; count: number } {
    if (node === null || typeof node !== 'object') return { node, count: 0 };

    if (Array.isArray(node)) {
        let count = 0;
        const result = node.map(item => {
            const r = walkAndCompact(item);
            count += r.count;
            return r.node;
        });
        return { node: result, count };
    }

    const obj = node as Record<string, unknown>;
    let count = 0;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
        if (key === 'exclusionAssembly' && val !== null && typeof val === 'object') {
            const asm = val as Record<string, unknown>;
            if (Array.isArray(asm.members) && asm.members.length > 0) {
                result[key] = compactMembers(asm.members as RawMember[]);
                count++;
                continue;
            }
        }
        const r = walkAndCompact(val);
        result[key] = r.node;
        count += r.count;
    }

    return { node: result, count };
}

const filePath = process.argv[2];
if (!filePath) {
    console.error('Usage: tsx tools/compact-exclusion-assembly.ts <file.json>');
    process.exit(1);
}

const absPath = path.resolve(filePath);
const backupPath = absPath + '.bak';

const original = fs.readFileSync(absPath, 'utf8');
fs.writeFileSync(backupPath, original);
console.log(`Backup written to ${backupPath}`);

const doc = JSON.parse(original);
const { node: compacted, count } = walkAndCompact(doc);

if (count === 0) {
    console.log('No exclusionAssembly members arrays found — file unchanged.');
    fs.unlinkSync(backupPath);
    process.exit(0);
}

// Pretty-print the document but inline (minify) each exclusionAssembly value.
const inlined = new Map<string, string>();
let inlineCounter = 0;

function inlineAssemblies(node: unknown): unknown {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return (node as unknown[]).map(inlineAssemblies);
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k === 'exclusionAssembly') {
            const placeholder = `__ASSEMBLY_${inlineCounter++}__`;
            inlined.set(placeholder, JSON.stringify(v));
            result[k] = placeholder;
        } else {
            result[k] = inlineAssemblies(v);
        }
    }
    return result;
}

let output = JSON.stringify(inlineAssemblies(compacted), null, 2) + '\n';
for (const [placeholder, minified] of inlined) {
    output = output.replace(`"${placeholder}"`, minified);
}
fs.writeFileSync(absPath, output);

const originalSize = Buffer.byteLength(original);
const compactedSize = Buffer.byteLength(output);
const saving = (((originalSize - compactedSize) / originalSize) * 100).toFixed(1);
console.log(`Compacted ${count} assembly/assemblies in ${path.basename(absPath)}`);
console.log(`Size: ${originalSize.toLocaleString()} → ${compactedSize.toLocaleString()} bytes (${saving}% smaller)`);
