import type {
    DocumentIR,
    DocumentInput,
    Element,
    ElementProperties,
    LayoutConfig,
    VmprintDocumentVersion,
    VmprintIRVersion
} from './types';

export const CURRENT_DOCUMENT_VERSION: VmprintDocumentVersion = '1.1';
export const CURRENT_IR_VERSION: VmprintIRVersion = '1.0';
const SUPPORTED_DOCUMENT_VERSIONS = new Set<VmprintDocumentVersion>(['1.0', '1.1']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const ROOT_KEYS = new Set(['documentVersion', 'layout', 'fonts', 'styles', 'elements', 'header', 'footer', 'printPipeline', 'debug']);
const PAGE_RESERVATION_SELECTOR_VALUES = new Set(['first', 'odd', 'even', 'all']);
const LAYOUT_KEYS = new Set([
    'pageSize',
    'orientation',
    'margins',
    'fontFamily',
    'fontSize',
    'lineHeight',
    'pageBackground',
    'storyWrapOpticalUnderhang',
    'headerInsetTop',
    'headerInsetBottom',
    'footerInsetTop',
    'footerInsetBottom',
    'pageReservationOnFirstPageStart',
    'pageStartReservationSelector',
    'pageStartExclusionTop',
    'pageStartExclusionHeight',
    'pageStartExclusionX',
    'pageStartExclusionWidth',
    'pageStartExclusionX2',
    'pageStartExclusionWidth2',
    'pageStartExclusionLeftWidth',
    'pageStartExclusionRightWidth',
    'pageStartExclusionSelector',
    'pageNumberStart',
    'lang',
    'direction',
    'hyphenation',
    'hyphenateCaps',
    'hyphenMinWordLength',
    'hyphenMinPrefix',
    'hyphenMinSuffix',
    'justifyEngine',
    'justifyStrategy',
    'opticalScaling'
]);
const MARGINS_KEYS = new Set(['top', 'right', 'bottom', 'left']);
const OPTICAL_SCALING_KEYS = new Set(['enabled', 'cjk', 'korean', 'thai', 'devanagari', 'arabic', 'cyrillic', 'latin', 'default']);
const ELEMENT_KEYS = new Set(['type', 'content', 'children', 'image', 'table', 'slots', 'columns', 'gutter', 'balance', 'zones', 'zoneLayout', 'stripLayout', 'dropCap', 'columnSpan', 'properties']);
const ZONE_DEFINITION_KEYS = new Set(['id', 'region', 'elements', 'style']);
const ZONE_REGION_KEYS = new Set(['x', 'y', 'width', 'height']);
const STRIP_SLOT_KEYS = new Set(['id', 'elements', 'style']);
const ELEMENT_PROPERTIES_KEYS = new Set([
    'style',
    'image',
    'table',
    'zones',
    'strip',
    'colSpan',
    'rowSpan',
    'sourceId',
    'linkTarget',
    'semanticRole',
    'dropCap',
    'layout',
    'columnSpan',
    'reflowKey',
    'keepWithNext',
    'marginTop',
    'marginBottom',
    'paginationContinuation',
    'pageOverrides',
    'sourceRange',
    'sourceSyntax',
    'language',
    'pageReservationAfter'
]);
const PAGINATION_CONTINUATION_KEYS = new Set(['enabled', 'markerAfterSplit', 'markerBeforeContinuation', 'markersBeforeContinuation']);
const CONTINUATION_MARKER_KEYS = new Set(['type', 'content', 'style', 'properties']);
const SOURCE_RANGE_KEYS = new Set(['lineStart', 'colStart', 'lineEnd', 'colEnd']);
const IMAGE_PAYLOAD_KEYS = new Set(['data', 'mimeType', 'fit']);
const TABLE_LAYOUT_KEYS = new Set(['headerRows', 'repeatHeader', 'columnGap', 'rowGap', 'columns', 'cellStyle', 'headerCellStyle']);
const ZONE_LAYOUT_KEYS = new Set(['columns', 'gap', 'frameOverflow', 'worldBehavior']);
const STRIP_LAYOUT_KEYS = new Set(['tracks', 'gap']);
const TABLE_COLUMN_KEYS = new Set(['mode', 'value', 'fr', 'min', 'max', 'basis', 'minContent', 'maxContent', 'grow', 'shrink']);
const DROP_CAP_KEYS = new Set(['enabled', 'lines', 'characters', 'gap', 'characterStyle']);
const STORY_LAYOUT_DIRECTIVE_KEYS = new Set(['mode', 'x', 'y', 'align', 'wrap', 'gap']);
const PAGE_REGION_DEFINITION_KEYS = new Set(['default', 'firstPage', 'odd', 'even']);
const PAGE_REGION_CONTENT_KEYS = new Set(['elements', 'style']);
const PAGE_OVERRIDES_KEYS = new Set(['header', 'footer']);
const PRINT_PIPELINE_KEYS = new Set(['tableOfContents']);
const TABLE_OF_CONTENTS_KEYS = new Set(['reservedPageCount', 'title', 'titleType', 'entryType', 'indentPerLevel', 'includeTitle']);
const STYLE_KEYS = new Set([
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'textAlign',
    'lang',
    'direction',
    'hyphenation',
    'hyphenateCaps',
    'hyphenMinWordLength',
    'hyphenMinPrefix',
    'hyphenMinSuffix',
    'justifyEngine',
    'justifyStrategy',
    'marginTop',
    'marginBottom',
    'marginLeft',
    'marginRight',
    'textIndent',
    'lineHeight',
    'letterSpacing',
    'verticalAlign',
    'baselineShift',
    'inlineMarginLeft',
    'inlineMarginRight',
    'inlineOpticalInsetTop',
    'inlineOpticalInsetRight',
    'inlineOpticalInsetBottom',
    'inlineOpticalInsetLeft',
    'padding',
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'width',
    'height',
    'zIndex',
    'color',
    'backgroundColor',
    'opacity',
    'pageBreakBefore',
    'keepWithNext',
    'allowLineSplit',
    'orphans',
    'widows',
    'overflowPolicy',
    'borderWidth',
    'borderColor',
    'borderRadius',
    'borderTopWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopColor',
    'borderBottomColor',
    'borderLeftColor',
    'borderRightColor'
]);

function contractError(documentPath: string, path: string, message: string): never {
    throw new Error(`[document] Document at "${documentPath}" is invalid at "${path}": ${message}`);
}

function assertPlainObjectAt(value: unknown, path: string, documentPath: string): Record<string, unknown> {
    if (!isPlainObject(value)) {
        contractError(documentPath, path, 'expected an object.');
    }
    return value;
}

function assertFiniteNumberAt(value: unknown, path: string, documentPath: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        contractError(documentPath, path, 'expected a finite number.');
    }
}

function assertBooleanAt(value: unknown, path: string, documentPath: string): void {
    if (typeof value !== 'boolean') {
        contractError(documentPath, path, 'expected a boolean.');
    }
}

function assertStringAt(value: unknown, path: string, documentPath: string): void {
    if (typeof value !== 'string') {
        contractError(documentPath, path, 'expected a string.');
    }
}

function assertNumberOrStringAt(value: unknown, path: string, documentPath: string): void {
    if (typeof value === 'string') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    contractError(documentPath, path, 'expected a finite number or string.');
}

function assertEnumAt(value: unknown, allowed: readonly string[], path: string, documentPath: string): void {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string' || !allowed.includes(value)) {
        contractError(documentPath, path, `expected one of: ${allowed.join(', ')}.`);
    }
}

