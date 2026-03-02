import { Box, LayoutConfig, Page, TextSegment } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import { LayoutUtils } from './layout-utils';

type FinalizePagesCallbacks = {
    resolveLoadedFamilyFont: (familyName: string, weight: number | string, style?: string) => any;
    measureText: (
        text: string,
        font?: any,
        fontSize?: number,
        letterSpacing?: number,
        populateSegment?: TextSegment,
    ) => number;
};

export function finalizePagesWithCallbacks(
    pages: Page[],
    config: LayoutConfig,
    callbacks: FinalizePagesCallbacks,
): Page[] {
    if (!config.layout.showPageNumbers) return pages;

    const { layout } = config;
    const startPage = layout.pageNumberStartPage ?? LAYOUT_DEFAULTS.pageNumber.startPage;
    const format = layout.pageNumberFormat ?? LAYOUT_DEFAULTS.pageNumber.format;

    const fontSize = layout.pageNumberFontSize ?? LAYOUT_DEFAULTS.pageNumber.fontSize;
    const color = layout.pageNumberColor ?? LAYOUT_DEFAULTS.pageNumber.color;
    const offset = layout.pageNumberOffset ?? LAYOUT_DEFAULTS.pageNumber.offset;
    const position = layout.pageNumberPosition ?? LAYOUT_DEFAULTS.pageNumber.position;
    const fontFamily = layout.pageNumberFont ?? layout.fontFamily;
    const alignment = layout.pageNumberAlignment ?? LAYOUT_DEFAULTS.pageNumber.alignment;

    const { width: pageWidth, height: pageHeight } = LayoutUtils.getPageDimensions(config);
    const margins = layout.margins;

    let visiblePageNum = 0;

    const isSuppressedByLayoutDirectives = (page: Page): boolean =>
        page.boxes.some((box) => {
            const props = box.properties || {};
            return props.layoutDirectives?.suppressPageNumber === true;
        });

    return pages.map((page) => {
        const suppressPageNumber = isSuppressedByLayoutDirectives(page);

        if (suppressPageNumber) return page;

        visiblePageNum += 1;
        if (visiblePageNum < startPage) return page;

        const text = format.replace('{n}', visiblePageNum.toString());
        const pageNumberSegment: TextSegment = {
            text,
            fontFamily,
            style: { fontSize, color, fontFamily },
        };
        const pageNumberFont = callbacks.resolveLoadedFamilyFont(fontFamily, 400);
        callbacks.measureText(text, pageNumberFont, fontSize, 0, pageNumberSegment);

        const y =
            position === 'top'
                ? (layout.pageNumberOffsetTop ?? offset)
                : pageHeight - (layout.pageNumberOffsetBottom ?? offset);

        const x = layout.pageNumberOffsetLeft !== undefined ? layout.pageNumberOffsetLeft : margins.left;
        const rightMargin = layout.pageNumberOffsetRight !== undefined ? layout.pageNumberOffsetRight : margins.right;
        const w = pageWidth - x - rightMargin;

        const pageNumberBox: Box = {
            type: 'page_number',
            x,
            y,
            w,
            h: fontSize,
            style: {
                fontSize,
                color,
                fontFamily,
                textAlign: alignment,
            },
            lines: [[pageNumberSegment]],
            properties: {
                _isFirstLine: true,
                _isLastLine: true,
                _isFirstFragmentInLine: true,
                _isLastFragmentInLine: true,
            },
            meta: {
                sourceId: `system:page-number:${visiblePageNum}`,
                engineKey: `system:page-number:${page.index}`,
                sourceType: 'page_number',
                semanticRole: 'page-number',
                fragmentIndex: 0,
                isContinuation: false,
                pageIndex: page.index,
                generated: true,
            },
        };

        return {
            ...page,
            boxes: [...page.boxes, pageNumberBox],
        };
    });
}
