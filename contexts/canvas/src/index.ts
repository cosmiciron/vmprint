import * as fontkit from 'fontkit';
import { Buffer } from 'buffer';
import {
    Context,
    ContextFactoryOptions,
    ContextFontRegistrationOptions,
    ContextImageOptions,
    ContextShapedGlyph,
    ContextTextOptions,
    VmprintOutputStream
} from '@vmprint/contracts';

type Matrix = [number, number, number, number, number, number];
type PathCommand =
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'C'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
    | { type: 'Z' };

type GraphicsState = {
    fontId: string | null;
    fontSize: number;
    fillColor: string;
    strokeColor: string;
    lineWidth: number;
    opacity: number;
    dash: { length: number; space: number } | null;
    matrix: Matrix;
};

type RegisteredFont = {
    id: string;
    familyName: string;
    standardFontPostScriptName?: string;
    embeddedCssSrc?: string;
    font?: any;
    unitsPerEm?: number;
};

type CanvasTarget =
    | HTMLCanvasElement
    | OffscreenCanvas
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;

type RenderPageOptions = {
    scale?: number;
    dpi?: number;
    clear?: boolean;
    backgroundColor?: string;
};

type PageScene = {
    nodes: string[];
};

const identityMatrix = (): Matrix => [1, 0, 0, 1, 0, 0];

const multiplyMatrix = (left: Matrix, right: Matrix): Matrix => ([
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5]
]);

const matrixToSvg = (matrix: Matrix): string =>
    `matrix(${matrix[0]} ${matrix[1]} ${matrix[2]} ${matrix[3]} ${matrix[4]} ${matrix[5]})`;

const escapeXml = (value: string): string => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const pathCommandsToSvg = (commands: PathCommand[]): string => commands.map((command) => {
    switch (command.type) {
        case 'M': return `M ${command.x} ${command.y}`;
        case 'L': return `L ${command.x} ${command.y}`;
        case 'C': return `C ${command.cp1x} ${command.cp1y} ${command.cp2x} ${command.cp2y} ${command.x} ${command.y}`;
        case 'Z': return 'Z';
    }
}).join(' ');

const cssColorOrDefault = (value: string | undefined, fallback: string): string => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const imageMimeType = (options?: ContextImageOptions, source?: string | Uint8Array): string => {
    if (options?.mimeType) return options.mimeType;
    if (typeof source === 'string') {
        const match = /^data:([^;,]+)[;,]/i.exec(source);
        if (match) return match[1];
    }
    return 'image/png';
};

const toImageHref = (source: string | Uint8Array, mimeType: string): string => {
    if (typeof source === 'string') return source;
    return `data:${mimeType};base64,${Buffer.from(source).toString('base64')}`;
};

const contextBaselineY = (topY: number, ascent: number, fontSize: number): number =>
    topY + ((ascent || 0) / 1000) * fontSize;

const normalizeFamilyName = (fontId: string, standardFontPostScriptName?: string): string =>
    standardFontPostScriptName || fontId;

const ensureBrowserImageApis = (): void => {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof Image === 'undefined') {
        throw new Error('[CanvasContext] Canvas rasterization helpers require browser Blob, URL, and Image APIs.');
    }
};

const targetToCanvasAndContext = (target: CanvasTarget): { canvas: HTMLCanvasElement | OffscreenCanvas; context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } => {
    if ('canvas' in target) {
        return { canvas: target.canvas as HTMLCanvasElement | OffscreenCanvas, context: target };
    }
    const context = target.getContext('2d');
    if (!context) {
        throw new Error('[CanvasContext] Failed to obtain a 2D rendering context.');
    }
    return { canvas: target, context };
};

const defaultRasterDpi = (): number => {
    if (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0) {
        return 72 * window.devicePixelRatio;
    }
    return 72;
};