function assertAllowedKeys(
    value: Record<string, unknown>,
    allowed: Set<string>,
    path: string,
    documentPath: string,
    options?: { allowUnderscore?: boolean }
): void {
    for (const key of Object.keys(value)) {
        if (allowed.has(key)) continue;
        if (options?.allowUnderscore && key.startsWith('_')) continue;
        contractError(
            documentPath,
            path,
            `unexpected key "${key}". Allowed keys: ${Array.from(allowed).sort().join(', ')}.`
        );
    }
}

function validateLayout(layout: unknown, documentPath: string): void {
    const obj = assertPlainObjectAt(layout, 'layout', documentPath);
    assertAllowedKeys(obj, LAYOUT_KEYS, 'layout', documentPath);

    if (obj.pageSize === undefined) {
        contractError(documentPath, 'layout.pageSize', 'is required.');
    }
    if (typeof obj.pageSize === 'string') {
        if (obj.pageSize !== 'A4' && obj.pageSize !== 'LETTER') {
            contractError(documentPath, 'layout.pageSize', 'expected "A4", "LETTER", or { width, height }.');
        }
    } else {
        const size = assertPlainObjectAt(obj.pageSize, 'layout.pageSize', documentPath);
        assertAllowedKeys(size, new Set(['width', 'height']), 'layout.pageSize', documentPath);
        assertFiniteNumberAt(size.width, 'layout.pageSize.width', documentPath);
        assertFiniteNumberAt(size.height, 'layout.pageSize.height', documentPath);
    }

    assertEnumAt(obj.orientation, ['portrait', 'landscape'], 'layout.orientation', documentPath);
    assertEnumAt(obj.direction, ['ltr', 'rtl', 'auto'], 'layout.direction', documentPath);
    assertEnumAt(obj.hyphenation, ['off', 'auto', 'soft'], 'layout.hyphenation', documentPath);
    assertEnumAt(obj.justifyEngine, ['legacy', 'advanced'], 'layout.justifyEngine', documentPath);
    assertEnumAt(obj.justifyStrategy, ['auto', 'space', 'inter-character'], 'layout.justifyStrategy', documentPath);

    if (obj.margins === undefined) {
        contractError(documentPath, 'layout.margins', 'is required.');
    }
    const margins = assertPlainObjectAt(obj.margins, 'layout.margins', documentPath);
    assertAllowedKeys(margins, MARGINS_KEYS, 'layout.margins', documentPath);
    assertFiniteNumberAt(margins.top, 'layout.margins.top', documentPath);
    assertFiniteNumberAt(margins.right, 'layout.margins.right', documentPath);
    assertFiniteNumberAt(margins.bottom, 'layout.margins.bottom', documentPath);
    assertFiniteNumberAt(margins.left, 'layout.margins.left', documentPath);

    if (obj.fontFamily !== undefined && obj.fontFamily !== null && typeof obj.fontFamily !== 'string') {
        contractError(documentPath, 'layout.fontFamily', 'expected a string.');
    }
    assertFiniteNumberAt(obj.fontSize, 'layout.fontSize', documentPath);
    assertFiniteNumberAt(obj.lineHeight, 'layout.lineHeight', documentPath);
    if (obj.pageBackground !== undefined) assertStringAt(obj.pageBackground, 'layout.pageBackground', documentPath);
    if (obj.storyWrapOpticalUnderhang !== undefined) {
        assertBooleanAt(obj.storyWrapOpticalUnderhang, 'layout.storyWrapOpticalUnderhang', documentPath);
    }
    if (obj.headerInsetTop !== undefined) assertFiniteNumberAt(obj.headerInsetTop, 'layout.headerInsetTop', documentPath);
    if (obj.headerInsetBottom !== undefined) assertFiniteNumberAt(obj.headerInsetBottom, 'layout.headerInsetBottom', documentPath);
    if (obj.footerInsetTop !== undefined) assertFiniteNumberAt(obj.footerInsetTop, 'layout.footerInsetTop', documentPath);
    if (obj.footerInsetBottom !== undefined) assertFiniteNumberAt(obj.footerInsetBottom, 'layout.footerInsetBottom', documentPath);
    if (obj.pageReservationOnFirstPageStart !== undefined) {
        assertFiniteNumberAt(obj.pageReservationOnFirstPageStart, 'layout.pageReservationOnFirstPageStart', documentPath);
    }
    if (obj.pageStartReservationSelector !== undefined) {
        assertStringAt(obj.pageStartReservationSelector, 'layout.pageStartReservationSelector', documentPath);
        if (!PAGE_RESERVATION_SELECTOR_VALUES.has(String(obj.pageStartReservationSelector))) {
            contractError(
                documentPath,
                'layout.pageStartReservationSelector',
                'expected one of "first", "odd", "even", or "all".'
            );
        }
    }
    if (obj.pageStartExclusionTop !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionTop, 'layout.pageStartExclusionTop', documentPath);
    }
    if (obj.pageStartExclusionHeight !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionHeight, 'layout.pageStartExclusionHeight', documentPath);
    }
    if (obj.pageStartExclusionX !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionX, 'layout.pageStartExclusionX', documentPath);
    }
    if (obj.pageStartExclusionWidth !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionWidth, 'layout.pageStartExclusionWidth', documentPath);
    }
    if (obj.pageStartExclusionX2 !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionX2, 'layout.pageStartExclusionX2', documentPath);
    }
    if (obj.pageStartExclusionWidth2 !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionWidth2, 'layout.pageStartExclusionWidth2', documentPath);
    }
    if (obj.pageStartExclusionLeftWidth !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionLeftWidth, 'layout.pageStartExclusionLeftWidth', documentPath);
    }
    if (obj.pageStartExclusionRightWidth !== undefined) {
        assertFiniteNumberAt(obj.pageStartExclusionRightWidth, 'layout.pageStartExclusionRightWidth', documentPath);
    }
    if (obj.pageStartExclusionSelector !== undefined) {
        assertStringAt(obj.pageStartExclusionSelector, 'layout.pageStartExclusionSelector', documentPath);
        if (!PAGE_RESERVATION_SELECTOR_VALUES.has(String(obj.pageStartExclusionSelector))) {
            contractError(
                documentPath,
                'layout.pageStartExclusionSelector',
                'expected one of "first", "odd", "even", or "all".'
            );
        }
    }
    if (obj.pageNumberStart !== undefined) assertFiniteNumberAt(obj.pageNumberStart, 'layout.pageNumberStart', documentPath);
    if (obj.lang !== undefined) assertStringAt(obj.lang, 'layout.lang', documentPath);
    if (obj.hyphenateCaps !== undefined) assertBooleanAt(obj.hyphenateCaps, 'layout.hyphenateCaps', documentPath);
    if (obj.hyphenMinWordLength !== undefined) assertFiniteNumberAt(obj.hyphenMinWordLength, 'layout.hyphenMinWordLength', documentPath);
    if (obj.hyphenMinPrefix !== undefined) assertFiniteNumberAt(obj.hyphenMinPrefix, 'layout.hyphenMinPrefix', documentPath);
    if (obj.hyphenMinSuffix !== undefined) assertFiniteNumberAt(obj.hyphenMinSuffix, 'layout.hyphenMinSuffix', documentPath);

    if (obj.opticalScaling !== undefined) {
        const optical = assertPlainObjectAt(obj.opticalScaling, 'layout.opticalScaling', documentPath);
        assertAllowedKeys(optical, OPTICAL_SCALING_KEYS, 'layout.opticalScaling', documentPath);
        for (const [key, value] of Object.entries(optical)) {
            if (key === 'enabled') {
                assertBooleanAt(value, `layout.opticalScaling.${key}`, documentPath);
                continue;
            }
            assertFiniteNumberAt(value, `layout.opticalScaling.${key}`, documentPath);
        }
    }
}

