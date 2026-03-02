import { BoxMeta, Element, ElementStyle, RichLine } from '../types';
import { LAYOUT_DEFAULTS } from './defaults';
import { LayoutUtils } from './layout-utils';
import {
    ContinuationArtifacts,
    ContinuationMarkerSpec,
    FlowBox,
    FlowIdentitySeed,
    PaginationContinuationSpec,
} from './layout-core-types';

type SplitFlowBoxInput = {
    box: FlowBox;
    availableHeight: number;
    layoutBefore: number;
};

type SplitFlowBoxCallbacks = {
    normalizeLineConstraint: (value: number, fallback: number) => number;
    calculateLineBlockHeight: (lines: RichLine[], style: ElementStyle, lineYOffsets?: number[]) => number;
    rebuildFlowBox: (
        base: FlowBox,
        lines: RichLine[],
        style: ElementStyle,
        meta: BoxMeta,
        properties: Record<string, any>,
    ) => FlowBox;
    getElementText: (element: Element) => string;
    getJoinedLineText: (lines: RichLine[]) => string;
    resolveConsumedSourceChars: (sourceText: string, renderedText: string) => number;
    sliceElements: (elements: Element[], start: number, end: number) => Element[];
    trimLeadingContinuationWhitespace: (element: Element) => Element;
};

type ContinuationArtifactsCallbacks = {
    shapeElement: (element: Element, identitySeed?: FlowIdentitySeed) => FlowBox;
    materializeFlowBox: (unit: FlowBox) => FlowBox;
    normalizeAuthorSourceId: (value: unknown) => string | null;
};

function normalizeContinuationSpec(value: unknown): PaginationContinuationSpec | null {
    if (!value || typeof value !== 'object') return null;
    return value as PaginationContinuationSpec;
}

function createContinuationFlowBox(
    spec: ContinuationMarkerSpec | undefined,
    fallbackType: string,
    originMeta: BoxMeta,
    markerRole: 'after' | 'before',
    markerIndex: number,
    callbacks: ContinuationArtifactsCallbacks,
): FlowBox | null {
    if (!spec || typeof spec !== 'object') return null;
    const content = typeof spec.content === 'string' ? spec.content : '';
    if (!content.trim()) return null;

    const type = typeof spec.type === 'string' && spec.type.trim().length > 0 ? spec.type.trim() : fallbackType;
    const properties: Record<string, any> = {
        ...(spec.properties || {}),
        _generatedContinuation: true,
    };

    if (properties.paginationContinuation !== undefined) {
        delete properties.paginationContinuation;
    }

    if (spec.style && typeof spec.style === 'object') {
        properties.style = {
            ...(properties.style || {}),
            ...spec.style,
        };
    }

    const explicitSourceId = callbacks.normalizeAuthorSourceId(properties.sourceId);
    const baseSourceId = explicitSourceId || `gen:${originMeta.sourceId}:marker-${markerRole}-${markerIndex}`;
    const baseEngineKey = explicitSourceId
        ? `ek:generated:${originMeta.engineKey}:marker-${markerRole}-${markerIndex}`
        : `gen:${originMeta.engineKey}:marker-${markerRole}-${markerIndex}`;

    return callbacks.shapeElement(
        { type, content, properties },
        {
            sourceId: baseSourceId,
            engineKey: baseEngineKey,
            sourceType: type,
            reflowKey: originMeta.reflowKey,
            fragmentIndex: 0,
            isContinuation: true,
            generated: true,
            originSourceId: originMeta.sourceId,
        },
    );
}

export function getContinuationArtifactsWithCallbacks(
    box: FlowBox,
    callbacks: ContinuationArtifactsCallbacks,
): ContinuationArtifacts {
    const spec = normalizeContinuationSpec(box.properties?.paginationContinuation);
    if (!spec || spec.enabled === false) {
        return { markersBeforeContinuation: [] };
    }

    const markerAfterSplit =
        createContinuationFlowBox(spec.markerAfterSplit, box.type, box.meta, 'after', 0, callbacks) || undefined;
    if (markerAfterSplit) callbacks.materializeFlowBox(markerAfterSplit);

    const markersBeforeContinuation: FlowBox[] = [];

    if (Array.isArray(spec.markersBeforeContinuation) && spec.markersBeforeContinuation.length > 0) {
        for (let idx = 0; idx < spec.markersBeforeContinuation.length; idx++) {
            const markerSpec = spec.markersBeforeContinuation[idx];
            const marker = createContinuationFlowBox(markerSpec, box.type, box.meta, 'before', idx, callbacks);
            if (marker) {
                callbacks.materializeFlowBox(marker);
                markersBeforeContinuation.push(marker);
            }
        }
    } else {
        const markerBeforeContinuation = createContinuationFlowBox(
            spec.markerBeforeContinuation,
            box.type,
            box.meta,
            'before',
            0,
            callbacks,
        );
        if (markerBeforeContinuation) {
            callbacks.materializeFlowBox(markerBeforeContinuation);
            markersBeforeContinuation.push(markerBeforeContinuation);
        }
    }

    for (const marker of markersBeforeContinuation) {
        marker.keepWithNext = true;
        marker.pageBreakBefore = false;
    }

    return { markerAfterSplit, markersBeforeContinuation };
}