export class CanvasContext implements Context {
    private readonly pageWidth: number;
    private readonly pageHeight: number;
    private readonly fonts = new Map<string, RegisteredFont>();
    private readonly pages: PageScene[] = [];
    private readonly svgCache = new Map<number, string>();
    private readonly pageImageCache = new Map<number, Promise<HTMLImageElement>>();
    private readonly stateStack: GraphicsState[] = [];
    private currentState: GraphicsState = {
        fontId: null,
        fontSize: 12,
        fillColor: '#000000',
        strokeColor: '#000000',
        lineWidth: 1,
        opacity: 1,
        dash: null,
        matrix: identityMatrix()
    };
    private currentPath: PathCommand[] = [];
    private currentPageIndex = -1;
    private isEnded = false;

    constructor(options: ContextFactoryOptions) {
        const size = Array.isArray(options.size)
            ? { width: options.size[0], height: options.size[1] }
            : typeof options.size === 'string'
                ? (options.size === 'A4' ? { width: 595.28, height: 841.89 } : { width: 612, height: 792 })
                : options.size;
        this.pageWidth = size.width;
        this.pageHeight = size.height;
        if (options.autoFirstPage) {
            this.addPage();
        }
    }

    addPage(): void {
        this.pages.push({ nodes: [] });
        this.currentPageIndex = this.pages.length - 1;
        this.currentPath = [];
        this.markPageDirty(this.currentPageIndex);
    }

    end(): void {
        this.isEnded = true;
    }

    pipe(_stream: VmprintOutputStream): void {
        // No-op: the canvas context is an in-memory display artifact producer.
    }

    async registerFont(id: string, buffer: Uint8Array, options?: ContextFontRegistrationOptions): Promise<void> {
        const familyName = normalizeFamilyName(id, options?.standardFontPostScriptName);
        if (options?.standardFontPostScriptName) {
            this.fonts.set(id, {
                id,
                familyName,
                standardFontPostScriptName: options.standardFontPostScriptName
            });
            this.markAllPagesDirty();
            return;
        }

        const mimeType = 'font/ttf';
        const embeddedCssSrc = `url(data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}) format("truetype")`;
        const parsedFont = fontkit.create(Buffer.from(buffer));
        this.fonts.set(id, {
            id,
            familyName,
            embeddedCssSrc,
            font: parsedFont,
            unitsPerEm: Number(parsedFont?.unitsPerEm || 1000)
        });
        this.markAllPagesDirty();
    }

    font(family: string, size?: number): this {
        this.currentState.fontId = family;
        if (size !== undefined) this.currentState.fontSize = size;
        return this;
    }

    fontSize(size: number): this {
        this.currentState.fontSize = size;
        return this;
    }

    save(): void {
        this.stateStack.push({
            ...this.currentState,
            dash: this.currentState.dash ? { ...this.currentState.dash } : null,
            matrix: [...this.currentState.matrix] as Matrix
        });
    }

    restore(): void {
        const restored = this.stateStack.pop();
        if (restored) this.currentState = restored;
    }

    translate(x: number, y: number): this {
        this.currentState.matrix = multiplyMatrix(this.currentState.matrix, [1, 0, 0, 1, x, y]);
        return this;
    }

    rotate(angle: number, originX?: number, originY?: number): this {
        const radians = (angle * Math.PI) / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const ox = Number(originX || 0);
        const oy = Number(originY || 0);
        this.currentState.matrix = multiplyMatrix(
            this.currentState.matrix,
            [1, 0, 0, 1, ox, oy]
        );
        this.currentState.matrix = multiplyMatrix(
            this.currentState.matrix,
            [cos, sin, -sin, cos, 0, 0]
        );
        this.currentState.matrix = multiplyMatrix(
            this.currentState.matrix,
            [1, 0, 0, 1, -ox, -oy]
        );
        return this;
    }

    opacity(opacity: number): this {
        this.currentState.opacity = opacity;
        return this;
    }

    fillColor(color: string): this {
        this.currentState.fillColor = color;
        return this;
    }

    strokeColor(color: string): this {
        this.currentState.strokeColor = color;
        return this;
    }

    lineWidth(width: number): this {
        this.currentState.lineWidth = width;
        return this;
    }

    dash(length: number, options?: { space: number }): this {
        this.currentState.dash = { length, space: options?.space ?? length };
        return this;
    }

