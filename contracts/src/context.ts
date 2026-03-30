/**
 * A minimal, portable output stream that a Context can write rendered output into.
 * Implementations are provided by the caller (e.g. the CLI), keeping I/O concerns
 * out of the context itself. A context that does not support streaming may implement
 * pipe() as a no-op.
 */
export interface VmprintOutputStream {
    write(chunk: Uint8Array | string): void;
    end(): void;
    waitForFinish(): Promise<void>;
}

export interface Context {
    // Document Lifecycle
    addPage(): void;
    end(): void;

    // Output - just return no-op if streaming is not supported by this context.
    pipe(stream: VmprintOutputStream): void;

    // Font Management
    registerFont(id: string, buffer: Uint8Array, options?: ContextFontRegistrationOptions): Promise<void>;
    font(family: string, size?: number): this;
    fontSize(size: number): this;

    // Drawing Context
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

    // Shapes
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

    // Text
    text(str: string, x: number, y: number, options?: ContextTextOptions): this;
    /**
     * Emit pre-shaped glyphs directly to the PDF stream using their fontkit glyph IDs.
     * This bypasses PDFKit's text()/encode() path, which would re-run shaping and lose the
     * contextual glyph substitutions (init/medi/fina/liga) computed at layout time.
     * Required for correct rendering of Arabic and other RTL/CTL scripts.
     */
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

    // Access to underlying width/height (needed for page numbering/layout helper)
    getSize(): { width: number; height: number };
}

export interface ContextShapedGlyph {
    /** Fontkit-assigned glyph ID for the shaped contextual form (e.g. uni0627.fina = id 9). */
    id: number;
    /** Unicode codepoints (for ToUnicode CMap, used by PDF text extraction / copy-paste). */
    codePoints: number[];
    /** Advance width in points (scaled). */
    xAdvance: number;
    /** Horizontal offset in points (for positioned GPOS kerning etc.). */
    xOffset: number;
    /** Vertical offset in points. */
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
    height?: number; // Sometimes used for bounds
    /** Normalized font ascent (0–1000 units). Required — the engine must always supply this so
     * every context backend can accurately position text regardless of its own text-anchor
     * convention. */
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