function validatePrintPipeline(printPipeline: unknown, documentPath: string): void {
    const pipeline = assertPlainObjectAt(printPipeline, 'printPipeline', documentPath);
    assertAllowedKeys(pipeline, PRINT_PIPELINE_KEYS, 'printPipeline', documentPath);

    if (pipeline.tableOfContents !== undefined) {
        const toc = assertPlainObjectAt(pipeline.tableOfContents, 'printPipeline.tableOfContents', documentPath);
        assertAllowedKeys(toc, TABLE_OF_CONTENTS_KEYS, 'printPipeline.tableOfContents', documentPath);
        assertFiniteNumberAt(toc.reservedPageCount, 'printPipeline.tableOfContents.reservedPageCount', documentPath);
        if (toc.title !== undefined) assertStringAt(toc.title, 'printPipeline.tableOfContents.title', documentPath);
        if (toc.titleType !== undefined) assertStringAt(toc.titleType, 'printPipeline.tableOfContents.titleType', documentPath);
        if (toc.entryType !== undefined) assertStringAt(toc.entryType, 'printPipeline.tableOfContents.entryType', documentPath);
        if (toc.indentPerLevel !== undefined) {
            assertFiniteNumberAt(toc.indentPerLevel, 'printPipeline.tableOfContents.indentPerLevel', documentPath);
        }
        if (toc.includeTitle !== undefined) {
            assertBooleanAt(toc.includeTitle, 'printPipeline.tableOfContents.includeTitle', documentPath);
        }
    }
}

function validateStyleObject(style: unknown, path: string, documentPath: string): void {
    const obj = assertPlainObjectAt(style, path, documentPath);
    assertAllowedKeys(obj, STYLE_KEYS, path, documentPath);

    if (obj.fontFamily !== undefined) assertStringAt(obj.fontFamily, `${path}.fontFamily`, documentPath);
    if (obj.fontSize !== undefined) assertFiniteNumberAt(obj.fontSize, `${path}.fontSize`, documentPath);
    if (obj.fontWeight !== undefined) assertNumberOrStringAt(obj.fontWeight, `${path}.fontWeight`, documentPath);
    if (obj.fontStyle !== undefined) assertStringAt(obj.fontStyle, `${path}.fontStyle`, documentPath);
    if (obj.lang !== undefined) assertStringAt(obj.lang, `${path}.lang`, documentPath);
    assertEnumAt(obj.textAlign, ['left', 'right', 'center', 'justify'], `${path}.textAlign`, documentPath);
    assertEnumAt(obj.direction, ['ltr', 'rtl', 'auto'], `${path}.direction`, documentPath);
    assertEnumAt(obj.hyphenation, ['off', 'auto', 'soft'], `${path}.hyphenation`, documentPath);
    assertEnumAt(obj.justifyEngine, ['legacy', 'advanced'], `${path}.justifyEngine`, documentPath);
    assertEnumAt(obj.justifyStrategy, ['auto', 'space', 'inter-character'], `${path}.justifyStrategy`, documentPath);
    assertEnumAt(obj.verticalAlign, ['baseline', 'text-top', 'middle', 'text-bottom', 'bottom'], `${path}.verticalAlign`, documentPath);
    assertEnumAt(obj.overflowPolicy, ['clip', 'move-whole', 'error'], `${path}.overflowPolicy`, documentPath);
    if (obj.hyphenateCaps !== undefined) assertBooleanAt(obj.hyphenateCaps, `${path}.hyphenateCaps`, documentPath);
    if (obj.hyphenMinWordLength !== undefined) assertFiniteNumberAt(obj.hyphenMinWordLength, `${path}.hyphenMinWordLength`, documentPath);
    if (obj.hyphenMinPrefix !== undefined) assertFiniteNumberAt(obj.hyphenMinPrefix, `${path}.hyphenMinPrefix`, documentPath);
    if (obj.hyphenMinSuffix !== undefined) assertFiniteNumberAt(obj.hyphenMinSuffix, `${path}.hyphenMinSuffix`, documentPath);
    if (obj.marginTop !== undefined) assertFiniteNumberAt(obj.marginTop, `${path}.marginTop`, documentPath);
    if (obj.marginBottom !== undefined) assertFiniteNumberAt(obj.marginBottom, `${path}.marginBottom`, documentPath);
    if (obj.textIndent !== undefined) assertFiniteNumberAt(obj.textIndent, `${path}.textIndent`, documentPath);
    if (obj.lineHeight !== undefined) assertFiniteNumberAt(obj.lineHeight, `${path}.lineHeight`, documentPath);
    if (obj.letterSpacing !== undefined) assertFiniteNumberAt(obj.letterSpacing, `${path}.letterSpacing`, documentPath);
    if (obj.baselineShift !== undefined) assertFiniteNumberAt(obj.baselineShift, `${path}.baselineShift`, documentPath);
    if (obj.inlineMarginLeft !== undefined) assertFiniteNumberAt(obj.inlineMarginLeft, `${path}.inlineMarginLeft`, documentPath);
    if (obj.inlineMarginRight !== undefined) assertFiniteNumberAt(obj.inlineMarginRight, `${path}.inlineMarginRight`, documentPath);
    if (obj.inlineOpticalInsetTop !== undefined) assertFiniteNumberAt(obj.inlineOpticalInsetTop, `${path}.inlineOpticalInsetTop`, documentPath);
    if (obj.inlineOpticalInsetRight !== undefined) assertFiniteNumberAt(obj.inlineOpticalInsetRight, `${path}.inlineOpticalInsetRight`, documentPath);
    if (obj.inlineOpticalInsetBottom !== undefined) assertFiniteNumberAt(obj.inlineOpticalInsetBottom, `${path}.inlineOpticalInsetBottom`, documentPath);
    if (obj.inlineOpticalInsetLeft !== undefined) assertFiniteNumberAt(obj.inlineOpticalInsetLeft, `${path}.inlineOpticalInsetLeft`, documentPath);
    if (obj.padding !== undefined) assertFiniteNumberAt(obj.padding, `${path}.padding`, documentPath);
    if (obj.paddingTop !== undefined) assertFiniteNumberAt(obj.paddingTop, `${path}.paddingTop`, documentPath);
    if (obj.paddingBottom !== undefined) assertFiniteNumberAt(obj.paddingBottom, `${path}.paddingBottom`, documentPath);
    if (obj.paddingLeft !== undefined) assertFiniteNumberAt(obj.paddingLeft, `${path}.paddingLeft`, documentPath);
    if (obj.paddingRight !== undefined) assertFiniteNumberAt(obj.paddingRight, `${path}.paddingRight`, documentPath);
    if (obj.width !== undefined) assertFiniteNumberAt(obj.width, `${path}.width`, documentPath);
    if (obj.height !== undefined) assertFiniteNumberAt(obj.height, `${path}.height`, documentPath);
    if (obj.marginLeft !== undefined) assertFiniteNumberAt(obj.marginLeft, `${path}.marginLeft`, documentPath);
    if (obj.marginRight !== undefined) assertFiniteNumberAt(obj.marginRight, `${path}.marginRight`, documentPath);
    if (obj.zIndex !== undefined) assertFiniteNumberAt(obj.zIndex, `${path}.zIndex`, documentPath);
    if (obj.color !== undefined) assertStringAt(obj.color, `${path}.color`, documentPath);
    if (obj.backgroundColor !== undefined) assertStringAt(obj.backgroundColor, `${path}.backgroundColor`, documentPath);
    if (obj.opacity !== undefined) assertFiniteNumberAt(obj.opacity, `${path}.opacity`, documentPath);
    if (obj.pageBreakBefore !== undefined) assertBooleanAt(obj.pageBreakBefore, `${path}.pageBreakBefore`, documentPath);
    if (obj.keepWithNext !== undefined) assertBooleanAt(obj.keepWithNext, `${path}.keepWithNext`, documentPath);
    if (obj.allowLineSplit !== undefined) assertBooleanAt(obj.allowLineSplit, `${path}.allowLineSplit`, documentPath);
    if (obj.orphans !== undefined) assertFiniteNumberAt(obj.orphans, `${path}.orphans`, documentPath);
    if (obj.widows !== undefined) assertFiniteNumberAt(obj.widows, `${path}.widows`, documentPath);
    if (obj.borderWidth !== undefined) assertFiniteNumberAt(obj.borderWidth, `${path}.borderWidth`, documentPath);
    if (obj.borderColor !== undefined) assertStringAt(obj.borderColor, `${path}.borderColor`, documentPath);
    if (obj.borderRadius !== undefined) assertFiniteNumberAt(obj.borderRadius, `${path}.borderRadius`, documentPath);
    if (obj.borderTopWidth !== undefined) assertFiniteNumberAt(obj.borderTopWidth, `${path}.borderTopWidth`, documentPath);
    if (obj.borderBottomWidth !== undefined) assertFiniteNumberAt(obj.borderBottomWidth, `${path}.borderBottomWidth`, documentPath);
    if (obj.borderLeftWidth !== undefined) assertFiniteNumberAt(obj.borderLeftWidth, `${path}.borderLeftWidth`, documentPath);
    if (obj.borderRightWidth !== undefined) assertFiniteNumberAt(obj.borderRightWidth, `${path}.borderRightWidth`, documentPath);
    if (obj.borderTopColor !== undefined) assertStringAt(obj.borderTopColor, `${path}.borderTopColor`, documentPath);
    if (obj.borderBottomColor !== undefined) assertStringAt(obj.borderBottomColor, `${path}.borderBottomColor`, documentPath);
    if (obj.borderLeftColor !== undefined) assertStringAt(obj.borderLeftColor, `${path}.borderLeftColor`, documentPath);
    if (obj.borderRightColor !== undefined) assertStringAt(obj.borderRightColor, `${path}.borderRightColor`, documentPath);
}