    undash(): this {
        this.currentState.dash = null;
        return this;
    }

    moveTo(x: number, y: number): this {
        this.currentPath.push({ type: 'M', x, y });
        return this;
    }

    lineTo(x: number, y: number): this {
        this.currentPath.push({ type: 'L', x, y });
        return this;
    }

    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this {
        this.currentPath.push({ type: 'C', cp1x, cp1y, cp2x, cp2y, x, y });
        return this;
    }

    rect(x: number, y: number, w: number, h: number): this {
        this.currentPath.push({ type: 'M', x, y });
        this.currentPath.push({ type: 'L', x: x + w, y });
        this.currentPath.push({ type: 'L', x: x + w, y: y + h });
        this.currentPath.push({ type: 'L', x, y: y + h });
        this.currentPath.push({ type: 'Z' });
        return this;
    }

    roundedRect(x: number, y: number, w: number, h: number, r: number): this {
        const k = 0.5522848 * r;
        this.currentPath.push({ type: 'M', x: x + r, y });
        this.currentPath.push({ type: 'L', x: x + w - r, y });
        this.currentPath.push({ type: 'C', cp1x: x + w - r + k, cp1y: y, cp2x: x + w, cp2y: y + r - k, x: x + w, y: y + r });
        this.currentPath.push({ type: 'L', x: x + w, y: y + h - r });
        this.currentPath.push({ type: 'C', cp1x: x + w, cp1y: y + h - r + k, cp2x: x + w - r + k, cp2y: y + h, x: x + w - r, y: y + h });
        this.currentPath.push({ type: 'L', x: x + r, y: y + h });
        this.currentPath.push({ type: 'C', cp1x: x + r - k, cp1y: y + h, cp2x: x, cp2y: y + h - r + k, x, y: y + h - r });
        this.currentPath.push({ type: 'L', x, y: y + r });
        this.currentPath.push({ type: 'C', cp1x: x, cp1y: y + r - k, cp2x: x + r - k, cp2y: y, x: x + r, y });
        this.currentPath.push({ type: 'Z' });
        return this;
    }

    fill(rule?: 'nonzero' | 'evenodd'): this {
        this.flushPath({
            fill: this.currentState.fillColor,
            stroke: 'none',
            fillRule: rule || 'nonzero'
        });
        return this;
    }

    stroke(): this {
        this.flushPath({
            fill: 'none',
            stroke: this.currentState.strokeColor
        });
        return this;
    }

    fillAndStroke(fillColor?: string, strokeColor?: string): this {
        this.flushPath({
            fill: fillColor || this.currentState.fillColor,
            stroke: strokeColor || this.currentState.strokeColor
        });
        return this;
    }

    text(str: string, x: number, y: number, options?: ContextTextOptions): this {
        const page = this.requireCurrentPage();
        this.markPageDirty(this.currentPageIndex);
        const fontId = this.currentState.fontId;
        const font = fontId ? this.fonts.get(fontId) : null;
        const baselineY = contextBaselineY(y, Number(options?.ascent || 0), this.currentState.fontSize);
        const transformAttr = ` transform="${matrixToSvg(this.currentState.matrix)}"`;
        const opacityAttr = this.currentState.opacity !== 1 ? ` opacity="${this.currentState.opacity}"` : '';
        const letterSpacingAttr = options?.characterSpacing ? ` letter-spacing="${options.characterSpacing}"` : '';
        const style = [
            `fill:${cssColorOrDefault(this.currentState.fillColor, '#000000')}`,
            `font-family:${escapeXml(font?.familyName || fontId || 'sans-serif')}`,
            `font-size:${this.currentState.fontSize}px`,
            'white-space:pre'
        ].join(';');
        page.nodes.push(
            `<text x="${x}" y="${baselineY}"${transformAttr}${opacityAttr}${letterSpacingAttr} style="${style}" xml:space="preserve">${escapeXml(str)}</text>`
        );
        return this;
    }

