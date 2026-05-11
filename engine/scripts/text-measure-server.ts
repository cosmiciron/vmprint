import http from 'node:http';

import { LayoutUtils } from '../src/engine/layout/layout-utils';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { loadLocalFontManager } from '../tests/harness/engine-harness';

type MeasureItem = {
    text?: string;
    fontFamily?: string;
    fontWeight?: number | string;
    fontStyle?: string;
    fontSize?: number;
    letterSpacing?: number;
    direction?: 'ltr' | 'rtl';
    scriptClass?: string;
    lineHeight?: number;
    lineHeightMode?: 'print' | 'css';
};

const DEFAULT_PORT = 4765;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_FONT_FAMILY = 'Arimo';

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8').trim();
                resolve(raw.length > 0 ? JSON.parse(raw) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body)
    });
    res.end(body);
}

function parseMeasureRequest(payload: unknown): { items: MeasureItem[]; single: boolean } {
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (Array.isArray(record.items)) {
            return { items: record.items as MeasureItem[], single: false };
        }
    }
    return { items: [payload as MeasureItem], single: true };
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
    const port = normalizeFiniteNumber(process.env.PORT, DEFAULT_PORT);
    const host = process.env.HOST || DEFAULT_HOST;

    async function measure(item: MeasureItem) {
        const fontFamily = String(item?.fontFamily || DEFAULT_FONT_FAMILY);
        const fontWeight = item?.fontWeight ?? 400;
        const fontStyle = String(item?.fontStyle || 'normal');
        const fontSize = normalizeFiniteNumber(item?.fontSize, 12);
        const match = LayoutUtils.resolveFontMatch(fontFamily, fontWeight, fontStyle, runtime.textDelegate);
        const cached = runtime.textDelegate.getCachedFace(match.config.src, runtime.textDelegateState);
        const font = cached || await runtime.textDelegate.loadFace(match.config.src, runtime.textDelegateState);
        const measured = runtime.textDelegate.measure(String(item?.text ?? ''), font, fontSize, {
            letterSpacing: normalizeFiniteNumber(item?.letterSpacing, 0),
            direction: item?.direction === 'rtl' ? 'rtl' : 'ltr',
            scriptClass: String(item?.scriptClass || 'none'),
            lineHeight: normalizeFiniteNumber(item?.lineHeight, 0),
            lineHeightMode: item?.lineHeightMode === 'css' ? 'css' : 'print'
        });

        return {
            width: measured.width,
            ascent: measured.ascent,
            descent: measured.descent,
            glyphs: measured.glyphs,
            shapedGlyphs: measured.shapedGlyphs,
            fontFamily: match.config.family,
            fontName: match.config.name,
            fontWeight: match.resolvedWeight,
            fontStyle: match.resolvedStyle
        };
    }

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'GET' && req.url === '/health') {
                sendJson(res, 200, {
                    ok: true,
                    service: 'vmprint-text-measure',
                    fontFamilies: [...new Set(runtime.textDelegate.getFontRegistrySnapshot().map((font) => font.family))]
                });
                return;
            }

            if (req.method === 'POST' && req.url === '/measure') {
                const { items, single } = parseMeasureRequest(await readJsonBody(req));
                const measurements = await Promise.all(items.map(measure));
                sendJson(res, 200, single ? measurements[0] : { measurements });
                return;
            }

            sendJson(res, 404, { error: 'Not found. Use GET /health or POST /measure.' });
        } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    });

    server.listen(port, host, () => {
        console.log(`[vmprint-text-measure] listening on http://${host}:${port}`);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