function validatePageRegionContent(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const content = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(content, PAGE_REGION_CONTENT_KEYS, path, documentPath);
    if (!Array.isArray(content.elements)) {
        contractError(documentPath, `${path}.elements`, 'expected an array.');
    }
    content.elements.forEach((element, index) => validateElementNode(element, `${path}.elements[${index}]`, documentPath, documentVersion));
    if (content.style !== undefined) validateStyleObject(content.style, `${path}.style`, documentPath);
}

function validatePageRegionDefinition(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const definition = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(definition, PAGE_REGION_DEFINITION_KEYS, path, documentPath);
    for (const key of ['default', 'firstPage', 'odd', 'even'] as const) {
        const entry = definition[key];
        if (entry === undefined || entry === null) continue;
        validatePageRegionContent(entry, `${path}.${key}`, documentPath, documentVersion);
    }
}

function validatePageOverrides(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const overrides = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(overrides, PAGE_OVERRIDES_KEYS, path, documentPath);
    if (overrides.header !== undefined && overrides.header !== null) {
        validatePageRegionContent(overrides.header, `${path}.header`, documentPath, documentVersion);
    }
    if (overrides.footer !== undefined && overrides.footer !== null) {
        validatePageRegionContent(overrides.footer, `${path}.footer`, documentPath, documentVersion);
    }
}

function validateSourceRange(value: unknown, path: string, documentPath: string): void {
    const range = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(range, SOURCE_RANGE_KEYS, path, documentPath);
    for (const key of SOURCE_RANGE_KEYS) {
        if (range[key] !== undefined) {
            assertFiniteNumberAt(range[key], `${path}.${key}`, documentPath);
        }
    }
}

function validateContinuationMarker(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const marker = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(marker, CONTINUATION_MARKER_KEYS, path, documentPath);

    if (marker.type !== undefined) assertStringAt(marker.type, `${path}.type`, documentPath);
    if (marker.content !== undefined) assertStringAt(marker.content, `${path}.content`, documentPath);
    if (marker.style !== undefined) validateStyleObject(marker.style, `${path}.style`, documentPath);
    if (marker.properties !== undefined) validateElementProperties(marker.properties, `${path}.properties`, documentPath, documentVersion);
}

function validateDropCapSpec(value: unknown, path: string, documentPath: string): void {
    const dropCap = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(dropCap, DROP_CAP_KEYS, path, documentPath);

    if (dropCap.enabled !== undefined) assertBooleanAt(dropCap.enabled, `${path}.enabled`, documentPath);
    if (dropCap.lines !== undefined) assertFiniteNumberAt(dropCap.lines, `${path}.lines`, documentPath);
    if (dropCap.characters !== undefined) assertFiniteNumberAt(dropCap.characters, `${path}.characters`, documentPath);
    if (dropCap.gap !== undefined) assertFiniteNumberAt(dropCap.gap, `${path}.gap`, documentPath);
    if (dropCap.characterStyle !== undefined) validateStyleObject(dropCap.characterStyle, `${path}.characterStyle`, documentPath);
}

function validateStoryLayoutDirective(value: unknown, path: string, documentPath: string): void {
    const directive = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(directive, STORY_LAYOUT_DIRECTIVE_KEYS, path, documentPath);

    const validModes = new Set(['float', 'story-absolute']);
    if (directive.mode !== undefined && !validModes.has(directive.mode as string)) {
        contractError(documentPath, `${path}.mode`, 'expected one of: float, story-absolute.');
    }
    const validWraps = new Set(['around', 'top-bottom', 'none']);
    if (directive.wrap !== undefined && !validWraps.has(directive.wrap as string)) {
        contractError(documentPath, `${path}.wrap`, 'expected one of: around, top-bottom, none.');
    }
    const validAligns = new Set(['left', 'right', 'center']);
    if (directive.align !== undefined && !validAligns.has(directive.align as string)) {
        contractError(documentPath, `${path}.align`, 'expected one of: left, right, center.');
    }
    if (directive.x !== undefined) assertFiniteNumberAt(directive.x, `${path}.x`, documentPath);
    if (directive.y !== undefined) assertFiniteNumberAt(directive.y, `${path}.y`, documentPath);
    if (directive.gap !== undefined) assertFiniteNumberAt(directive.gap, `${path}.gap`, documentPath);
}

