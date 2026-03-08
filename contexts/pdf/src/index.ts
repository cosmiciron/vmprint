import PDFDocument from 'pdfkit';
import {
    Context,
    ContextFactoryOptions,
    ContextFontRegistrationOptions,
    ContextImageOptions,
    ContextTextOptions,
    VmprintOutputStream
} from '@vmprint/contracts';
import { Buffer } from 'buffer';
type PdfDocumentInitOptions = NonNullable<ConstructorParameters<typeof PDFDocument>[0]>;

type PdfValues = string | number | boolean | symbol | object | undefined | null;

export class PdfContext implements Context {
    private doc: InstanceType<typeof PDFDocument>;
    private readonly standardFontAliasById = new Map<string, string>();

    constructor(options: ContextFactoryOptions) {
        this.doc = new PDFDocument({
            autoFirstPage: options.autoFirstPage,
            bufferPages: options.bufferPages,
            size: options.size as PdfDocumentInitOptions['size'],
            margins: options.margins
        });
    }

    addPage(): void {
        this.doc.addPage();
    }

    pipe(stream: VmprintOutputStream): void {
        // Bridge PDFKit's readable stream events to the abstract VmprintOutputStream.
        // PDFKit emits 'data' chunks as pages are rendered and 'end' when complete.
        (this.doc as any).on('data', (chunk: Uint8Array) => stream.write(chunk));
        (this.doc as any).on('end', () => stream.end());
    }

    private isEnded: boolean = false;

    end(): void {
        if (this.isEnded) return;
        this.isEnded = true;
        this.doc.end();
    }

    async registerFont(id: string, buffer: Uint8Array, options?: ContextFontRegistrationOptions): Promise<void> {
        if (options?.standardFontPostScriptName) {
            this.standardFontAliasById.set(id, options.standardFontPostScriptName);
            return;
        }
        this.standardFontAliasById.delete(id);

        try {
            this.doc.registerFont(id, Buffer.from(buffer));
        } catch (e: unknown) {
            throw new Error(`[PdfContext] Failed to register font "${id}": ${String(e)}`);
        }
    }

    font(family: string, size?: number): this {
        this.doc.font(this.standardFontAliasById.get(family) || family);
        if (size !== undefined) {
            this.doc.fontSize(size);
        }
        return this;
    }

    fontSize(size: number): this {
        this.doc.fontSize(size);
        return this;
    }

    save(): void {
        this.doc.save();
    }

    restore(): void {
        this.doc.restore();
    }

    translate(x: number, y: number): this {
        this.doc.translate(x, y);
        return this;
    }

    rotate(angle: number, originX?: number, originY?: number): this {
        if (Number.isFinite(originX) && Number.isFinite(originY)) {
            this.doc.rotate(angle, { origin: [Number(originX), Number(originY)] });
        } else {
            this.doc.rotate(angle);
        }
        return this;
    }

    opacity(opacity: number): this {
        this.doc.opacity(opacity);
        return this;
    }

    fillColor(color: string): this {
        this.doc.fillColor(color);
        return this;
    }

    strokeColor(color: string): this {
        this.doc.strokeColor(color);
        return this;
    }

    lineWidth(width: number): this {
        this.doc.lineWidth(width);
        return this;
    }

    dash(length: number, options?: { space: number }): this {
        this.doc.dash(length, options);
        return this;
    }

    undash(): this {
        this.doc.undash();
        return this;
    }

    moveTo(x: number, y: number): this {
        this.doc.moveTo(x, y);
        return this;
    }

    lineTo(x: number, y: number): this {
        this.doc.lineTo(x, y);
        return this;
    }

    bezierCurveTo(
        cp1x: number,
        cp1y: number,
        cp2x: number,
        cp2y: number,
        x: number,
        y: number
    ): this {
        this.doc.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        return this;
    }

    rect(x: number, y: number, w: number, h: number): this {
        this.doc.rect(x, y, w, h);
        return this;
    }

