/**
 * Converts a PNG image's alpha channel into a VMPrint exclusion assembly.
 *
 * Usage:
 *   tsx tools/image-to-assembly.ts <image.png> [options]
 *
 * Options:
 *   --width N        Float width in document points (default: 180)
 *   --height N       Float height in document points (default: 216)
 *   --band-height N  Scanline band height in points (default: 6)
 *   --tiers N        Resistance tier count 1–4 (default: 3)
 *   --scale N        Pixels per point in output bitmap (default: 2)
 *   --no-merge       Skip vertical run-length merging
 *   --output <base>  Output path prefix (default: alongside input)
 *
 * Outputs:
 *   <base>-assembly.json   Compact layers assembly ready to paste into a document
 *   <base>-assembly.png    Bitmap visualising each resistance tier for verification
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

// --- Types ---

interface Tier {
    threshold: number; // alpha threshold 0–1 to qualify for this tier
    r: number;         // resistance value
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
}

interface CompactLayer {
    r?: number;
    rects: [number, number, number, number][];
}

// --- Tier presets (hardest to softest) ---

const TIER_PRESETS: Record<number, Tier[]> = {
    1: [{ threshold: 0.15, r: 1 }],
    2: [{ threshold: 0.5,  r: 1 }, { threshold: 0.1,  r: 0.4 }],
    3: [{ threshold: 0.7,  r: 1 }, { threshold: 0.25, r: 0.6 }, { threshold: 0.05, r: 0.3 }],
    4: [{ threshold: 0.8,  r: 1 }, { threshold: 0.5,  r: 0.6 }, { threshold: 0.2,  r: 0.3 }, { threshold: 0.05, r: 0.14 }],
};

// --- Scanline pass ---

function scanBand(
    alpha: Uint8Array,
    width: number,
    yBand: number,
    bandH: number,
    height: number
): Float32Array {
    // Max alpha per column across the band — conservative, nothing is missed
    const result = new Float32Array(width);
    const yEnd = Math.min(yBand + bandH, height);
    for (let x = 0; x < width; x++) {
        let max = 0;
        for (let y = yBand; y < yEnd; y++) {
            const a = alpha[y * width + x] / 255;
            if (a > max) max = a;
        }
        result[x] = max;
    }
    return result;
}

function findSpans(
    row: Float32Array,
    threshold: number,
    yBand: number,
    bandH: number
): Rect[] {
    const spans: Rect[] = [];
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
        const above = x < row.length && row[x] >= threshold;
        if (above && start < 0) {
            start = x;
        } else if (!above && start >= 0) {
            spans.push({ x: start, y: yBand, w: x - start, h: bandH, r: 0 });
            start = -1;
        }
    }
    return spans;
}

// --- Vertical merging ---

function mergeVertical(rects: Rect[]): Rect[] {
    const groups = new Map<string, Rect[]>();
    for (const rect of rects) {
        const key = `${rect.x},${rect.w},${rect.r}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(rect);
    }
    const merged: Rect[] = [];
    for (const group of groups.values()) {
        group.sort((a, b) => a.y - b.y);
        let cur = { ...group[0] };
        for (let i = 1; i < group.length; i++) {
            if (group[i].y === cur.y + cur.h) {
                cur.h += group[i].h;
            } else {
                merged.push(cur);
                cur = { ...group[i] };
            }
        }
        merged.push(cur);
    }
    return merged;
}

// --- Compact layers output ---

function toCompactLayers(rects: Rect[]): { layers: CompactLayer[] } {
    const map = new Map<number, [number, number, number, number][]>();
    for (const rect of rects) {
        if (!map.has(rect.r)) map.set(rect.r, []);
        map.get(rect.r)!.push([rect.x, rect.y, rect.w, rect.h]);
    }
    const layers: CompactLayer[] = [...map.entries()]
        .sort((a, b) => b[0] - a[0]) // hard first
        .map(([r, tuples]) => r === 1 ? { rects: tuples } : { r, rects: tuples });
    return { layers };
}

// --- Bitmap rendering ---
//
// Resistance maps directly to darkness: r=1 → black, r=0 → white.
// Tiers are painted softest-first so the hard core always reads on top.

async function renderBitmap(
    rects: Rect[],
    tiers: Tier[],
    width: number,
    height: number,
    scale: number,
    outputPath: string
): Promise<void> {
    const bw = width * scale;
    const bh = height * scale;
    const buf = Buffer.alloc(bw * bh * 4, 255); // white RGBA

    const sorted = [...tiers].sort((a, b) => a.r - b.r); // softest first
    for (const tier of sorted) {
        const gray = Math.round(255 * (1 - tier.r));
        for (const rect of rects) {
            if (rect.r !== tier.r) continue;
            const x0 = rect.x * scale;
            const y0 = rect.y * scale;
            const x1 = Math.min((rect.x + rect.w) * scale, bw);
            const y1 = Math.min((rect.y + rect.h) * scale, bh);
            for (let py = y0; py < y1; py++) {
                for (let px = x0; px < x1; px++) {
                    const i = (py * bw + px) * 4;
                    buf[i] = gray;
                    buf[i + 1] = gray;
                    buf[i + 2] = gray;
                    // buf[i+3] stays 255
                }
            }
        }
    }

    await sharp(buf, { raw: { width: bw, height: bh, channels: 4 } })
        .png()
        .toFile(outputPath);
}

// --- Main ---

function getOpt(args: string[], name: string, def: number): number {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : def;
}
function getStr(args: string[], name: string, def: string): string {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const inputPath = args.find(a => !a.startsWith('--') && !Number.isFinite(Number(a)));
    if (!inputPath) {
        console.error('Usage: tsx tools/image-to-assembly.ts <image.png> [--width N] [--height N] [--band-height N] [--tiers 1-4] [--scale N] [--no-merge] [--output <base>]');
        process.exit(1);
    }

    const width    = getOpt(args, 'width', 180);
    const height   = getOpt(args, 'height', 216);
    const bandH    = getOpt(args, 'band-height', 6);
    const tierCount = Math.min(4, Math.max(1, getOpt(args, 'tiers', 3)));
    const scale    = getOpt(args, 'scale', 2);
    const doMerge  = !args.includes('--no-merge');
    const absInput = path.resolve(inputPath);
    const outputBase = getStr(args, 'output', path.join(
        path.dirname(absInput),
        path.basename(absInput, path.extname(absInput))
    ));

    const tiers = TIER_PRESETS[tierCount];

    // Load image and extract alpha
    const { data } = await sharp(absInput)
        .resize(width, height, { fit: 'fill' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3];

    // Scanline pass
    const raw: Rect[] = [];
    for (let yBand = 0; yBand < height; yBand += bandH) {
        const actualH = Math.min(bandH, height - yBand);
        const row = scanBand(alpha, width, yBand, actualH, height);
        for (const tier of tiers) {
            for (const span of findSpans(row, tier.threshold, yBand, actualH)) {
                raw.push({ ...span, r: tier.r });
            }
        }
    }

    const rects = doMerge ? mergeVertical(raw) : raw;

    // Write assembly JSON
    const jsonPath = outputBase + '-assembly.json';
    fs.writeFileSync(jsonPath, JSON.stringify(toCompactLayers(rects)));

    // Write bitmap
    const bitmapPath = outputBase + '-assembly.png';
    await renderBitmap(rects, tiers, width, height, scale, bitmapPath);

    // Summary
    const rawCount = raw.length;
    const mergedCount = rects.length;
    const byTier = tiers.map(t => `${rects.filter(r => r.r === t.r).length} @r=${t.r}`);
    console.log(`Input:    ${path.basename(absInput)} → ${width}×${height}pt, band ${bandH}pt, ${tierCount} tier(s)`);
    if (doMerge) console.log(`Members:  ${rawCount} → ${mergedCount} after vertical merge (${byTier.join(', ')})`);
    else         console.log(`Members:  ${mergedCount} (${byTier.join(', ')})`);
    console.log(`Assembly: ${jsonPath}`);
    console.log(`Bitmap:   ${bitmapPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