function validatePaginationContinuation(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const continuation = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(continuation, PAGINATION_CONTINUATION_KEYS, path, documentPath);

    if (continuation.enabled !== undefined) assertBooleanAt(continuation.enabled, `${path}.enabled`, documentPath);
    if (continuation.markerAfterSplit !== undefined) {
        validateContinuationMarker(continuation.markerAfterSplit, `${path}.markerAfterSplit`, documentPath, documentVersion);
    }
    if (continuation.markerBeforeContinuation !== undefined) {
        validateContinuationMarker(continuation.markerBeforeContinuation, `${path}.markerBeforeContinuation`, documentPath, documentVersion);
    }
    if (continuation.markersBeforeContinuation !== undefined) {
        if (!Array.isArray(continuation.markersBeforeContinuation)) {
            contractError(documentPath, `${path}.markersBeforeContinuation`, 'expected an array.');
        }
        continuation.markersBeforeContinuation.forEach((entry, index) => {
            validateContinuationMarker(entry, `${path}.markersBeforeContinuation[${index}]`, documentPath, documentVersion);
        });
    }
}

function validateTableColumnDefinition(value: unknown, path: string, documentPath: string): void {
    const column = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(column, TABLE_COLUMN_KEYS, path, documentPath);
    assertEnumAt(column.mode, ['fixed', 'auto', 'flex'], `${path}.mode`, documentPath);

    if (column.value !== undefined) assertFiniteNumberAt(column.value, `${path}.value`, documentPath);
    if (column.fr !== undefined) assertFiniteNumberAt(column.fr, `${path}.fr`, documentPath);
    if (column.min !== undefined) assertFiniteNumberAt(column.min, `${path}.min`, documentPath);
    if (column.max !== undefined) assertFiniteNumberAt(column.max, `${path}.max`, documentPath);
    if (column.basis !== undefined) assertFiniteNumberAt(column.basis, `${path}.basis`, documentPath);
    if (column.minContent !== undefined) assertFiniteNumberAt(column.minContent, `${path}.minContent`, documentPath);
    if (column.maxContent !== undefined) assertFiniteNumberAt(column.maxContent, `${path}.maxContent`, documentPath);
    if (column.grow !== undefined) assertFiniteNumberAt(column.grow, `${path}.grow`, documentPath);
    if (column.shrink !== undefined) assertFiniteNumberAt(column.shrink, `${path}.shrink`, documentPath);
}

function validateTableLayoutOptions(value: unknown, path: string, documentPath: string): void {
    const options = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(options, TABLE_LAYOUT_KEYS, path, documentPath);

    if (options.headerRows !== undefined) assertFiniteNumberAt(options.headerRows, `${path}.headerRows`, documentPath);
    if (options.repeatHeader !== undefined) assertBooleanAt(options.repeatHeader, `${path}.repeatHeader`, documentPath);
    if (options.columnGap !== undefined) assertFiniteNumberAt(options.columnGap, `${path}.columnGap`, documentPath);
    if (options.rowGap !== undefined) assertFiniteNumberAt(options.rowGap, `${path}.rowGap`, documentPath);
    if (options.cellStyle !== undefined) validateStyleObject(options.cellStyle, `${path}.cellStyle`, documentPath);
    if (options.headerCellStyle !== undefined) validateStyleObject(options.headerCellStyle, `${path}.headerCellStyle`, documentPath);

    if (options.columns !== undefined) {
        if (!Array.isArray(options.columns)) {
            contractError(documentPath, `${path}.columns`, 'expected an array.');
        }
        options.columns.forEach((entry, index) => {
            validateTableColumnDefinition(entry, `${path}.columns[${index}]`, documentPath);
        });
    }
}

function validateZoneDefinition(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const zone = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(zone, ZONE_DEFINITION_KEYS, path, documentPath);

    if (zone.id !== undefined) assertStringAt(zone.id, `${path}.id`, documentPath);
    if (zone.region !== undefined) {
        const region = assertPlainObjectAt(zone.region, `${path}.region`, documentPath);
        assertAllowedKeys(region, ZONE_REGION_KEYS, `${path}.region`, documentPath);
        assertFiniteNumberAt(region.x, `${path}.region.x`, documentPath);
        assertFiniteNumberAt(region.y, `${path}.region.y`, documentPath);
        assertFiniteNumberAt(region.width, `${path}.region.width`, documentPath);
        if (Number(region.width) < 0) {
            contractError(documentPath, `${path}.region.width`, 'must be >= 0.');
        }
        if (region.height !== undefined) {
            assertFiniteNumberAt(region.height, `${path}.region.height`, documentPath);
            if (Number(region.height) < 0) {
                contractError(documentPath, `${path}.region.height`, 'must be >= 0.');
            }
        }
    }
    if (zone.style !== undefined) validateStyleObject(zone.style, `${path}.style`, documentPath);

    if (zone.elements === undefined || !Array.isArray(zone.elements)) {
        contractError(documentPath, `${path}.elements`, 'expected an array of block elements.');
    } else {
        zone.elements.forEach((child: unknown, index: number) =>
            validateElementNode(child, `${path}.elements[${index}]`, documentPath, documentVersion)
        );
    }
}

function validateZoneLayoutOptions(value: unknown, path: string, documentPath: string): void {
    const options = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(options, ZONE_LAYOUT_KEYS, path, documentPath);

    if (options.gap !== undefined) assertFiniteNumberAt(options.gap, `${path}.gap`, documentPath);
    if (options.frameOverflow !== undefined) {
        assertEnumAt(options.frameOverflow, ['move-whole', 'continue'], `${path}.frameOverflow`, documentPath);
    }
    if (options.worldBehavior !== undefined) {
        assertEnumAt(options.worldBehavior, ['fixed', 'spanning', 'expandable'], `${path}.worldBehavior`, documentPath);
    }

    if (options.columns !== undefined) {
        if (!Array.isArray(options.columns)) {
            contractError(documentPath, `${path}.columns`, 'expected an array.');
        }
        options.columns.forEach((entry, index) => {
            validateTableColumnDefinition(entry, `${path}.columns[${index}]`, documentPath);
        });
    }
}

function validateStripSlot(value: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const slot = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(slot, STRIP_SLOT_KEYS, path, documentPath);

    if (slot.id !== undefined) assertStringAt(slot.id, `${path}.id`, documentPath);
    if (slot.style !== undefined) validateStyleObject(slot.style, `${path}.style`, documentPath);

    if (slot.elements === undefined || !Array.isArray(slot.elements)) {
        contractError(documentPath, `${path}.elements`, 'expected an array of block elements.');
    } else {
        slot.elements.forEach((child: unknown, index: number) =>
            validateElementNode(child, `${path}.elements[${index}]`, documentPath, documentVersion)
        );
    }
}

function validateStripLayoutOptions(value: unknown, path: string, documentPath: string): void {
    const options = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(options, STRIP_LAYOUT_KEYS, path, documentPath);

    if (options.gap !== undefined) assertFiniteNumberAt(options.gap, `${path}.gap`, documentPath);

    if (options.tracks !== undefined) {
        if (!Array.isArray(options.tracks)) {
            contractError(documentPath, `${path}.tracks`, 'expected an array.');
        }
        options.tracks.forEach((entry, index) => {
            validateTableColumnDefinition(entry, `${path}.tracks[${index}]`, documentPath);
        });
    }
}

function validateColumnSpanValue(value: unknown, path: string, documentPath: string): void {
    if (value !== 'all' && (typeof value !== 'number' || !Number.isFinite(value) || value < 2)) {
        contractError(documentPath, path, "expected 'all' or a finite number >= 2.");
    }
}