    roundedRect(x: number, y: number, w: number, h: number, r: number): this {
        this.doc.roundedRect(x, y, w, h, r);
        return this;
    }

    fill(rule?: 'nonzero' | 'evenodd'): this {
        this.doc.fill(rule);
        return this;
    }

    stroke(): this {
        this.doc.stroke();
        return this;
    }

    fillAndStroke(fillColor?: string, strokeColor?: string): this {
        if (fillColor && strokeColor) {
            this.doc.fillAndStroke(fillColor, strokeColor);
        } else if (fillColor) {
            this.doc.fill(fillColor);
        } else if (strokeColor) {
            this.doc.stroke(strokeColor);
        }
        return this;
    }

    text(str: string, x: number, y: number, options?: ContextTextOptions): this {
        const docAny = this.doc as any;
        const fontSize = Number(docAny?._fontSize) || 12;
        const baselinePx = ((options?.ascent ?? 0) / 1000) * fontSize;
        const opts = { ...(options || {}), baseline: -baselinePx } as any;
        this.doc.text(str, x, y, opts);
        return this;
    }

    showShapedGlyphs(
        fontId: string,
        fontSize: number,
        color: string,
        x: number,
        y: number,
        ascent: number,
        glyphs: import('@vmprint/contracts').ContextShapedGlyph[]
    ): this {
        if (!glyphs || glyphs.length === 0) return this;

        // Set font and fill color OUTSIDE the BT/ET block (PDF spec requirement).
        this.font(fontId, fontSize);
        this.fillColor(color);

        const docAny = this.doc as any;
        const pdfFont = docAny._font as any;
        if (!pdfFont || typeof pdfFont.subset?.includeGlyph !== 'function') {
            // Fallback: reconstruct Unicode string and use normal text() path.
            // This won't produce correctly shaped Arabic glyphs, but won't crash.
            const fallbackText = glyphs
                .flatMap(g => g.codePoints)
                .filter(cp => cp > 0)
                .map(cp => String.fromCodePoint(cp))
                .join('');
            if (fallbackText) {
                const baselinePx = (ascent / 1000) * fontSize;
                this.doc.text(fallbackText, x, y, { lineBreak: false, baseline: -baselinePx } as any);
            }
            return this;
        }

        // Convert each fontkit glyph ID into a PDFKit subset ID and hex string.
        // This mirrors EmbeddedFont.encode() but uses our pre-computed shaped IDs
        // instead of re-running font.layout() (which would lose contextual forms).
        const upm = pdfFont.font?.unitsPerEm || 1000;
        const hexPairs: string[] = [];
        const actualAdvances: number[] = [];
        const defaultAdvances: number[] = [];
        const xOffsets: number[] = [];
        const yOffsets: number[] = [];

        for (const sg of glyphs) {
            const fkGlyph = pdfFont.font?.getGlyph(sg.id);
            if (!fkGlyph) continue;

            const subsetId = pdfFont.subset.includeGlyph(sg.id);
            hexPairs.push(`0000${subsetId.toString(16)}`.slice(-4));

            // Register advance width in the PDF widths array (required for PDF spec).
            if (pdfFont.widths[subsetId] == null) {
                pdfFont.widths[subsetId] = (fkGlyph.advanceWidth || 0) * (1000 / upm);
            }
            // Register ToUnicode mapping so PDF readers can extract/copy text correctly.
            // Always populate unicode[subsetId] — even with an empty array for glyphs that have
            // no Unicode mapping (ligature components, marks, etc.). Leaving it undefined creates
            // a sparse-array hole that causes `for...of` in pdfkit's toUnicodeCmap() to receive
            // `undefined` and throw "TypeError: codePoints is not iterable".
            if (pdfFont.unicode[subsetId] == null) {
                pdfFont.unicode[subsetId] = sg.codePoints.length > 0 ? sg.codePoints : [];
            }

            actualAdvances.push(sg.xAdvance);
            xOffsets.push(sg.xOffset || 0);
            yOffsets.push(sg.yOffset || 0);
            // Default glyph advance in PDF user-space points (no GPOS adjustment)
            defaultAdvances.push((fkGlyph.advanceWidth || 0) * (fontSize / upm));
        }

        if (hexPairs.length === 0) return this;

        // Compute baseline Y, mirroring pdfkit's _fragment convention exactly:
        //   - pdfkit applies a local Y-flip CTM: transform(1, 0, 0, -1, 0, H)
        //   - then sets Tm y as:  y_tm = H - y_input - dy  (where dy = ascender in pts)
        // We replicate this inside our own save/restore so the flip doesn't leak.
        const baselinePx = (ascent / 1000) * fontSize;
        const H = docAny.page.height as number;
        const y_tm = H - y - baselinePx;
        const hasPositionOffsets = xOffsets.some(v => Math.abs(v) > 0.01) || yOffsets.some(v => Math.abs(v) > 0.01);

        // Build TJ array: sequence of <hexGlyphId> entries with optional numeric kerning
        // adjustments between glyphs. TJ positive numbers shift the pen LEFT (i.e., they
        // REDUCE the advance), so to achieve our measured advance, we emit:
        //   adjustment = (defaultAdvance - measuredAdvance) * (1000 / fontSize)
        const num = (n: number) => Math.round(n * 100) / 100;
        const tjParts: string[] = [];
        for (let i = 0; i < hexPairs.length; i++) {
            tjParts.push(`<${hexPairs[i]}>`);
            // Only add adjustment between glyphs (not after the last one).
            if (i < hexPairs.length - 1) {
                const diff = (defaultAdvances[i] - actualAdvances[i]) * (1000 / fontSize);
                if (Math.abs(diff) > 0.5) {
                    tjParts.push(`${num(diff)}`);
                }
            }
        }

        // Register the font in the current page's resource dictionary. pdfkit only does this
        // inside its own _fragment path; since we bypass that path we must do it explicitly.
        if (docAny.page?.fonts && pdfFont.id != null) {
            docAny.page.fonts[pdfFont.id] = pdfFont.ref();
        }

        // Emit the PDF text stream, replicating pdfkit's _fragment coordinate handling:
        //   save → Y-flip CTM → BT → Tm/Tf/Tj/TJ → ET → restore
        docAny.save();
        docAny.transform(1, 0, 0, -1, 0, H);   // local Y-flip, matches pdfkit's _fragment
        docAny.addContent('BT');
        docAny.addContent(`/${pdfFont.id} ${num(fontSize)} Tf`);
        docAny.addContent('0 Tr');

        if (!hasPositionOffsets) {
            docAny.addContent(`1 0 0 1 ${num(x)} ${num(y_tm)} Tm`);
            docAny.addContent(`[${tjParts.join(' ')}] TJ`);
        } else {
            // When a run has non-zero x/y offsets (marks/GPOS), place each glyph
            // individually so offsets are preserved exactly.
            let penX = 0;
            for (let i = 0; i < hexPairs.length; i++) {
                const gx = x + penX + xOffsets[i];
                // yOffset uses top-left user coordinates; with local Y-flip we subtract.
                const gy = y_tm - yOffsets[i];
                docAny.addContent(`1 0 0 1 ${num(gx)} ${num(gy)} Tm`);
                docAny.addContent(`<${hexPairs[i]}> Tj`);
                penX += actualAdvances[i];
            }
        }

        docAny.addContent('ET');
        docAny.restore();

        return this;
    }

    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this {
        const imageSource = typeof source === 'string' ? source : Buffer.from(source);
        this.doc.image(imageSource as any, x, y, {
            width: options?.width,
            height: options?.height
        });
        return this;
    }

    getSize(): { width: number; height: number } {
        const { width, height } = this.doc.page;
        return { width, height };
    }

}


export default PdfContext;
