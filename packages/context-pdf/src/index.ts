import PDFDocument from 'pdfkit';
import { Context, ContextFactoryOptions, ContextImageOptions, ContextTextOptions } from '@vmprint/contracts';
import { Buffer } from 'buffer';
import * as fontkit from 'fontkit';

let patchedEncodeStreamForVariableFonts = false;
type PdfDocumentInitOptions = NonNullable<ConstructorParameters<typeof PDFDocument>[0]>;

const ensureEncodeStreamNumericLengthCompatibility = (): void => {
    if (patchedEncodeStreamForVariableFonts) return;
    patchedEncodeStreamForVariableFonts = true;

    try {
        // fontkit's variable-glyph subset path calls new EncodeStream(number),
        // but newer restructure expects a Uint8Array buffer instance.
        const restructureAny = require('restructure') as any;
        const EncodeStream = restructureAny?.EncodeStream;
        if (typeof EncodeStream !== 'function') return;

        try {
            new EncodeStream(1);
            return;
        } catch {
            // Continue to compatibility patch below.
        }

        Object.defineProperty(restructureAny, 'EncodeStream', {
            value: class EncodeStreamNumericCompat extends EncodeStream {
                constructor(buffer: number | Uint8Array) {
                    super(typeof buffer === 'number' ? new Uint8Array(buffer) : buffer);
                }
            },
            configurable: true,
            enumerable: true,
            writable: true,
        });
    } catch {
        // Best-effort patch; PDF rendering still works for non-variable paths.
    }
};

type PdfValues = string | number | boolean | symbol | object | undefined | null;

// Minimal interface compatible with both Node.js streams and browser implementations like blob-stream
export interface PdfWritableStream {
    write(chunk: any, encoding?: string, callback?: (error?: Error | null) => void): boolean;
    write(chunk: any, cb?: (error?: Error | null) => void): boolean;
    end(cb?: () => void): this;
    end(chunk: any, cb?: () => void): this;
    end(chunk: any, encoding?: string, cb?: () => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    [key: string]: any; // Allow other properties for flexibility
}

export class PdfContext implements Context {
    private doc: InstanceType<typeof PDFDocument>;
    private outputStream: PdfWritableStream | null = null;
    private readonly variableAxisCache = new WeakMap<
        ArrayBufferLike,
        {
            wght?: { min: number; max: number };
            ital?: { min: number; max: number };
            slnt?: { min: number; max: number };
        } | null
    >();

    constructor(outputStreamOrOptions: PdfWritableStream | ContextFactoryOptions, options?: ContextFactoryOptions) {
        ensureEncodeStreamNumericLengthCompatibility();

        let actualOptions: ContextFactoryOptions;
        let outputStream: PdfWritableStream | null = null;

        if (outputStreamOrOptions && typeof (outputStreamOrOptions as PdfWritableStream).write === 'function') {
            outputStream = outputStreamOrOptions as PdfWritableStream;
            actualOptions = options!;
            this.outputStream = outputStream;
        } else {
            actualOptions = outputStreamOrOptions as ContextFactoryOptions;
        }

        this.doc = new PDFDocument({
            autoFirstPage: actualOptions.autoFirstPage,
            bufferPages: actualOptions.bufferPages,
            size: actualOptions.size as PdfDocumentInitOptions['size'],
            margins: actualOptions.margins,
        });

        if (outputStream) {
            this.doc.pipe(outputStream as NodeJS.WritableStream);
        }
    }

    addPage(): void {
        this.doc.addPage();
    }

    pipe(stream: PdfWritableStream): void {
        this.doc.pipe(stream as NodeJS.WritableStream);
    }

    private isEnded: boolean = false;

    end(): void {
        if (this.isEnded) return;
        this.isEnded = true;
        this.doc.end();
    }