    showShapedGlyphs(fontId: string, fontSize: number, color: string, x: number, y: number, ascent: number, glyphs: ContextShapedGlyph[]): this {
        if (!glyphs || glyphs.length === 0) return this;
        const font = this.fonts.get(fontId);
        if (!font?.font || !font.unitsPerEm) {
            const fallbackText = glyphs
                .flatMap((glyph) => glyph.codePoints || [])
                .filter((codePoint) => Number.isFinite(codePoint) && codePoint > 0)
                .map((codePoint) => String.fromCodePoint(codePoint))
                .join('');
            if (fallbackText) {
                this.font(fontId, fontSize);
                this.fillColor(color);
                this.text(fallbackText, x, y, { ascent, lineBreak: false });
            }
            return this;
        }

        const page = this.requireCurrentPage();
        this.markPageDirty(this.currentPageIndex);
        const baselineY = contextBaselineY(y, ascent, fontSize);
        const baseMatrix = this.currentState.matrix;
        const upm = font.unitsPerEm;
        const scale = fontSize / upm;
        let penX = 0;

        for (const shapedGlyph of glyphs) {
            const glyph = font.font.getGlyph(shapedGlyph.id);
            if (!glyph?.path) {
                penX += shapedGlyph.xAdvance || 0;
                continue;
            }
            const pathData = glyph.path.toSVG();
            const glyphMatrix = multiplyMatrix(
                baseMatrix,
                [
                    scale,
                    0,
                    0,
                    -scale,
                    x + penX + (shapedGlyph.xOffset || 0),
                    baselineY - (shapedGlyph.yOffset || 0)
                ]
            );
            const opacityAttr = this.currentState.opacity !== 1 ? ` opacity="${this.currentState.opacity}"` : '';
            page.nodes.push(
                `<path d="${pathData}" transform="${matrixToSvg(glyphMatrix)}" fill="${escapeXml(color)}"${opacityAttr} />`
            );
            penX += shapedGlyph.xAdvance || 0;
        }

        return this;
    }

    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this {
        const page = this.requireCurrentPage();
        this.markPageDirty(this.currentPageIndex);
        const href = toImageHref(source, imageMimeType(options, source));
        const width = Number(options?.width || 0);
        const height = Number(options?.height || 0);
        const transformAttr = ` transform="${matrixToSvg(this.currentState.matrix)}"`;
        const opacityAttr = this.currentState.opacity !== 1 ? ` opacity="${this.currentState.opacity}"` : '';
        page.nodes.push(
            `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeXml(href)}"${transformAttr}${opacityAttr} />`
        );
        return this;
    }

    getSize(): { width: number; height: number } {
        return { width: this.pageWidth, height: this.pageHeight };
    }

    getPageCount(): number {
        return this.pages.length;
    }

