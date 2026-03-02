export interface Context {
    // Document Lifecycle
    addPage(): void;
    end(): void;

    // Font Management
    registerFont(id: string, buffer: Uint8Array): Promise<void>;
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
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    fill(rule?: 'nonzero' | 'evenodd'): this;
    stroke(): this;
    fillAndStroke(fillColor?: string, strokeColor?: string): this;

    // Text
    text(str: string, x: number, y: number, options?: ContextTextOptions): this;
    image(source: string | Uint8Array, x: number, y: number, options?: ContextImageOptions): this;

    // Access to underlying width/height (needed for page numbering/layout helper)
    getSize(): { width: number; height: number };
}

export interface ContextTextOptions {
    width?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    lineBreak?: boolean;
    characterSpacing?: number;
    height?: number; // Sometimes used for bounds
    ascent?: number; // Normalized font ascent (0-1000) for baseline alignment
    link?: string;
}

export interface ContextImageOptions {
    width?: number;
    height?: number;
    mimeType?: string;
}

export type ContextPageSize = 'A4' | 'LETTER' | [number, number] | { width: number; height: number };

export interface ContextFactoryOptions {
    size: ContextPageSize;
    margins: { top: number; left: number; right: number; bottom: number };
    bufferPages: boolean;
    autoFirstPage: boolean;
}
