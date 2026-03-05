import { jsPDF } from 'jspdf';
import {
    Context,
    ContextFactoryOptions,
    ContextFontRegistrationOptions,
    ContextImageOptions,
    ContextTextOptions,
    VmprintOutputStream,
    ContextPageSize,
} from '@vmprint/contracts';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// Standard-font PostScript name → jsPDF {family, fontStyle}
// The 14 built-in PDF fonts are available in jsPDF without embedding.
// ---------------------------------------------------------------------------
type JsPdfFontInfo = { family: string; fontStyle: string };

const POSTSCRIPT_TO_JSPDF: Record<string, JsPdfFontInfo> = {
    'Helvetica':             { family: 'helvetica',    fontStyle: 'normal'     },
    'Helvetica-Bold':        { family: 'helvetica',    fontStyle: 'bold'       },
    'Helvetica-Oblique':     { family: 'helvetica',    fontStyle: 'italic'     },
    'Helvetica-BoldOblique': { family: 'helvetica',    fontStyle: 'bolditalic' },
    'Times-Roman':           { family: 'times',        fontStyle: 'normal'     },
    'Times-Bold':            { family: 'times',        fontStyle: 'bold'       },
    'Times-Italic':          { family: 'times',        fontStyle: 'italic'     },
    'Times-BoldItalic':      { family: 'times',        fontStyle: 'bolditalic' },
    'Courier':               { family: 'courier',      fontStyle: 'normal'     },
    'Courier-Bold':          { family: 'courier',      fontStyle: 'bold'       },
    'Courier-Oblique':       { family: 'courier',      fontStyle: 'italic'     },
    'Courier-BoldOblique':   { family: 'courier',      fontStyle: 'bolditalic' },
    'Symbol':                { family: 'symbol',       fontStyle: 'normal'     },
    'ZapfDingbats':          { family: 'zapfdingbats', fontStyle: 'normal'     },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolvePageFormat(size: ContextPageSize): string | number[] {
    if (typeof size === 'string') {
        return size.toLowerCase();
    }
    if (Array.isArray(size)) {
        return size;
    }
    return [size.width, size.height];
}

/**
 * Derive jsPDF orientation from the page size.
 * Named string sizes default to portrait.
 * For explicit dimensions, width > height means landscape.
 */
function resolveOrientation(size: ContextPageSize): 'portrait' | 'landscape' {
    if (typeof size === 'string') return 'portrait';
    const w = Array.isArray(size) ? size[0] : size.width;
    const h = Array.isArray(size) ? size[1] : size.height;
    return w > h ? 'landscape' : 'portrait';
}

/**
 * Parses a CSS color string to [r, g, b] in 0–255 range.
 * Handles '#RRGGBB', '#RGB', and a handful of named colors.
 * Unknown strings fall back to black.
 */
function parseColor(color: string): [number, number, number] {
    const s = (color ?? '').trim();
    if (s.startsWith('#')) {
        if (s.length === 7) {
            return [
                parseInt(s.slice(1, 3), 16),
                parseInt(s.slice(3, 5), 16),
                parseInt(s.slice(5, 7), 16),
            ];
        }
        if (s.length === 4) {
            return [
                parseInt(s[1] + s[1], 16),
                parseInt(s[2] + s[2], 16),
                parseInt(s[3] + s[3], 16),
            ];
        }
    }
    const named: Record<string, [number, number, number]> = {
        black: [0, 0, 0], white: [255, 255, 255],
        red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
        gray: [128, 128, 128], grey: [128, 128, 128],
        silver: [192, 192, 192],
    };
    return named[s.toLowerCase()] ?? [0, 0, 0];
}

function mimeToImageFormat(mimeType?: string): string {
    const m = (mimeType ?? '').toLowerCase();
    if (m.includes('png'))  return 'PNG';
    if (m.includes('gif'))  return 'GIF';
    if (m.includes('bmp'))  return 'BMP';
    if (m.includes('webp')) return 'WEBP';
    return 'JPEG';
}

// ---------------------------------------------------------------------------
// PdfLiteContext
// ---------------------------------------------------------------------------

/**
 * A lightweight PDF rendering context backed by jsPDF.
 *
 * Architecture notes
 * ------------------
 * • jsPDF does not stream output — the complete PDF is generated at end().
 *   pipe() stores the VmprintOutputStream reference; end() writes the full
 *   ArrayBuffer to it in one shot.
 *
 * • jsPDF always opens the first page automatically. The renderer calls
 *   addPage() for every page including the first, so the first call is a
 *   no-op here.
 *
 * • Standard-font handling mirrors the PDFKit context exactly: when
 *   registerFont() receives a standardFontPostScriptName, the font id is
 *   mapped to the corresponding jsPDF built-in name and no binary data is
 *   registered. Custom fonts are base64-encoded and registered via
 *   addFileToVFS / addFont.
 *
 * • Transforms (translate, rotate) and graphics state (save, restore,
 *   opacity) are delegated to jsPDF's setCurrentTransformationMatrix /
 *   saveGraphicsState / restoreGraphicsState / setGState. jsPDF sets up an
 *   initial page CTM that flips the y-axis so that all subsequent cm
 *   operators (and these helpers) operate in the same y-down user space
 *   that the PDFKit context exposes.
 *
 * • Path building (moveTo / lineTo / bezierCurveTo / rect / roundedRect)
 *   uses jsPDF's public path API. fill() / stroke() / fillAndStroke() close
 *   the path and paint it. The rounded-rect approximation uses cubic Bézier
 *   curves at k ≈ 0.5523 (the standard quarter-circle approximation).
 */
export class PdfLiteContext implements Context {
    private readonly doc: jsPDF;
    private readonly pageWidth: number;
    private readonly pageHeight: number;

    /** Maps engine font-id → jsPDF {family, fontStyle}. */
    private readonly fontInfoById = new Map<string, JsPdfFontInfo>();

    private pagesAdded = 0;
    private outputStream: VmprintOutputStream | null = null;
    private isEnded = false;

    constructor(options: ContextFactoryOptions) {
        const format = resolvePageFormat(options.size);
        this.doc = new jsPDF({
            unit:             'pt',
            format:           format as any,
            orientation:      resolveOrientation(options.size),
            compress:         true,
            putOnlyUsedFonts: true,
        });
        const ps = this.doc.internal.pageSize;
        this.pageWidth  = typeof ps.getWidth  === 'function' ? ps.getWidth()  : (ps as any).width;
        this.pageHeight = typeof ps.getHeight === 'function' ? ps.getHeight() : (ps as any).height;
    }

    // -------------------------------------------------------------------------
    // Document lifecycle
    // -------------------------------------------------------------------------

    addPage(): void {
        if (this.pagesAdded === 0) {
            // jsPDF always opens one page in the constructor; consume it.
            this.pagesAdded = 1;
            return;
        }
        this.doc.addPage();
        this.pagesAdded++;
    }

    pipe(stream: VmprintOutputStream): void {
        // jsPDF cannot stream incrementally; store the destination for end().
        this.outputStream = stream;
    }

    end(): void {
        if (this.isEnded) return;
        this.isEnded = true;
        const buf = this.doc.output('arraybuffer');
        if (this.outputStream) {
            this.outputStream.write(new Uint8Array(buf));
            this.outputStream.end();
        }
    }

    // -------------------------------------------------------------------------
    // Font management
    // -------------------------------------------------------------------------

    async registerFont(
        id: string,
        buffer: Uint8Array,
        options?: ContextFontRegistrationOptions
    ): Promise<void> {
        if (options?.standardFontPostScriptName) {
            // Standard font: map to jsPDF built-in; no binary registration needed.
            const jsPdfFont = POSTSCRIPT_TO_JSPDF[options.standardFontPostScriptName]
                ?? { family: 'helvetica', fontStyle: 'normal' };
            this.fontInfoById.set(id, jsPdfFont);
            return;
        }

        // Custom font: base64-encode and register with jsPDF's virtual file-system.
        // Identity-H encoding is required to activate jsPDF's built-in subsetter:
        // it collects used glyph IDs via pdfEscape16 and encodes only those glyphs
        // at output time via font.metadata.subset.encode(glyIdsUsed).
        try {
            const base64   = Buffer.from(buffer).toString('base64');
            const filename = `${id}.ttf`;
            this.doc.addFileToVFS(filename, base64);
            this.doc.addFont(filename, id, 'normal', 400, 'Identity-H');
            this.fontInfoById.set(id, { family: id, fontStyle: 'normal' });
        } catch (e: unknown) {
            throw new Error(`[PdfLiteContext] Failed to register font "${id}": ${String(e)}`);
        }
    }

    font(family: string, size?: number): this {
        // Look up by engine font id first, then fall back to a direct PostScript
        // name lookup (overlay scripts pass names like 'Helvetica-Bold' directly,
        // which jsPDF doesn't recognise — it uses lowercase 'helvetica'/'bold').
        const info = this.fontInfoById.get(family) ?? POSTSCRIPT_TO_JSPDF[family];
        if (info) {
            this.doc.setFont(info.family, info.fontStyle);
        } else {
            this.doc.setFont(family);
        }
        if (size !== undefined) {
            this.doc.setFontSize(size);
        }
        return this;
    }

    fontSize(size: number): this {
        this.doc.setFontSize(size);
        return this;
    }

    // -------------------------------------------------------------------------
    // Graphics state
    // -------------------------------------------------------------------------

    save(): void {
        this.doc.saveGraphicsState();
    }

    restore(): void {
        this.doc.restoreGraphicsState();
    }

    /**
     * Concatenates a matrix to the current transformation matrix.
     * jsPDF sets up an initial y-flip CTM at page start, so [a b c d e f]
     * here is in the same y-down user space as the PDFKit context.
     */
    private applyTransform(
        a: number, b: number,
        c: number, d: number,
        e: number, f: number
    ): void {
        const doc = this.doc as any;
        if (typeof doc.Matrix === 'function') {
            this.doc.setCurrentTransformationMatrix(doc.Matrix(a, b, c, d, e, f));
        } else if (typeof doc.setCurrentTransformationMatrix === 'function') {
            // Fallback: write cm directly if Matrix factory is unavailable.
            doc.internal?.write?.(`${a} ${b} ${c} ${d} ${e} ${f} cm`);
        }
    }

    translate(x: number, y: number): this {
        this.applyTransform(1, 0, 0, 1, x, y);
        return this;
    }

    rotate(angle: number, originX?: number, originY?: number): this {
        const rad = (angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const ox  = originX ?? 0;
        const oy  = originY ?? 0;
        // Rotation matrix in y-down user space (matches PDFKit's convention).
        this.applyTransform(
            cos, sin, -sin, cos,
            ox - ox * cos + oy * sin,
            oy - ox * sin - oy * cos
        );
        return this;
    }

    opacity(opacity: number): this {
        const doc = this.doc as any;
        if (typeof doc.GState === 'function') {
            this.doc.setGState(doc.GState({ opacity, 'stroke-opacity': opacity }));
        }
        return this;
    }

    // -------------------------------------------------------------------------
    // Color and line style
    // -------------------------------------------------------------------------

    fillColor(color: string): this {
        const [r, g, b] = parseColor(color);
        this.doc.setFillColor(r, g, b);
        // jsPDF separates shape-fill color from text color; keep them in sync.
        this.doc.setTextColor(r, g, b);
        return this;
    }

    strokeColor(color: string): this {
        const [r, g, b] = parseColor(color);
        this.doc.setDrawColor(r, g, b);
        return this;
    }

    lineWidth(width: number): this {
        this.doc.setLineWidth(width);
        return this;
    }

    dash(length: number, options?: { space: number }): this {
        const space = options?.space ?? length;
        (this.doc as any).setLineDash?.([length, space], 0);
        return this;
    }

    undash(): this {
        (this.doc as any).setLineDash?.([], 0);
        return this;
    }

    // -------------------------------------------------------------------------
    // Path construction
    // -------------------------------------------------------------------------

    moveTo(x: number, y: number): this {
        this.doc.moveTo(x, y);
        return this;
    }

    lineTo(x: number, y: number): this {
        this.doc.lineTo(x, y);
        return this;
    }

    bezierCurveTo(
        cp1x: number, cp1y: number,
        cp2x: number, cp2y: number,
        x: number,    y: number
    ): this {
        this.doc.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        return this;
    }

    rect(x: number, y: number, w: number, h: number): this {
        this.doc.moveTo(x,     y    );
        this.doc.lineTo(x + w, y    );
        this.doc.lineTo(x + w, y + h);
        this.doc.lineTo(x,     y + h);
        (this.doc as any).close();
        return this;
    }

    // Cubic Bézier approximation constant for a quarter-circle arc.
    private static readonly K = 0.5522848;

    roundedRect(x: number, y: number, w: number, h: number, r: number): this {
        const k = PdfLiteContext.K * r;
        this.doc.moveTo(x + r,         y            );
        this.doc.lineTo(x + w - r,     y            );
        this.doc.curveTo(x + w - r + k, y,           x + w, y + r - k,     x + w, y + r    );
        this.doc.lineTo(x + w,         y + h - r    );
        this.doc.curveTo(x + w,        y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        this.doc.lineTo(x + r,         y + h        );
        this.doc.curveTo(x + r - k,    y + h,         x, y + h - r + k,    x, y + h - r   );
        this.doc.lineTo(x,             y + r        );
        this.doc.curveTo(x,            y + r - k,     x + r - k, y,         x + r, y       );
        (this.doc as any).close();
        return this;
    }

    // -------------------------------------------------------------------------
    // Path painting
    // -------------------------------------------------------------------------

    fill(rule?: 'nonzero' | 'evenodd'): this {
        if (rule === 'evenodd' && typeof (this.doc as any).fillEvenOdd === 'function') {
            (this.doc as any).fillEvenOdd();
        } else {
            this.doc.fill();
        }
        return this;
    }

    stroke(): this {
        this.doc.stroke();
        return this;
    }

    fillAndStroke(fillColor?: string, strokeColor?: string): this {
        if (fillColor) {
            const [r, g, b] = parseColor(fillColor);
            this.doc.setFillColor(r, g, b);
        }
        if (strokeColor) {
            const [r, g, b] = parseColor(strokeColor);
            this.doc.setDrawColor(r, g, b);
        }
        this.doc.fillStroke();
        return this;
    }

    // -------------------------------------------------------------------------
    // Text
    // -------------------------------------------------------------------------

    text(str: string, x: number, y: number, options?: ContextTextOptions): this {
        // Apply character spacing if provided.
        const charSpacing = options?.characterSpacing;
        if (charSpacing !== undefined) {
            (this.doc as any).setCharSpace?.(charSpacing);
        }

        const textOpts: Record<string, unknown> = {};
        if (options?.align) textOpts['align'] = options.align;
        // Do NOT pass width as maxWidth — the engine pre-measures every segment;
        // allowing jsPDF to re-wrap would break the layout.

        // Baseline alignment:
        // The engine always supplies `ascent` (0–1000 normalized) on every
        // context.text() call.  jsPDF's default text anchor is the alphabetic
        // baseline (y = baseline), whereas the engine passes y = top of em box.
        // Shift y down by (ascent/1000 * fontSize) to align the baseline.
        const jsPdfY = y + ((options?.ascent ?? 0) / 1000) * this.doc.getFontSize();

        this.doc.text(str, x, jsPdfY, textOpts as any);

        if (charSpacing !== undefined) {
            (this.doc as any).setCharSpace?.(0);
        }
        return this;
    }

    // -------------------------------------------------------------------------
    // Images
    // -------------------------------------------------------------------------

    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this {
        const format = mimeToImageFormat(options?.mimeType);
        const w = options?.width  ?? 0;
        const h = options?.height ?? 0;
        try {
            if (typeof source === 'string') {
                this.doc.addImage(source, format, x, y, w, h);
            } else {
                const base64   = Buffer.from(source).toString('base64');
                const dataUrl  = `data:${options?.mimeType ?? 'image/jpeg'};base64,${base64}`;
                this.doc.addImage(dataUrl, format, x, y, w, h);
            }
        } catch {
            // Image embedding failures are non-fatal for the lite context.
        }
        return this;
    }

    // -------------------------------------------------------------------------
    // Page dimensions
    // -------------------------------------------------------------------------

    getSize(): { width: number; height: number } {
        return { width: this.pageWidth, height: this.pageHeight };
    }
}

export default PdfLiteContext;