    toSvgString(pageIndex: number): string {
        const cached = this.svgCache.get(pageIndex);
        if (cached) {
            return cached;
        }
        const page = this.pages[pageIndex];
        if (!page) {
            throw new Error(`[CanvasContext] Page ${pageIndex} does not exist.`);
        }
        const fontFaces = Array.from(this.fonts.values())
            .filter((font) => !!font.embeddedCssSrc)
            .map((font) => `@font-face{font-family:"${escapeXml(font.familyName)}";src:${font.embeddedCssSrc};}`)
            .join('');
        const svg = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<svg xmlns="http://www.w3.org/2000/svg" width="${this.pageWidth}" height="${this.pageHeight}" viewBox="0 0 ${this.pageWidth} ${this.pageHeight}">`,
            '<defs>',
            fontFaces ? `<style>${fontFaces}</style>` : '',
            '</defs>',
            ...page.nodes,
            '</svg>'
        ].join('');
        this.svgCache.set(pageIndex, svg);
        return svg;
    }

    toSvgPages(): string[] {
        return this.pages.map((_, index) => this.toSvgString(index));
    }

    async renderPageToCanvas(pageIndex: number, target: CanvasTarget, options: RenderPageOptions = {}): Promise<void> {
        ensureBrowserImageApis();
        const { canvas, context } = targetToCanvasAndContext(target);
        const scale = Number(options.scale || 1);
        const dpi = Number(options.dpi || defaultRasterDpi());
        const rasterScale = scale * (dpi / 72);
        const logicalWidth = Math.max(1, this.pageWidth * scale);
        const logicalHeight = Math.max(1, this.pageHeight * scale);
        const width = Math.max(1, Math.round(this.pageWidth * rasterScale));
        const height = Math.max(1, Math.round(this.pageHeight * rasterScale));
        (canvas as HTMLCanvasElement | OffscreenCanvas).width = width;
        (canvas as HTMLCanvasElement | OffscreenCanvas).height = height;
        if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
            canvas.style.width = `${logicalWidth}px`;
            canvas.style.height = 'auto';
        }

        if (options.clear !== false) {
            context.clearRect(0, 0, width, height);
        }
        if (options.backgroundColor) {
            context.save();
            context.fillStyle = options.backgroundColor;
            context.fillRect(0, 0, width, height);
            context.restore();
        }

        const image = await this.getPageImage(pageIndex);
        context.drawImage(image, 0, 0, width, height);
    }

    async renderAllPagesToCanvases(factory: (pageIndex: number, size: { width: number; height: number }) => CanvasTarget, options: RenderPageOptions = {}): Promise<void> {
        for (let pageIndex = 0; pageIndex < this.pages.length; pageIndex++) {
            const target = factory(pageIndex, { width: this.pageWidth, height: this.pageHeight });
            await this.renderPageToCanvas(pageIndex, target, options);
        }
    }

    private async loadImage(url: string): Promise<HTMLImageElement> {
        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`[CanvasContext] Failed to load SVG page image from "${url}".`));
            image.src = url;
        });
    }

    private async getPageImage(pageIndex: number): Promise<HTMLImageElement> {
        const cached = this.pageImageCache.get(pageIndex);
        if (cached) {
            return await cached;
        }

        const imagePromise = this.loadImageFromSvg(this.toSvgString(pageIndex));
        this.pageImageCache.set(pageIndex, imagePromise);

        try {
            return await imagePromise;
        } catch (error) {
            this.pageImageCache.delete(pageIndex);
            throw error;
        }
    }

    private async loadImageFromSvg(svg: string): Promise<HTMLImageElement> {
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        try {
            return await this.loadImage(url);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private flushPath(options: { fill: string; stroke: string; fillRule?: 'nonzero' | 'evenodd' }): void {
        if (this.currentPath.length === 0) return;
        const page = this.requireCurrentPage();
        this.markPageDirty(this.currentPageIndex);
        const dashAttr = this.currentState.dash
            ? ` stroke-dasharray="${this.currentState.dash.length} ${this.currentState.dash.space}"`
            : '';
        const opacityAttr = this.currentState.opacity !== 1 ? ` opacity="${this.currentState.opacity}"` : '';
        const fillRuleAttr = options.fillRule ? ` fill-rule="${options.fillRule}"` : '';
        page.nodes.push(
            `<path d="${pathCommandsToSvg(this.currentPath)}" transform="${matrixToSvg(this.currentState.matrix)}" fill="${escapeXml(options.fill)}" stroke="${escapeXml(options.stroke)}" stroke-width="${this.currentState.lineWidth}"${dashAttr}${opacityAttr}${fillRuleAttr} />`
        );
        this.currentPath = [];
    }

    private requireCurrentPage(): PageScene {
        if (this.currentPageIndex < 0) {
            this.addPage();
        }
        const page = this.pages[this.currentPageIndex];
        if (!page) {
            throw new Error('[CanvasContext] No active page is available.');
        }
        return page;
    }

    private markPageDirty(pageIndex: number): void {
        if (pageIndex < 0) return;
        this.svgCache.delete(pageIndex);
        this.pageImageCache.delete(pageIndex);
    }

    private markAllPagesDirty(): void {
        this.svgCache.clear();
        this.pageImageCache.clear();
    }
}

export type {
    CanvasTarget,
    RenderPageOptions
};

export default CanvasContext;