    async registerFont(id: string, buffer: Uint8Array): Promise<void> {
        try {
            const variationSettings = this.resolveVariationSettings(id, buffer);
            const source = Buffer.from(buffer);
            if (variationSettings) {
                const loaded = this.preloadVariationFont(source, variationSettings);
                if (loaded) {
                    this.patchVariationGlyphEncoder(loaded);
                    (this.doc as any)._fontFamilies[id] = loaded;
                    return;
                }
            }
            this.doc.registerFont(id, source);
        } catch (e: unknown) {
            throw new Error(`[PdfContext] Failed to register font "${id}": ${String(e)}`);
        }
    }

    private preloadVariationFont(source: Buffer, variationSettings: Record<string, number>): any | null {
        const docAny = this.doc as any;
        const previousFamilies = docAny._fontFamilies;
        const previousFont = docAny._font;
        const previousSource = docAny._fontSource;
        const previousFamily = docAny._fontFamily;

        docAny._fontFamilies = {};
        try {
            docAny.font(source, variationSettings);
            return docAny._font || null;
        } catch {
            return null;
        } finally {
            docAny._fontFamilies = previousFamilies;
            docAny._font = previousFont;
            docAny._fontSource = previousSource;
            docAny._fontFamily = previousFamily;
        }
    }

    private patchVariationGlyphEncoder(loadedFont: any): void {
        const encoder = loadedFont?.subset?.glyphEncoder;
        if (!encoder || typeof encoder.encodeSimple !== 'function') return;
        if ((encoder as any).__vmprintSafeEncodeSimplePatched) return;

        const original = encoder.encodeSimple.bind(encoder);
        const toFiniteNumber = (value: any): number => {
            const n = Number(value);
            return Number.isFinite(n) ? n : 0;
        };

        const sanitizePath = (
            path: any,
        ): {
            commands: Array<{ command: string; args: number[] }>;
            bbox: { minX: number; minY: number; maxX: number; maxY: number };
        } => {
            const commandsSource = Array.isArray(path?.commands) ? path.commands : [];
            const commands = commandsSource.map((command: any) => ({
                command: String(command?.command || ''),
                args: Array.isArray(command?.args) ? command.args.map((arg: any) => toFiniteNumber(arg)) : [],
            }));

            const hasPoints = commands.some((command: { command: string; args: number[] }) => command.args.length > 0);
            const bboxSource = path?.bbox;
            const minX = toFiniteNumber(bboxSource?.minX);
            const minY = toFiniteNumber(bboxSource?.minY);
            const maxX = toFiniteNumber(bboxSource?.maxX);
            const maxY = toFiniteNumber(bboxSource?.maxY);

            if (!hasPoints) {
                return {
                    commands,
                    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
                };
            }

            const normalizedMinX = Math.min(minX, maxX);
            const normalizedMinY = Math.min(minY, maxY);
            const normalizedMaxX = Math.max(minX, maxX);
            const normalizedMaxY = Math.max(minY, maxY);

            return {
                commands,
                bbox: {
                    minX: normalizedMinX,
                    minY: normalizedMinY,
                    maxX: normalizedMaxX,
                    maxY: normalizedMaxY,
                },
            };
        };

        encoder.encodeSimple = (path: any, instructions: number[] = []) => {
            const safePath = sanitizePath(path);
            return original(safePath, instructions);
        };
        (encoder as any).__vmprintSafeEncodeSimplePatched = true;
    }

    private resolveVariationSettings(id: string, buffer: Uint8Array): Record<string, number> | null {
        const variant = this.parseVariantFromId(id);
        if (!variant) return null;

        const axes = this.getVariationAxes(buffer);
        if (!axes) return null;

        const settings: Record<string, number> = {};
        if (axes.wght && Number.isFinite(variant.weight)) {
            settings.wght = Math.min(axes.wght.max, Math.max(axes.wght.min, variant.weight));
        }

        if (variant.style === 'italic') {
            if (axes.ital) {
                settings.ital = Math.min(axes.ital.max, Math.max(axes.ital.min, 1));
            } else if (axes.slnt) {
                const target = axes.slnt.min < 0 ? -10 : 10;
                settings.slnt = Math.min(axes.slnt.max, Math.max(axes.slnt.min, target));
            }
        }

        return Object.keys(settings).length > 0 ? settings : null;
    }

