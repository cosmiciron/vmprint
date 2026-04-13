export interface VmprintOutputStream {
    write(chunk: Uint8Array | string): void;
    end(): void;
    waitForFinish(): Promise<void>;
}

export interface Context {
    addPage(): void;
    end(): void;
    pipe(stream: VmprintOutputStream): void;
    registerFont(id: string, buffer: Uint8Array, options?: ContextFontRegistrationOptions): Promise<void>;
    font(family: string, size?: number): this;
    fontSize(size: number): this;
    save(): void;
    restore(): void;
    translate(x: number, y: number): this;
    rotate(angle: number, originX?: number, originY?: number): this;
    opacity(opacity: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    dash(length: number, options?: { space: number }): this;
    undash(): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    bezierCurveTo(
        cp1x: number,
        cp1y: number,
        cp2x: number,
        cp2y: number,
        x: number,
        y: number
    ): this;
    circle(x: number, y: number, r: number): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    clip(rule?: 'nonzero' | 'evenodd'): this;
    fill(rule?: 'nonzero' | 'evenodd'): this;
    stroke(): this;
    fillAndStroke(fillColor?: string, strokeColor?: string): this;
    text(str: string, x: number, y: number, options?: ContextTextOptions): this;
    showShapedGlyphs(
        fontId: string,
        fontSize: number,
        color: string,
        x: number,
        y: number,
        ascent: number,
        glyphs: ContextShapedGlyph[]
    ): this;
    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this;
    getSize(): { width: number; height: number };
}

export interface ContextShapedGlyph {
    id: number;
    codePoints: number[];
    xAdvance: number;
    xOffset: number;
    yOffset: number;
}

export interface ContextFontRegistrationOptions {
    standardFontPostScriptName?: string;
}

export interface ContextTextOptions {
    width?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    lineBreak?: boolean;
    characterSpacing?: number;
    height?: number;
    ascent: number;
    link?: string;
}

export interface ContextImageOptions {
    width?: number;
    height?: number;
    mimeType?: string;
}

export type ContextPageSize =
    | 'A4'
    | 'LETTER'
    | [number, number]
    | { width: number; height: number };

export interface ContextFactoryOptions {
    size: ContextPageSize;
    margins: { top: number; left: number; right: number; bottom: number };
    bufferPages: boolean;
    autoFirstPage: boolean;
}
