import { LayoutConfig } from '../types';
import { getFontsByFamily, getFontRegistrySnapshot, FontConfig, FontManager } from '../../font-management/ops';
import { PAGE_SIZE_FALLBACK, PAGE_SIZE_POINTS } from './defaults';

type NormalizedFontStyle = 'normal' | 'italic';

export interface ResolvedFontMatch {
    config: FontConfig;
    requestedWeight: number;
    requestedStyle: NormalizedFontStyle;
    resolvedWeight: number;
    resolvedStyle: NormalizedFontStyle;
    usedStyleFallback: boolean;
    usedVariableWeightRange: boolean;
}

export class LayoutUtils {
    private static applyOrientation(
        size: { width: number; height: number },
        orientation: LayoutConfig['layout']['orientation'],
    ): { width: number; height: number } {
        if (orientation !== 'landscape') {
            return { width: size.width, height: size.height };
        }
        return { width: size.height, height: size.width };
    }

    /**
     * Returns standard PDF point dimensions for supported page sizes.
     */
    static getPageDimensions(config: LayoutConfig): { width: number; height: number } {
        const pageSize = config.layout.pageSize;
        const orientation = config.layout.orientation;

        if (typeof pageSize === 'object') {
            return this.applyOrientation(pageSize, orientation);
        }
        if (pageSize === 'LETTER') {
            return this.applyOrientation(PAGE_SIZE_POINTS.LETTER, orientation);
        }
        if (pageSize === 'A4') {
            return this.applyOrientation(PAGE_SIZE_POINTS.A4, orientation);
        }
        return this.applyOrientation(PAGE_SIZE_POINTS[PAGE_SIZE_FALLBACK], orientation);
    }

    /**
     * Helper to ensure values are valid numbers.
     * Throws an error if the value is not a finite number or a numeric string.
     */
    static validateUnit(v: any): number {
        if (typeof v === 'number') {
            if (!isFinite(v)) throw new Error(`Invalid unit value: ${v}`);
            return v;
        }
        if (typeof v === 'string') {
            const n = Number(v);
            if (isNaN(n) || !isFinite(n)) throw new Error(`Invalid unit value (not numeric): ${v}`);
            return n;
        }
        if (v === undefined || v === null) return 0;
        throw new Error(`Invalid unit type: ${typeof v} (${v})`);
    }

    static normalizeAuthorSourceId(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (
            trimmed.startsWith('author:') ||
            trimmed.startsWith('auto:') ||
            trimmed.startsWith('gen:') ||
            trimmed.startsWith('system:')
        ) {
            return trimmed;
        }
        return `author:${trimmed}`;
    }

    static getContentWidth(config: LayoutConfig, style?: any): number {
        const { width: pageWidth } = this.getPageDimensions(config);
        const margins = config.layout.margins;

        const baseWidth = pageWidth - this.validateUnit(margins.left) - this.validateUnit(margins.right);

        if (!style) return baseWidth;
        const marginLeft = this.validateUnit(style.marginLeft ?? 0);
        const marginRight = this.validateUnit(style.marginRight ?? 0);

        let nominalWidth = baseWidth;
        if (style.width !== undefined) {
            nominalWidth = this.validateUnit(style.width);
        } else {
            nominalWidth = baseWidth - marginLeft - marginRight;
        }

        const insets = this.getHorizontalInsets(style);

        return Math.max(0, nominalWidth - insets);
    }

    static getBoxWidth(config: LayoutConfig, style?: any): number {
        const { width: pageWidth } = this.getPageDimensions(config);
        const margins = config.layout.margins;
        const baseWidth = pageWidth - margins.left - margins.right;

        if (!style) return baseWidth;
        if (style.width === undefined) {
            const marginLeft = this.validateUnit(style.marginLeft ?? 0);
            const marginRight = this.validateUnit(style.marginRight ?? 0);
            return Math.max(0, baseWidth - marginLeft - marginRight);
        }

        return this.validateUnit(style.width);
    }

    static getHorizontalInsets(style: any): number {
        const paddingLeft = this.validateUnit(style.paddingLeft ?? style.padding ?? 0);
        const paddingRight = this.validateUnit(style.paddingRight ?? style.padding ?? 0);
        const borderLeft = this.validateUnit(style.borderLeftWidth ?? style.borderWidth ?? 0);
        const borderRight = this.validateUnit(style.borderRightWidth ?? style.borderWidth ?? 0);
        return paddingLeft + paddingRight + borderLeft + borderRight;
    }

    static getVerticalInsets(style: any): number {
        const paddingTop = this.validateUnit(style.paddingTop ?? style.padding ?? 0);
        const paddingBottom = this.validateUnit(style.paddingBottom ?? style.padding ?? 0);
        const borderTop = this.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
        const borderBottom = this.validateUnit(style.borderBottomWidth ?? style.borderWidth ?? 0);
        return paddingTop + paddingBottom + borderTop + borderBottom;
    }