function validateElementProperties(
    properties: unknown,
    path: string,
    documentPath: string,
    documentVersion: VmprintDocumentVersion
): void {
    const props = assertPlainObjectAt(properties, path, documentPath);
    assertAllowedKeys(props, ELEMENT_PROPERTIES_KEYS, path, documentPath, { allowUnderscore: true });

    if (documentVersion === '1.1') {
        const legacyStructuralKeys = ['image', 'table', 'zones', 'strip', 'dropCap', 'columnSpan']
            .filter((key) => props[key] !== undefined);
        if (legacyStructuralKeys.length > 0) {
            contractError(
                documentPath,
                path,
                `legacy structural field(s) ${legacyStructuralKeys.join(', ')} are not allowed in documentVersion 1.1; move them onto the element itself.`
            );
        }
    }

    if (props.style !== undefined) validateStyleObject(props.style, `${path}.style`, documentPath);
    if (props.image !== undefined) validateEmbeddedImagePayload(props.image, `${path}.image`, documentPath);
    if (props.table !== undefined) validateTableLayoutOptions(props.table, `${path}.table`, documentPath);
    if (props.zones !== undefined) validateZoneLayoutOptions(props.zones, `${path}.zones`, documentPath);
    if (props.strip !== undefined) validateStripLayoutOptions(props.strip, `${path}.strip`, documentPath);
    if (props.paginationContinuation !== undefined) validatePaginationContinuation(props.paginationContinuation, `${path}.paginationContinuation`, documentPath, documentVersion);
    if (props.pageOverrides !== undefined) validatePageOverrides(props.pageOverrides, `${path}.pageOverrides`, documentPath, documentVersion);
    if (props.colSpan !== undefined) assertFiniteNumberAt(props.colSpan, `${path}.colSpan`, documentPath);
    if (props.rowSpan !== undefined) assertFiniteNumberAt(props.rowSpan, `${path}.rowSpan`, documentPath);
    if (props.keepWithNext !== undefined) assertBooleanAt(props.keepWithNext, `${path}.keepWithNext`, documentPath);
    if (props.sourceId !== undefined) assertStringAt(props.sourceId, `${path}.sourceId`, documentPath);
    if (props.linkTarget !== undefined) assertStringAt(props.linkTarget, `${path}.linkTarget`, documentPath);
    if (props.semanticRole !== undefined) assertStringAt(props.semanticRole, `${path}.semanticRole`, documentPath);
    if (props.dropCap !== undefined) validateDropCapSpec(props.dropCap, `${path}.dropCap`, documentPath);
    if (props.layout !== undefined) validateStoryLayoutDirective(props.layout, `${path}.layout`, documentPath);
    if (props.columnSpan !== undefined) validateColumnSpanValue(props.columnSpan, `${path}.columnSpan`, documentPath);
    if (props.reflowKey !== undefined) assertStringAt(props.reflowKey, `${path}.reflowKey`, documentPath);
    if (props.sourceSyntax !== undefined) assertStringAt(props.sourceSyntax, `${path}.sourceSyntax`, documentPath);
    if (props.language !== undefined) assertStringAt(props.language, `${path}.language`, documentPath);
    if (props.sourceRange !== undefined) validateSourceRange(props.sourceRange, `${path}.sourceRange`, documentPath);
}

function validateEmbeddedImagePayload(value: unknown, path: string, documentPath: string): void {
    const payload = assertPlainObjectAt(value, path, documentPath);
    assertAllowedKeys(payload, IMAGE_PAYLOAD_KEYS, path, documentPath);

    if (typeof payload.data !== 'string' || payload.data.trim().length === 0) {
        contractError(documentPath, `${path}.data`, 'expected a non-empty base64 string or data URI string.');
    }

    if (payload.mimeType !== undefined && typeof payload.mimeType !== 'string') {
        contractError(documentPath, `${path}.mimeType`, 'expected a string.');
    }

    if (payload.fit !== undefined && payload.fit !== 'contain' && payload.fit !== 'fill') {
        contractError(documentPath, `${path}.fit`, 'expected one of: contain, fill.');
    }
}

function validateElementNode(node: unknown, path: string, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const element = assertPlainObjectAt(node, path, documentPath);
    assertAllowedKeys(element, ELEMENT_KEYS, path, documentPath);

    if (typeof element.type !== 'string' || element.type.trim().length === 0) {
        contractError(documentPath, `${path}.type`, 'expected a non-empty string.');
    }
    if (element.content !== undefined && typeof element.content !== 'string') {
        contractError(documentPath, `${path}.content`, 'expected a string.');
    }
    if (element.columns !== undefined) {
        assertFiniteNumberAt(element.columns, `${path}.columns`, documentPath);
    }
    if (element.gutter !== undefined) {
        assertFiniteNumberAt(element.gutter, `${path}.gutter`, documentPath);
    }
    if (element.image !== undefined) {
        validateEmbeddedImagePayload(element.image, `${path}.image`, documentPath);
    }
    if (element.table !== undefined) {
        validateTableLayoutOptions(element.table, `${path}.table`, documentPath);
    }
    if (element.zoneLayout !== undefined) {
        validateZoneLayoutOptions(element.zoneLayout, `${path}.zoneLayout`, documentPath);
    }
    if (element.stripLayout !== undefined) {
        validateStripLayoutOptions(element.stripLayout, `${path}.stripLayout`, documentPath);
    }
    if (element.dropCap !== undefined) {
        validateDropCapSpec(element.dropCap, `${path}.dropCap`, documentPath);
    }
    if (element.columnSpan !== undefined) {
        validateColumnSpanValue(element.columnSpan, `${path}.columnSpan`, documentPath);
    }
    if (String(element.type).trim() === 'story') {
        if (element.columns !== undefined && Number(element.columns) < 1) {
            contractError(documentPath, `${path}.columns`, 'must be >= 1 for story elements.');
        }
        if (element.gutter !== undefined && Number(element.gutter) < 0) {
            contractError(documentPath, `${path}.gutter`, 'must be >= 0 for story elements.');
        }
    }

    if (element.zones !== undefined) {
        if (!Array.isArray(element.zones)) {
            contractError(documentPath, `${path}.zones`, 'expected an array of zone definitions.');
        } else {
            element.zones.forEach((zone: unknown, index: number) =>
                validateZoneDefinition(zone, `${path}.zones[${index}]`, documentPath, documentVersion)
            );
        }
    }

    if (element.slots !== undefined) {
        if (!Array.isArray(element.slots)) {
            contractError(documentPath, `${path}.slots`, 'expected an array of strip slots.');
        } else {
            element.slots.forEach((slot: unknown, index: number) =>
                validateStripSlot(slot, `${path}.slots[${index}]`, documentPath, documentVersion)
            );
        }
    }

    if (element.children !== undefined) {
        if (!Array.isArray(element.children)) {
            contractError(documentPath, `${path}.children`, 'expected an array.');
        }
        element.children.forEach((child, index) => validateElementNode(child, `${path}.children[${index}]`, documentPath, documentVersion));
    }

    if (element.properties !== undefined) {
        validateElementProperties(element.properties, `${path}.properties`, documentPath, documentVersion);
    }

    if (String(element.type).trim() === 'image') {
        const props = element.properties as Record<string, unknown> | undefined;
        if (documentVersion === '1.1') {
            if (element.image === undefined) {
                contractError(documentPath, `${path}.image`, 'is required when element.type is "image" in documentVersion 1.1.');
            }
        } else if (element.image === undefined && (!props || props.image === undefined)) {
            contractError(documentPath, `${path}.image`, 'or legacy properties.image is required when element.type is "image".');
        }
    }

    if (String(element.type).trim() === 'strip') {
        if (element.children !== undefined) {
            contractError(documentPath, `${path}.children`, 'is not allowed on strip elements. Use slots[].elements instead.');
        }
        if (element.zones !== undefined) {
            contractError(documentPath, `${path}.zones`, 'is not allowed on strip elements.');
        }
        if (element.slots === undefined || !Array.isArray(element.slots)) {
            contractError(documentPath, `${path}.slots`, 'is required on strip elements.');
        }
    } else if (element.slots !== undefined) {
        contractError(documentPath, `${path}.slots`, 'is only allowed on strip elements.');
    }
}

