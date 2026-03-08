import { parse as parseYaml } from 'yaml';
import type { ElementStyle, DocumentLayout, PageRegionContent, PageRegionDefinition } from './types';

export type ThemeDefinition = {
  styles: Record<string, ElementStyle>;
  layout?: Partial<DocumentLayout>;
};

/** Parse a theme YAML string into a ThemeDefinition. */
export function parseTheme(yaml: string): ThemeDefinition {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (err) {
    throw new Error(`Invalid theme YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Theme YAML must parse to an object');
  }
  const raw = parsed as Record<string, unknown>;
  return {
    styles: (raw.styles as Record<string, ElementStyle>) || {},
    layout: raw.layout as Partial<DocumentLayout> | undefined
  };
}

/** Deep-merge source into target. Arrays replaced wholesale, objects merged recursively, scalars replaced. */
export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (target[key] === null || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** Parse a config YAML string. Returns empty object on error or if empty. */
export function parseConfig(yaml: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(yaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

export type BuiltLayoutArtifacts = {
  layout: DocumentLayout;
  header?: PageRegionDefinition;
  footer?: PageRegionDefinition;
};

const PAGE_NUMBER_DIRECTIVES = [
  'showPageNumbers', 'pageNumberFormat', 'pageNumberStartPage',
  'pageNumberFontSize', 'pageNumberColor', 'pageNumberFont',
  'pageNumberPosition', 'pageNumberOffset', 'pageNumberAlignment',
  'pageNumberOffsetTop', 'pageNumberOffsetBottom',
  'pageNumberOffsetLeft', 'pageNumberOffsetRight',
] as const;

function replaceToken(text: string, token: string, value: string): string {
  return text.split(token).join(value);
}

/** Build the layout block, merging defaults with theme overrides.
 * Consumes pageNumber* directives and emits header/footer content instead. */
export function buildLayout(themeLayout?: Partial<DocumentLayout>): BuiltLayoutArtifacts {
  const defaults: Partial<DocumentLayout> = {
    fontFamily: 'Caladea',
    fontSize: 11,
    lineHeight: 1.5,
    pageSize: 'LETTER',
    margins: { top: 72, right: 72, bottom: 72, left: 72 }
  };
  const merged = { ...defaults, ...(themeLayout || {}) } as Record<string, any>;
  const layout: Record<string, unknown> = { ...merged };

  const showPageNumbers = merged.showPageNumbers === true;
  const pageNumberPosition = String(merged.pageNumberPosition || 'bottom').trim().toLowerCase();
  const pageNumberFormat = String(merged.pageNumberFormat || '{n}');
  const pageNumberAlignment = String(merged.pageNumberAlignment || 'center');
  const pageNumberFontSize = Number.isFinite(Number(merged.pageNumberFontSize)) ? Number(merged.pageNumberFontSize) : Number(merged.fontSize || 11);
  const pageNumberColor = typeof merged.pageNumberColor === 'string' ? merged.pageNumberColor : undefined;
  const pageNumberFont = typeof merged.pageNumberFont === 'string' && merged.pageNumberFont.trim().length > 0
    ? merged.pageNumberFont
    : String(merged.fontFamily || defaults.fontFamily);
  const pageNumberOffset = Number.isFinite(Number(merged.pageNumberOffset)) ? Number(merged.pageNumberOffset) : undefined;
  const pageNumberStartPage = Number.isFinite(Number(merged.pageNumberStartPage)) ? Number(merged.pageNumberStartPage) : undefined;

  for (const key of PAGE_NUMBER_DIRECTIVES) delete layout[key];

  let header: PageRegionDefinition | undefined;
  let footer: PageRegionDefinition | undefined;

  if (showPageNumbers) {
    const regionContent: PageRegionContent = {
      elements: [{
        type: 'paragraph',
        content: replaceToken(pageNumberFormat, '{n}', '{pageNumber}'),
        properties: {
          style: {
            textAlign: pageNumberAlignment as 'left' | 'right' | 'center',
            fontSize: pageNumberFontSize,
            ...(pageNumberColor ? { color: pageNumberColor } : {}),
            ...(pageNumberFont ? { fontFamily: pageNumberFont } : {}),
            ...(pageNumberOffset !== undefined
              ? {
                marginTop: pageNumberPosition === 'top'
                  ? pageNumberOffset
                  : Math.max(0, Number((layout.margins as any)?.bottom ?? 0) - pageNumberOffset - pageNumberFontSize)
              }
              : {})
          }
        }
      }]
    };

    if (pageNumberStartPage !== undefined && pageNumberStartPage > 1) {
      layout.pageNumberStart = pageNumberStartPage;
    }

    if (pageNumberPosition === 'top') {
      header = { default: regionContent };
    } else {
      footer = { default: regionContent };
    }
  }

  return { layout: layout as DocumentLayout, header, footer };
}