export function splitFlowBoxWithCallbacks(
    input: SplitFlowBoxInput,
    callbacks: SplitFlowBoxCallbacks,
): { partA: FlowBox; partB: FlowBox } | null {
    const { box, availableHeight, layoutBefore } = input;
    if (!box.lines || box.lines.length <= 1) return null;

    const style = box.style;
    const totalLines = box.lines.length;
    const orphans = callbacks.normalizeLineConstraint(box.orphans, LAYOUT_DEFAULTS.orphans);
    const widows = callbacks.normalizeLineConstraint(box.widows, LAYOUT_DEFAULTS.widows);
    if (totalLines < orphans + widows) return null;

    const paddingTop = LayoutUtils.validateUnit(style.paddingTop ?? style.padding ?? 0);
    const borderTop = LayoutUtils.validateUnit(style.borderTopWidth ?? style.borderWidth ?? 0);
    const topOverhead = layoutBefore + paddingTop + borderTop;
    const effectiveAvailableForLines = availableHeight - topOverhead;
    if (effectiveAvailableForLines <= 0) return null;
    const sourceLineYOffsets = Array.isArray(box.properties?._lineYOffsets)
        ? (box.properties._lineYOffsets as number[])
        : undefined;

    let maxLinesThatFit = 0;
    for (let count = 1; count <= totalLines; count++) {
        const candidateLines = box.lines.slice(0, count);
        const candidateYOffsets = sourceLineYOffsets ? sourceLineYOffsets.slice(0, count) : undefined;
        const candidateHeight = callbacks.calculateLineBlockHeight(candidateLines, style, candidateYOffsets);
        if (candidateHeight <= effectiveAvailableForLines + LAYOUT_DEFAULTS.wrapTolerance) {
            maxLinesThatFit = count;
            continue;
        }
        break;
    }

    if (maxLinesThatFit < orphans) return null;

    let linesA_Count = Math.min(maxLinesThatFit, totalLines - widows);
    if (linesA_Count < orphans) return null;

    while (linesA_Count >= orphans) {
        const linesB_Count = totalLines - linesA_Count;
        if (linesB_Count >= widows) break;
        linesA_Count -= 1;
    }

    const linesB_Count = totalLines - linesA_Count;
    if (linesA_Count < orphans || linesB_Count < widows) return null;

    const linesA = box.lines.slice(0, linesA_Count);
    const linesB = box.lines.slice(linesA_Count);

    const partAStyle: ElementStyle = {
        ...style,
        borderBottomWidth: 0,
        paddingBottom: 0,
        marginBottom: 0,
    };
    const partBStyle: ElementStyle = {
        ...style,
        borderTopWidth: 0,
        paddingTop: 0,
        marginTop: 0,
        textIndent: 0,
    };
    const partAMeta: BoxMeta = {
        ...box.meta,
        isContinuation: box.meta.isContinuation || box.meta.fragmentIndex > 0,
        pageIndex: undefined,
    };
    const partBMeta: BoxMeta = {
        ...box.meta,
        fragmentIndex: box.meta.fragmentIndex + 1,
        isContinuation: true,
        pageIndex: undefined,
    };

    const partA = callbacks.rebuildFlowBox(box, linesA, partAStyle, partAMeta, {
        ...box.properties,
        _lineOffsets: Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.slice(0, linesA.length)
            : undefined,
        _lineWidths: Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.slice(0, linesA.length)
            : undefined,
        _lineYOffsets: Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.slice(0, linesA.length)
            : undefined,
        _isFirstLine: true,
        _isLastLine: false,
    });
    partA.marginBottom = 0;

    const partB = callbacks.rebuildFlowBox(box, linesB, partBStyle, partBMeta, {
        ...box.properties,
        _lineOffsets: Array.isArray(box.properties?._lineOffsets)
            ? box.properties._lineOffsets.slice(linesA_Count, totalLines)
            : undefined,
        _lineWidths: Array.isArray(box.properties?._lineWidths)
            ? box.properties._lineWidths.slice(linesA_Count, totalLines)
            : undefined,
        _lineYOffsets: Array.isArray(box.properties?._lineYOffsets)
            ? box.properties._lineYOffsets.slice(linesA_Count, totalLines)
            : undefined,
        _isFirstLine: false,
        _isLastLine: true,
    });
    partB.marginTop = 0;

    return { partA, partB };
}
