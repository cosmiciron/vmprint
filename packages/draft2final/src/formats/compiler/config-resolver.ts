import { parse as parseYaml } from 'yaml';
import { tryReadFile, resolveFormatAsset } from './fs-utils';

/**
 * Deep-merge source into target. Arrays are replaced wholesale; objects are merged recursively;
 * scalars are replaced. Mutates and returns target.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
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

function stripTopLevelKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const result = { ...obj };
    for (const key of keys) {
        delete result[key];
    }
    return result;
}

/**
 * Load format config defaults → deep-merge theme config → deep-merge frontmatter (minus format/theme) → deep-merge cliFlags.
 * Returns the merged config. cliFlags values take highest priority.
 */
export function resolveConfig(
    formatName: string,
    frontmatter: Record<string, unknown>,
    cliFlags: Record<string, unknown>,
    themeName?: string,
): Record<string, unknown> {
    // Start with format defaults
    let config: Record<string, unknown> = {};

    const defaultsPath = resolveFormatAsset(formatName, 'config.defaults.yaml');
    if (defaultsPath) {
        const raw = tryReadFile(defaultsPath);
        if (raw) {
            try {
                const parsed = parseYaml(raw) as Record<string, unknown>;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    config = parsed;
                }
            } catch {
                // silently use empty defaults if YAML is malformed
            }
        }
    }

    // Merge per-theme config overrides (e.g. themes/opensource.config.yaml)
    if (themeName && themeName !== 'default') {
        const themeConfigPath = resolveFormatAsset(formatName, 'themes', `${themeName}.config.yaml`);
        if (themeConfigPath) {
            const raw = tryReadFile(themeConfigPath);
            if (raw) {
                try {
                    const parsed = parseYaml(raw) as Record<string, unknown>;
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        deepMerge(config, parsed);
                    }
                } catch {
                    // silently ignore malformed theme config
                }
            }
        }
    }

    // Merge frontmatter (exclude format/theme/flavor selection keys)
    const fmConfig = stripTopLevelKeys(frontmatter, ['format', 'theme', 'flavor']);
    deepMerge(config, fmConfig);

    // Merge CLI flags (exclude format/theme/flavor selection keys)
    const cliConfig = stripTopLevelKeys(cliFlags, ['format', 'theme', 'flavor', 'debug', 'ast', 'output']);
    deepMerge(config, cliConfig);

    return config;
}