    private getVariationAxes(buffer: Uint8Array): {
        wght?: { min: number; max: number };
        ital?: { min: number; max: number };
        slnt?: { min: number; max: number };
    } | null {
        const cacheKey = buffer.buffer;
        if (this.variableAxisCache.has(cacheKey)) {
            return this.variableAxisCache.get(cacheKey) || null;
        }

        try {
            const font: any = fontkit.create(Buffer.from(buffer));
            const variationAxes = font?.variationAxes;
            if (!variationAxes) {
                this.variableAxisCache.set(cacheKey, null);
                return null;
            }

            const toRange = (axis: any): { min: number; max: number } | undefined => {
                if (!axis) return undefined;
                const min = Number(axis.min);
                const max = Number(axis.max);
                if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
                return {
                    min: Math.min(min, max),
                    max: Math.max(min, max),
                };
            };

            const normalized = {
                wght: toRange(variationAxes.wght),
                ital: toRange(variationAxes.ital),
                slnt: toRange(variationAxes.slnt),
            };

            if (!normalized.wght && !normalized.ital && !normalized.slnt) {
                this.variableAxisCache.set(cacheKey, null);
                return null;
            }

            this.variableAxisCache.set(cacheKey, normalized);
            return normalized;
        } catch {
            this.variableAxisCache.set(cacheKey, null);
            return null;
        }
    }

    private parseVariantFromId(id: string): { weight: number; style: 'normal' | 'italic' } | null {
        const suffixMatch = /-(Regular|Bold|Italic|BoldItalic|W([1-9]00)|ItalicW([1-9]00))$/i.exec(String(id || ''));
        if (!suffixMatch) return null;

        const variant = String(suffixMatch[1] || '').toLowerCase();
        if (variant === 'regular') return { weight: 400, style: 'normal' };
        if (variant === 'bold') return { weight: 700, style: 'normal' };
        if (variant === 'italic') return { weight: 400, style: 'italic' };
        if (variant === 'bolditalic') return { weight: 700, style: 'italic' };

        if (variant.startsWith('italicw')) {
            const parsed = Number(variant.slice('italicw'.length));
            if (Number.isFinite(parsed)) return { weight: parsed, style: 'italic' };
            return null;
        }

        if (variant.startsWith('w')) {
            const parsed = Number(variant.slice(1));
            if (Number.isFinite(parsed)) return { weight: parsed, style: 'normal' };
        }

        return null;
    }

    font(family: string, size?: number): this {
        this.doc.font(family);
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

    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this {
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
        let opts: ContextTextOptions | undefined = options;
        const ascent = Number(options?.ascent);
        if (Number.isFinite(ascent)) {
            const docAny = this.doc as any;
            const fontSize = Number(docAny?._fontSize) || 12;
            const baselinePx = (ascent / 1000) * fontSize;
            opts = { ...(options || {}), baseline: -baselinePx } as any;
        }

        this.doc.text(str, x, y, opts as any);
        return this;
    }

    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this {
        const imageSource = typeof source === 'string' ? source : Buffer.from(source);
        this.doc.image(imageSource as any, x, y, {
            width: options?.width,
            height: options?.height,
        });
        return this;
    }

    getSize(): { width: number; height: number } {
        const { width, height } = this.doc.page;
        return { width, height };
    }

    waitForFinish(): Promise<void> {
        const documentDone = new Promise<void>((resolve, reject) => {
            this.doc.once('end', resolve);
            this.doc.once('error', reject);
        });

        const stream = this.outputStream as any;
        if (!stream) {
            return documentDone;
        }

        const streamDone = new Promise<void>((resolve, reject) => {
            const finishNow = stream?.writableFinished === true;
            if (finishNow) {
                resolve();
                return;
            }

            const done = () => resolve();
            stream.once('finish', done);
            stream.once('error', reject);
        });

        return Promise.all([documentDone, streamDone]).then(() => undefined);
    }
}

export default PdfContext;
