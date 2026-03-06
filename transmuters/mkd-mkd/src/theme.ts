import { parse as parseYaml } from 'yaml';
import type { ElementStyle, DocumentLayout } from './types';

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

/** Build the layout block, merging defaults with theme overrides. */
export function buildLayout(themeLayout?: Partial<DocumentLayout>): DocumentLayout {
  const defaults: Partial<DocumentLayout> = {
    fontFamily: 'Caladea',
    fontSize: 11,
    lineHeight: 1.5,
    pageSize: 'LETTER',
    margins: { top: 72, right: 72, bottom: 72, left: 72 }
  };
  return { ...defaults, ...(themeLayout || {}) } as DocumentLayout;
}