    /**
     * Resolves the best-matching FontConfig for given font properties.
     */
    static resolveFontMatch(
        family: string,
        weight: number | string = 400,
        style: string = 'normal',
        registry?: FontConfig[],
        manager?: FontManager,
    ): ResolvedFontMatch {
        if (!manager) {
            throw new Error('FontManager is required to resolve font matches.');
        }
        const requestedWeight = this.normalizeFontWeight(weight);
        const requestedStyle = this.normalizeFontStyle(style);

        // 1. Clean the family name
        const baseFamily = this.normalizeRequestedFamilyName(family);

        // 2. Check the registry
        const activeRegistry = registry || getFontRegistrySnapshot(manager);
        const available = getFontsByFamily(baseFamily, activeRegistry, manager);

        if (available.length === 0) {
            throw new Error(`[LayoutUtils] Font family "${family}" is not registered.`);
        }

        const exactStyleCandidates = available.filter((font) => this.normalizeFontStyle(font.style) === requestedStyle);
        const searchPool = exactStyleCandidates.length > 0 ? exactStyleCandidates : available;
        const usedStyleFallback = exactStyleCandidates.length === 0;
        const best = this.pickBestWeightCandidate(searchPool, requestedWeight);

        return {
            config: best.font,
            requestedWeight,
            requestedStyle,
            resolvedWeight: best.resolvedWeight,
            resolvedStyle: this.normalizeFontStyle(best.font.style),
            usedStyleFallback,
            usedVariableWeightRange: best.usedVariableWeightRange,
        };
    }

    static resolveFontConfig(
        family: string,
        weight: number | string = 400,
        style: string = 'normal',
        registry?: FontConfig[],
        manager?: FontManager,
    ): FontConfig {
        return this.resolveFontMatch(family, weight, style, registry, manager).config;
    }

    /**
     * Generates a unique font identifier for the rendering backend.
     */
    static getFontId(
        family: string,
        weight: number | string = 400,
        style: string = 'normal',
        registry?: FontConfig[],
        manager?: FontManager,
    ): string {
        const match = this.resolveFontMatch(family, weight, style, registry, manager);
        const variant = this.toFontVariantLabel(match.resolvedWeight, match.resolvedStyle);
        return `${match.config.family}-${variant}`;
    }

    static normalizeFontWeight(weight: number | string | undefined): number {
        let numericWeight = 400;
        if (typeof weight === 'number' && Number.isFinite(weight)) {
            numericWeight = weight;
        } else if (typeof weight === 'string') {
            const normalized = weight.trim().toLowerCase();
            if (normalized === 'bold' || normalized === 'bolder') {
                numericWeight = 700;
            } else if (normalized === 'normal') {
                numericWeight = 400;
            } else if (normalized === 'lighter') {
                numericWeight = 300;
            } else {
                const parsed = Number(normalized);
                if (Number.isFinite(parsed)) {
                    numericWeight = parsed;
                }
            }
        }

        const clamped = Math.min(900, Math.max(100, numericWeight));
        const stepped = Math.round(clamped / 100) * 100;
        return Math.min(900, Math.max(100, stepped));
    }

    static normalizeFontStyle(style: string | undefined): NormalizedFontStyle {
        const normalized = String(style || '')
            .trim()
            .toLowerCase();
        if (normalized === 'italic' || normalized === 'oblique') return 'italic';
        return 'normal';
    }

    static normalizeFontWeightRange(range: FontConfig['weightRange']): { min: number; max: number } | null {
        if (!range) return null;
        const minRaw = Number(range.min);
        const maxRaw = Number(range.max);
        if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) return null;
        const min = this.normalizeFontWeight(minRaw);
        const max = this.normalizeFontWeight(maxRaw);
        return {
            min: Math.min(min, max),
            max: Math.max(min, max),
        };
    }

    static toFontVariantLabel(weight: number | string, style: string | undefined): string {
        const normalizedWeight = this.normalizeFontWeight(weight);
        const normalizedStyle = this.normalizeFontStyle(style);

        if (normalizedWeight === 400 && normalizedStyle === 'normal') return 'Regular';
        if (normalizedWeight === 700 && normalizedStyle === 'normal') return 'Bold';
        if (normalizedWeight === 400 && normalizedStyle === 'italic') return 'Italic';
        if (normalizedWeight === 700 && normalizedStyle === 'italic') return 'BoldItalic';
        if (normalizedStyle === 'italic') return `ItalicW${normalizedWeight}`;
        return `W${normalizedWeight}`;
    }

    private static normalizeRequestedFamilyName(family: string): string {
        return String(family || '').replace(/-(Regular|Bold|Italic|BoldItalic|W[1-9]00|ItalicW[1-9]00)$/i, '');
    }

    private static pickBestWeightCandidate(
        candidates: FontConfig[],
        requestedWeight: number,
    ): { font: FontConfig; resolvedWeight: number; usedVariableWeightRange: boolean } {
        const scored = candidates.map((font) => {
            const weightRange = this.normalizeFontWeightRange(font.weightRange);
            const resolvedWeight = weightRange
                ? Math.min(weightRange.max, Math.max(weightRange.min, requestedWeight))
                : this.normalizeFontWeight(font.weight);
            const distance = Math.abs(resolvedWeight - requestedWeight);
            const directionPenalty =
                requestedWeight >= 500
                    ? resolvedWeight >= requestedWeight
                        ? 0
                        : 1
                    : resolvedWeight <= requestedWeight
                      ? 0
                      : 1;

            return {
                font,
                resolvedWeight,
                usedVariableWeightRange: !!weightRange,
                distance,
                directionPenalty,
            };
        });

        scored.sort((left, right) => {
            if (left.distance !== right.distance) return left.distance - right.distance;
            if (left.directionPenalty !== right.directionPenalty) return left.directionPenalty - right.directionPenalty;
            if (left.resolvedWeight !== right.resolvedWeight) {
                return requestedWeight >= 500
                    ? right.resolvedWeight - left.resolvedWeight
                    : left.resolvedWeight - right.resolvedWeight;
            }
            return String(left.font.name).localeCompare(String(right.font.name));
        });

        const best = scored[0];
        return {
            font: best.font,
            resolvedWeight: best.resolvedWeight,
            usedVariableWeightRange: best.usedVariableWeightRange,
        };
    }
}