function validateDocumentContract(document: DocumentInput, documentPath: string, documentVersion: VmprintDocumentVersion): void {
    const root = assertPlainObjectAt(document, 'root', documentPath);
    assertAllowedKeys(root, ROOT_KEYS, 'root', documentPath);

    validateLayout(document.layout, documentPath);

    if (document.fonts !== undefined) {
        const fonts = assertPlainObjectAt(document.fonts, 'fonts', documentPath);
        for (const [key, value] of Object.entries(fonts)) {
            if (value === undefined || value === null || value === '') continue;
            if (typeof value !== 'string') {
                contractError(documentPath, `fonts.${key}`, 'expected a string.');
            }
        }
    }

    const styles = assertPlainObjectAt(document.styles, 'styles', documentPath);
    for (const [styleName, styleValue] of Object.entries(styles)) {
        validateStyleObject(styleValue, `styles.${styleName}`, documentPath);
    }

    if (!Array.isArray(document.elements)) {
        contractError(documentPath, 'elements', 'expected an array.');
    }
    document.elements.forEach((element, index) => {
        validateElementNode(element, `elements[${index}]`, documentPath, documentVersion);
    });
    if (document.header !== undefined) validatePageRegionDefinition(document.header, 'header', documentPath, documentVersion);
    if (document.footer !== undefined) validatePageRegionDefinition(document.footer, 'footer', documentPath, documentVersion);
    if (document.printPipeline !== undefined) validatePrintPipeline(document.printPipeline, documentPath);
}

function deepSortObject<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((entry) => deepSortObject(entry)) as T;
    }
    if (!isPlainObject(value)) return value;

    const sortedKeys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
        const raw = (value as Record<string, unknown>)[key];
        if (raw === undefined) continue;
        out[key] = deepSortObject(raw);
    }
    return out as T;
}

function normalizePageRegionContent(content: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    if (Array.isArray(content.elements)) {
        normalized.elements = content.elements.map((element) => normalizeElementNode(element as Element));
    }
    if (content.style !== undefined) {
        normalized.style = deepSortObject(content.style);
    }
    return normalized;
}

function normalizePageRegionDefinition(
    definition: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (!isPlainObject(definition)) return undefined;
    const normalized: Record<string, unknown> = {};
    for (const key of ['default', 'firstPage', 'odd', 'even'] as const) {
        const entry = definition[key];
        if (entry === undefined) continue;
        if (entry === null) {
            normalized[key] = null;
            continue;
        }
        if (isPlainObject(entry)) {
            normalized[key] = normalizePageRegionContent(entry);
        }
    }
    return Object.keys(normalized).length > 0 ? deepSortObject(normalized) : undefined;
}

function normalizeElementProperties(properties: ElementProperties | undefined): ElementProperties | undefined {
    if (!isPlainObject(properties)) return undefined;
    const normalized = deepSortObject(properties) as ElementProperties;
    if (isPlainObject(normalized.pageOverrides)) {
        const pageOverrides = normalized.pageOverrides as Record<string, unknown>;
        const normalizedOverrides: Record<string, unknown> = {};
        if (pageOverrides.header === null) {
            normalizedOverrides.header = null;
        } else if (isPlainObject(pageOverrides.header)) {
            normalizedOverrides.header = normalizePageRegionContent(pageOverrides.header);
        }
        if (pageOverrides.footer === null) {
            normalizedOverrides.footer = null;
        } else if (isPlainObject(pageOverrides.footer)) {
            normalizedOverrides.footer = normalizePageRegionContent(pageOverrides.footer);
        }
        normalized.pageOverrides = Object.keys(normalizedOverrides).length > 0
            ? deepSortObject(normalizedOverrides) as any
            : undefined;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeElementNode(element: Element): Element {
    const type = String(element?.type || '').trim();
    if (!type) {
        throw new Error('[document] Every element must define a non-empty "type".');
    }

    const normalizedChildren = Array.isArray(element?.children)
        ? element.children.map((child) => normalizeElementNode(child))
        : undefined;
    const normalizedProperties = normalizeElementProperties(element?.properties);
    const normalized: Element = {
        type,
        content: typeof element?.content === 'string' ? element.content : ''
    };
    const legacyImage = normalizedProperties?.image;
    const legacyTable = normalizedProperties?.table;
    const legacyZoneLayout = normalizedProperties?.zones;
    const legacyStripLayout = normalizedProperties?.strip;
    const legacyDropCap = normalizedProperties?.dropCap;
    const legacyColumnSpan = normalizedProperties?.columnSpan;

    if (element.image !== undefined || legacyImage !== undefined) {
        normalized.image = deepSortObject((element.image ?? legacyImage) as any);
    }
    if (element.table !== undefined || legacyTable !== undefined) {
        normalized.table = deepSortObject((element.table ?? legacyTable) as any);
    }
    if (element.zoneLayout !== undefined || legacyZoneLayout !== undefined) {
        const normalizedZoneLayout = deepSortObject((element.zoneLayout ?? legacyZoneLayout) as any) as Record<string, unknown>;
        if (normalizedZoneLayout.worldBehavior === undefined) {
            normalizedZoneLayout.worldBehavior = 'fixed';
        }
        normalized.zoneLayout = normalizedZoneLayout as any;
    }
    if (element.stripLayout !== undefined || legacyStripLayout !== undefined) {
        normalized.stripLayout = deepSortObject((element.stripLayout ?? legacyStripLayout) as any);
    }
    if (element.dropCap !== undefined || legacyDropCap !== undefined) {
        normalized.dropCap = deepSortObject((element.dropCap ?? legacyDropCap) as any);
    }
    if (element.columnSpan !== undefined || legacyColumnSpan !== undefined) {
        normalized.columnSpan = (element.columnSpan ?? legacyColumnSpan) as any;
    }
    if (element.columns !== undefined && Number.isFinite(Number(element.columns))) {
        normalized.columns = Number(element.columns);
    }
    if (element.gutter !== undefined && Number.isFinite(Number(element.gutter))) {
        normalized.gutter = Number(element.gutter);
    }
    if (element.balance !== undefined) {
        normalized.balance = Boolean(element.balance);
    }

    if (normalizedChildren && normalizedChildren.length > 0) {
        normalized.children = normalizedChildren;
    }
    if (Array.isArray(element.zones)) {
        normalized.zones = element.zones.map((zone) => ({
            ...(zone.id !== undefined ? { id: String(zone.id) } : {}),
            ...(zone.region !== undefined
                ? {
                    region: deepSortObject({
                        x: Number(zone.region.x),
                        y: Number(zone.region.y),
                        width: Number(zone.region.width),
                        ...(zone.region.height !== undefined ? { height: Number(zone.region.height) } : {})
                    })
                }
                : {}),
            elements: Array.isArray(zone.elements)
                ? zone.elements.map((e) => normalizeElementNode(e))
                : [],
            ...(zone.style !== undefined ? { style: zone.style } : {})
        }));
    }
    if (normalizedProperties) {
        delete normalizedProperties.image;
        delete normalizedProperties.table;
        delete normalizedProperties.zones;
        delete normalizedProperties.strip;
        delete normalizedProperties.dropCap;
        delete normalizedProperties.columnSpan;
        normalized.properties = normalizedProperties;
        if (Object.keys(normalized.properties).length === 0) {
            delete normalized.properties;
        }
    }
    if (type === 'strip') {
        const slots = Array.isArray(element.slots)
            ? element.slots.map((slot) => ({
                id: slot.id !== undefined ? String(slot.id) : undefined,
                elements: Array.isArray(slot.elements)
                    ? slot.elements.map((child) => normalizeElementNode(child))
                    : [],
                style: slot.style
            }))
            : [];
        const stripOptions = isPlainObject(normalized.stripLayout)
            ? (normalized.stripLayout as Record<string, unknown>)
            : {};
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {})
        };
        loweredProperties.zones = {
            columns: Array.isArray(stripOptions.tracks) ? stripOptions.tracks as any[] : [],
            gap: stripOptions.gap !== undefined ? stripOptions.gap as number : 0,
            worldBehavior: 'fixed'
        };
        return {
            type: 'zone-map',
            content: '',
            zones: slots.map((slot) => ({
                ...(slot.id !== undefined ? { id: slot.id } : {}),
                elements: slot.elements,
                ...(slot.style !== undefined ? { style: slot.style } : {})
            })),
            properties: Object.keys(loweredProperties).length > 0 ? loweredProperties : undefined
        };
    }

    if (type === 'zone-map' && normalized.zoneLayout) {
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {}),
            zones: deepSortObject(normalized.zoneLayout as any)
        };
        delete normalized.zoneLayout;
        normalized.properties = loweredProperties;
    }

    if (type === 'table' && normalized.table) {
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {}),
            table: deepSortObject(normalized.table as any)
        };
        delete normalized.table;
        normalized.properties = loweredProperties;
    }

    if (normalized.image) {
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {}),
            image: deepSortObject(normalized.image as any)
        };
        delete normalized.image;
        normalized.properties = loweredProperties;
    }

    if (normalized.dropCap) {
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {}),
            dropCap: deepSortObject(normalized.dropCap as any)
        };
        delete normalized.dropCap;
        normalized.properties = loweredProperties;
    }

    if (normalized.columnSpan !== undefined) {
        const loweredProperties: ElementProperties = {
            ...(normalized.properties || {}),
            columnSpan: normalized.columnSpan
        };
        delete normalized.columnSpan;
        normalized.properties = loweredProperties;
    }

    return normalized;
}

