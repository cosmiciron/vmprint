/**
 * Types compatible with @vmprint/engine's DocumentInput.
 * Declared here so the transmuter has zero dependency on the engine package.
 */

export type TextAlign = 'left' | 'right' | 'center' | 'justify';
export type HyphenationMode = 'off' | 'auto' | 'soft';
export type JustifyEngineMode = 'legacy' | 'advanced';
export type JustifyStrategy = 'auto' | 'space' | 'inter-character';

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: string;
  textAlign?: TextAlign;
  lang?: string;
  direction?: string;
  hyphenation?: HyphenationMode;
  hyphenateCaps?: boolean;
  justifyEngine?: JustifyEngineMode;
  justifyStrategy?: JustifyStrategy;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  textIndent?: number;
  lineHeight?: number;
  letterSpacing?: number;
  verticalAlign?: 'baseline' | 'text-top' | 'middle' | 'text-bottom' | 'bottom';
  baselineShift?: number;
  inlineMarginLeft?: number;
  inlineMarginRight?: number;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  pageBreakBefore?: boolean;
  keepWithNext?: boolean;
  allowLineSplit?: boolean;
  orphans?: number;
  widows?: number;
  overflowPolicy?: string;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  borderTopWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderRightWidth?: number;
  borderTopColor?: string;
  borderBottomColor?: string;
  borderLeftColor?: string;
  borderRightColor?: string;
  [key: string]: unknown;
}

export interface Element {
  type: string;
  content: string;
  children?: Element[];
  columns?: number;
  gutter?: number;
  balance?: boolean;
  properties?: Record<string, unknown>;
}

export interface DocumentLayout {
  pageSize: 'A4' | 'LETTER' | { width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  [key: string]: unknown;
}

export interface DocumentInput {
  documentVersion: '1.0';
  layout: DocumentLayout;
  fonts?: Record<string, string | undefined>;
  styles: Partial<Record<string, ElementStyle>>;
  elements: Element[];
}

export type ResolvedImage = {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
};
