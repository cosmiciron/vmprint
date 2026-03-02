import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { DocumentInput, ElementStyle } from '@vmprint/engine';
import { Draft2FinalError } from '../../errors';
import { tryReadFile, resolveFormatAsset } from './fs-utils';

export type ThemeDefinition = {
    styles: Record<string, ElementStyle>;
    layout?: Partial<DocumentInput['layout']>;
};

export function listThemes(formatName: string): string[] {
    const dir = resolveFormatAsset(formatName, 'themes');
    if (!dir) return [];
    return fs
        .readdirSync(dir)
        .filter((entry) => entry.toLowerCase().endsWith('.yaml') && !entry.toLowerCase().endsWith('.config.yaml'))
        .map((entry) => entry.slice(0, -'.yaml'.length))
        .sort();
}

export function loadTheme(formatName: string, themeName: string): ThemeDefinition {
    const desired = (themeName || 'default').trim() || 'default';
    const themePath = resolveFormatAsset(formatName, 'themes', `${desired}.yaml`);

    if (!themePath) {
        const available = listThemes(formatName);
        throw new Draft2FinalError(
            'format',
            `${formatName}:${desired}`,
            `Unknown theme "${desired}" for format "${formatName}". Available themes: ${available.join(', ') || '(none)'}`,
            2,
        );
    }

    const raw = tryReadFile(themePath);
    if (raw === null) {
        throw new Draft2FinalError('format', themePath, `Failed to read theme file "${themePath}"`, 2);
    }

    let parsed: unknown;
    try {
        parsed = parseYaml(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Theme file must parse to an object');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Draft2FinalError('format', themePath, `Invalid theme YAML: ${message}`, 2, { cause: error });
    }

    const raw2 = parsed as Record<string, unknown>;
    return {
        styles: (raw2.styles as Record<string, ElementStyle>) || {},
        layout: raw2.layout as Partial<DocumentInput['layout']> | undefined,
    };
}