export function normalizeDocumentToIR(document: DocumentInput, documentPath: string): DocumentIR {
    const sourceVersion = String(document?.documentVersion || '').trim();
    if (!SUPPORTED_DOCUMENT_VERSIONS.has(sourceVersion as VmprintDocumentVersion)) {
        throw new Error(
            `Document at "${documentPath}" must set "documentVersion" to one of: ${Array.from(SUPPORTED_DOCUMENT_VERSIONS).join(', ')}.`
        );
    }

    if (!Array.isArray(document?.elements)) {
        throw new Error(`Document at "${documentPath}" must include an "elements" array.`);
    }
    if (!document?.layout || !isPlainObject(document.layout)) {
        throw new Error(`Document at "${documentPath}" must include "layout".`);
    }
    if (!document?.styles || !isPlainObject(document.styles)) {
        throw new Error(`Document at "${documentPath}" must include "styles".`);
    }

    validateDocumentContract(document, documentPath, sourceVersion as VmprintDocumentVersion);

    const normalizedFonts: Record<string, string | undefined> = {};

    for (const [name, fontName] of Object.entries(document.fonts || {})) {
        if (!fontName) continue;
        const normalizedName = String(fontName).trim();
        if (!normalizedName) continue;
        normalizedFonts[name] = normalizedName;
    }

    const normalizedBaseFont = String(document.layout?.fontFamily || '').trim();
    const regular = normalizedFonts.regular || normalizedBaseFont;
    if (!regular) {
        throw new Error(`Document at "${documentPath}" must define "layout.fontFamily" or "fonts.regular".`);
    }

    const normalizedLayout = deepSortObject({
        ...document.layout,
        fontFamily: regular
    }) as LayoutConfig['layout'];

    const normalizedStyles = deepSortObject(document.styles || {}) as LayoutConfig['styles'];
    const normalizedElements = document.elements.map((element) => normalizeElementNode(element));

    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        irVersion: CURRENT_IR_VERSION,
        layout: normalizedLayout,
        fonts: deepSortObject({
            ...document.fonts,
            ...normalizedFonts,
            regular
        }) as LayoutConfig['fonts'],
        styles: normalizedStyles,
        elements: normalizedElements,
        header: normalizePageRegionDefinition(document.header as Record<string, unknown> | undefined) as any,
        footer: normalizePageRegionDefinition(document.footer as Record<string, unknown> | undefined) as any,
        printPipeline: document.printPipeline ? deepSortObject(document.printPipeline) as any : undefined
    };
}

export function resolveDocumentPaths(document: DocumentInput, documentPath: string): DocumentIR {
    return normalizeDocumentToIR(document, documentPath);
}

export function serializeDocumentIR(ir: DocumentIR): string {
    return `${JSON.stringify(ir, null, 2)}\n`;
}

export function toLayoutConfig(document: DocumentIR, debug: boolean): LayoutConfig {
    const collectElementFontFamilies = (elements: DocumentIR['elements']): string[] => {
        const families = new Set<string>();

        const visit = (nodes: DocumentIR['elements']) => {
            for (const node of nodes || []) {
                const family = String(node?.properties?.style?.fontFamily || '').trim();
                if (family) families.add(family);
                const dropCapFamily = String(node?.properties?.dropCap?.characterStyle?.fontFamily || '').trim();
                if (dropCapFamily) families.add(dropCapFamily);
                if (Array.isArray(node?.children) && node.children.length > 0) {
                    visit(node.children);
                }
            }
        };

        visit(elements);
        return Array.from(families);
    };

    const collectRegionFontFamilies = (region?: DocumentIR['header'] | DocumentIR['footer']): string[] => {
        if (!region) return [];
        const families = new Set<string>();
        const collect = (content?: { elements: DocumentIR['elements']; style?: Record<string, unknown> } | null) => {
            if (!content) return;
            const family = String(content.style?.fontFamily || '').trim();
            if (family) families.add(family);
            collectElementFontFamilies(content.elements).forEach((entry) => families.add(entry));
        };
        collect(region.default as any);
        collect(region.firstPage as any);
        collect(region.odd as any);
        collect(region.even as any);
        return Array.from(families);
    };

    return {
        layout: document.layout,
        fonts: document.fonts || {},
        styles: document.styles,
        header: document.header,
        footer: document.footer,
        printPipeline: document.printPipeline,
        preloadFontFamilies: Array.from(new Set([
            ...collectElementFontFamilies(document.elements),
            ...collectRegionFontFamilies(document.header),
            ...collectRegionFontFamilies(document.footer)
        ])),
        debug
    };
}

