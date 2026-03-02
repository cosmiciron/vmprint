import type { ContextTextOptions } from './context';

export interface OverlayPage {
    readonly index: number;
    readonly width: number;
    readonly height: number;
    readonly boxes: readonly OverlayBox[];
}

export interface OverlayTextSegment {
    readonly text: string;
    readonly width?: number;
}

export interface OverlayBox {
    readonly type: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly style?: Readonly<Record<string, unknown>>;
    readonly lines?: readonly (readonly OverlayTextSegment[])[];
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly properties?: Readonly<Record<string, unknown>>;
}

export interface OverlayContext {
    font(family: string, size?: number): this;
    fontSize(size: number): this;
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
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this;
    rect(x: number, y: number, w: number, h: number): this;
    roundedRect(x: number, y: number, w: number, h: number, r: number): this;
    fill(rule?: 'nonzero' | 'evenodd'): this;
    stroke(): this;
    fillAndStroke(fillColor?: string, strokeColor?: string): this;
    text(str: string, x: number, y: number, options?: ContextTextOptions): this;
    save(): void;
    restore(): void;
}

export interface OverlayProvider {
    backdrop?(page: OverlayPage, context: OverlayContext): void;
    overlay?(page: OverlayPage, context: OverlayContext): void;
}
