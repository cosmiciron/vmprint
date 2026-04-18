import { Box, Element, RichLine, SpatialFieldDirective, StoryFloatAlign } from '../../types';
import { buildExclusionFieldObstacles } from '../exclusion-field';
import {
    createContinuationFragmentMeta,
    createContinuationFragmentStyle,
    createLeadingFragmentMeta,
    createLeadingFragmentStyle
} from '../flow-fragment-state';
import type { LayoutProcessor } from '../layout-core';
import type { FlowBox } from '../layout-core-types';
import { resolveDocumentMicroLanePolicy, resolveMinUsableLaneWidth } from '../micro-lane-policy';
import { reflowTextElementAgainstSpatialField, type SpatialFieldTextPlacement } from '../spatial-field-reflow';
import { LAYOUT_DEFAULTS } from '../defaults';
import { OccupiedRect, SpatialMap } from './spatial-map';
import type { HostedRegionActorEntry, HostedRegionActorQueue } from './region-actor-queues';
import type { BoundedHostedRegionSessionResult, HostedRegionSessionResult } from './hosted-region-runtime';
import { FlowBoxPackager } from './flow-box-packager';
import { createContinuationIdentity } from './packager-identity';
import {
    bindPackagerSignalPublisher,
    resolvePackagerChunkOriginWorldY,
    resolvePackagerWorldYAtCursor,
    type PackagerContext,
    type PackagerUnit
} from './packager-types';

type HostedRegionFieldState = {
    wrap: 'around' | 'top-bottom' | 'none';
    hidden: boolean;
    obstacles: OccupiedRect[];
};

type HostedRegionTextPlacement = {
    boxes: Box[];
    requiredHeight: number;
    marginBottom: number;
    reflowedPlacement: SpatialFieldTextPlacement;
};

type HostedRegionTextSplitPlacement = {
    boxes: Box[];
    requiredHeight: number;
    continuationEntry: HostedRegionActorEntry;
};

function normalizeHostedRegionLineConstraint(value: unknown, fallback: number): number {
    const numeric = Math.max(1, Math.floor(Number(value) || 0));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function isPoorHostedRegionContinuationStart(
    placement: ReturnType<typeof reflowTextElementAgainstSpatialField> | null,
    availableWidth: number
): boolean {
    const lineWidths = Array.isArray(placement?.lineWidths) ? placement.lineWidths : [];
    if (!placement || lineWidths.length === 0) return false;
    const firstLineWidth = Number(lineWidths[0] || 0);
    const minimumContentWidth = Math.max(availableWidth * 0.4, 72);
    const wideRestartSlot = Math.max(availableWidth * 0.75, 120);
    const firstLineText = Array.isArray(placement.lines?.[0])
        ? placement.lines[0]
            .map((run: { text?: string }) => String(run?.text || ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
    const firstLineWordCount = firstLineText.length > 0
        ? firstLineText.split(/\s+/).filter(Boolean).length
        : 0;
    const effectiveSlotWidth = Math.max(
        Number(placement.box?.w || 0),
        ...((Array.isArray((placement as any)?.lineSlotWidths) ? (placement as any).lineSlotWidths : [])
            .slice(0, 1)
            .map((value: unknown) => Number(value || 0)))
    );
    return effectiveSlotWidth >= wideRestartSlot
        && (firstLineWidth < minimumContentWidth || firstLineWordCount <= 1);
}

function isPoorHostedRegionSplitTail(
    placement: SpatialFieldTextPlacement | null,
    consumedLineCount: number,
    availableWidth: number
): boolean {
    if (!placement) return false;
    const lineWidths = Array.isArray(placement?.lineWidths) ? placement.lineWidths : [];
    if (consumedLineCount <= 0 || consumedLineCount > lineWidths.length) return false;
    const lastLeadingLineWidth = Number(lineWidths[consumedLineCount - 1] || 0);
    const minimumContentWidth = Math.max(availableWidth * 0.4, 72);
    const wideRestartSlot = Math.max(availableWidth * 0.75, 120);
    const effectiveSlotWidth = Math.max(Number(placement.box?.w || 0), availableWidth);
    return effectiveSlotWidth >= wideRestartSlot && lastLeadingLineWidth < minimumContentWidth;
}

class HostedRegionCarryoverFieldPackager implements PackagerUnit {
    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly boxesTemplate: Box[],
        actor: PackagerUnit
    ) {
        this.actorId = actor.actorId;
        this.sourceId = actor.sourceId;
        this.actorKind = actor.actorKind;
        this.fragmentIndex = actor.fragmentIndex;
        this.continuationOf = actor.continuationOf;
    }

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {}
    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext) { return { minimumWidth: fullAvailableWidth }; }
    getReshapeProfile() { return { capabilities: [] }; }
    emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        return this.boxesTemplate.map((box) => ({
            ...box,
            properties: { ...(box.properties || {}) },
            meta: box.meta ? { ...box.meta, pageIndex: context.pageIndex } : box.meta
        }));
    }
    getRequiredHeight(): number { return Math.max(0, this.boxesTemplate[0]?.h || 0); }
    isUnbreakable(_availableHeight: number): boolean { return true; }
    getLeadingSpacing(): number { return 0; }
    getTrailingSpacing(): number { return 0; }
    reshape(_availableHeight: number, _context: PackagerContext) { return { currentFragment: null, continuationFragment: this }; }
}

function readHostedRegionFieldDirective(boxes: Box[]): SpatialFieldDirective | null {
    for (const box of boxes) {
        const directive = box.properties?.space as SpatialFieldDirective | undefined;
        if (directive && typeof directive === 'object') {
            return directive;
        }
    }
    return null;
}

function readHostedRegionElementFieldDirective(element: Element): SpatialFieldDirective | null {
    const directive = (element.properties?.space ?? element.properties?.spatialField) as SpatialFieldDirective | undefined;
    return directive && typeof directive === 'object' ? directive : null;
}

function isHostedRegionFieldPublisher(element: Element): boolean {
    return readHostedRegionElementFieldDirective(element) !== null;
}

function resolveHostedRegionFieldAnchorX(align: StoryFloatAlign, regionWidth: number, fieldWidth: number): number {
    if (align === 'right') return Math.max(0, regionWidth - fieldWidth);
    if (align === 'center') return Math.max(0, (regionWidth - fieldWidth) / 2);
    return 0;
}

function buildHostedRegionFieldState(
    emitted: Box[],
    directive: SpatialFieldDirective,
    regionWidth: number,
    baseY: number,
    zIndex: number
): { boxes: Box[]; field: HostedRegionFieldState } {
    const anchorBox = emitted[0];
    const align = directive.align ?? 'left';
    const wrap = directive.wrap ?? 'around';
    const hidden = directive.hidden === true;
    const fieldWidth = Math.max(0, anchorBox?.w || 0);
    const fieldHeight = Math.max(0, anchorBox?.h || 0);
    const fieldX = Number.isFinite(directive.x)
        ? Math.max(0, Number(directive.x))
        : resolveHostedRegionFieldAnchorX(align, regionWidth, fieldWidth);
    const fieldY = Number.isFinite(directive.y) ? Math.max(0, Number(directive.y)) : baseY;
    const translatedBoxes = emitted.map((box) => ({
        ...box,
        x: (box.x || 0) + fieldX,
        y: (box.y || 0) + fieldY,
        properties: {
            ...(box.properties || {}),
            ...(directive.exclusionAssembly?.members
                ? {
                    _clipAssembly: directive.exclusionAssembly.members.map((member) => ({
                        x: Number(member.x ?? 0),
                        y: Number(member.y ?? 0),
                        w: Math.max(0, Number(member.w ?? 0)),
                        h: Math.max(0, Number(member.h ?? 0)),
                        shape: (member.shape ?? 'rect') as 'rect' | 'circle' | 'polygon',
                        ...(typeof member.path === 'string' && member.path.trim()
                            ? { path: member.path.trim() }
                            : {})
                    }))
                }
                : directive.shape
                    ? {
                        _clipShape: directive.shape,
                        ...(typeof directive.path === 'string' && directive.path.trim()
                            ? { _clipPath: directive.path.trim() }
                            : {})
                    }
                    : {}),
            ...(hidden ? { opacity: 0 } : {})
        }
    }));

    return {
        boxes: translatedBoxes,
        field: {
            wrap,
            hidden,
            obstacles: buildExclusionFieldObstacles({
                x: fieldX,
                y: fieldY,
                w: fieldWidth,
                h: fieldHeight,
                gap: directive.gap ?? 0,
                shape: directive.shape ?? 'rect',
                path: directive.path,
                align,
                zIndex,
                wrap,
                exclusionAssembly: directive.exclusionAssembly
            })
        }
    };
}

function materializeHostedRegionFieldPublisher(
    actor: PackagerUnit,
    element: Element,
    regionWidth: number,
    availableHeight: number,
    context: PackagerContext,
    baseY: number,
    zIndex: number
): { boxes: Box[]; field: HostedRegionFieldState; directive: SpatialFieldDirective } | null {
    actor.prepare(regionWidth, availableHeight, {
        ...context,
        contentWidthOverride: regionWidth,
        pageWidth: regionWidth
    });
    const emitted = actor.emitBoxes(regionWidth, availableHeight, {
        ...context,
        contentWidthOverride: regionWidth,
        pageWidth: regionWidth
    }) || [];
    const directive = readHostedRegionFieldDirective(emitted) ?? readHostedRegionElementFieldDirective(element);
    if (!directive) return null;
    const fieldState = buildHostedRegionFieldState(
        emitted,
        directive,
        regionWidth,
        baseY,
        Number.isFinite(Number(directive.zIndex)) ? Number(directive.zIndex) : zIndex
    );
    return {
        boxes: annotateHostedActorBoxes(actor, fieldState.boxes),
        field: fieldState.field,
        directive
    };
}

function cloneShiftedFieldDirective(
    directive: SpatialFieldDirective,
    deltaY: number
): SpatialFieldDirective {
    return {
        ...directive,
        y: Math.max(0, Number(directive.y ?? 0) - deltaY)
    };
}

function buildHostedRegionFieldCarryoverEntry(
    entry: HostedRegionActorEntry,
    emitted: Box[],
    directive: SpatialFieldDirective,
    deltaY: number
): HostedRegionActorEntry {
    const shiftedDirective = cloneShiftedFieldDirective(directive, deltaY);
    const anchorBox = emitted[0];
    const anchorX = Number(anchorBox?.x || 0);
    const anchorY = Number(anchorBox?.y || 0);
    const shiftedBoxes = emitted.map((box) => ({
        ...box,
        // Carryover actors are replayed on the next page via a fresh field directive.
        // Normalize emitted geometry back to anchor-local coordinates so host-resolved
        // float placement and explicit x/y placement both replay from the same origin.
        x: Number(box.x || 0) - anchorX,
        y: Number(box.y || 0) - anchorY,
        properties: {
            ...(box.properties || {}),
            ...(box.properties?.space
                ? { space: shiftedDirective }
                : {})
        },
        meta: box.meta ? { ...box.meta } : box.meta
    }));

    return {
        actor: new HostedRegionCarryoverFieldPackager(shiftedBoxes, entry.actor),
        element: {
            ...entry.element,
            properties: {
                ...(entry.element.properties || {}),
                ...((entry.element.properties?.space || entry.element.properties?.spatialField)
                    ? { space: shiftedDirective }
                    : {})
            }
        }
    };
}

function annotateHostedActorBoxes(actor: PackagerUnit, boxes: Box[]): Box[] {
    return boxes.map((box) => ({
        ...box,
        meta: box.meta
            ? { ...box.meta, actorId: actor.actorId, sourceId: box.meta.sourceId ?? actor.sourceId }
            : {
                actorId: actor.actorId,
                sourceId: actor.sourceId,
                engineKey: actor.actorId,
                sourceType: actor.actorKind,
                fragmentIndex: actor.fragmentIndex,
                isContinuation: actor.fragmentIndex > 0 || !!actor.continuationOf
            }
    }));
}

function intersectsVertically(obstacle: OccupiedRect, top: number, bottom: number): boolean {
    const obstacleTop = obstacle.y;
    const obstacleBottom = obstacle.y + obstacle.h;
    return obstacleBottom > top && obstacleTop < bottom;
}

function resolveHostedRegionLane(
    regionWidth: number,
    top: number,
    height: number,
    fields: HostedRegionFieldState[],
    queryZIndex: number
): { x: number; width: number } {
    const bottom = top + Math.max(0, height);
    const occupied: Array<{ start: number; end: number }> = [];

    for (const field of fields) {
        if (field.wrap !== 'around') continue;
        for (const obstacle of field.obstacles) {
            if (Number(obstacle.zIndex ?? 0) !== queryZIndex) continue;
            if (!intersectsVertically(obstacle, top, bottom)) continue;
            occupied.push({
                start: Math.max(0, obstacle.x),
                end: Math.min(regionWidth, obstacle.x + obstacle.w)
            });
        }
    }

    if (occupied.length === 0) {
        return { x: 0, width: regionWidth };
    }

    occupied.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Array<{ start: number; end: number }> = [];
    for (const segment of occupied) {
        if (segment.end <= segment.start) continue;
        const previous = merged[merged.length - 1];
        if (!previous || segment.start > previous.end) {
            merged.push({ ...segment });
            continue;
        }
        previous.end = Math.max(previous.end, segment.end);
    }

    let bestX = 0;
    let bestWidth = 0;
    let cursor = 0;
    for (const segment of merged) {
        const gapWidth = Math.max(0, segment.start - cursor);
        if (gapWidth > bestWidth) {
            bestX = cursor;
            bestWidth = gapWidth;
        }
        cursor = Math.max(cursor, segment.end);
    }

    const trailingWidth = Math.max(0, regionWidth - cursor);
    if (trailingWidth > bestWidth) {
        bestX = cursor;
        bestWidth = trailingWidth;
    }

    return { x: bestX, width: bestWidth };
}

function resolveHostedRegionActorZIndex(element: Element): number {
    const style = element.properties?.style as { zIndex?: unknown } | undefined;
    return Number.isFinite(Number(style?.zIndex)) ? Number(style?.zIndex) : 0;
}

function buildHostedRegionSpatialMap(fields: HostedRegionFieldState[]): SpatialMap {
    const map = new SpatialMap();
    for (const field of fields) {
        for (const obstacle of field.obstacles) {
            map.register(obstacle);
        }
    }
    return map;
}

function materializeHostedRegionFieldStates(
    entries: HostedRegionActorEntry[],
    regionWidth: number,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    pageIndex: number
): HostedRegionFieldState[] {
    const fields: HostedRegionFieldState[] = [];
    for (const entry of entries) {
        const directive = readHostedRegionElementFieldDirective(entry.element);
        if (!directive) continue;
        const zIndex = resolveHostedRegionActorZIndex(entry.element);
        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY: 0,
            publishActorSignal: bindPackagerSignalPublisher(
                contextBase.publishActorSignal,
                pageIndex,
                0,
                resolvePackagerChunkOriginWorldY(contextBase)
            )
        };
        const materialized = materializeHostedRegionFieldPublisher(
            entry.actor,
            entry.element,
            regionWidth,
            Infinity,
            context,
            0,
            zIndex
        );
        if (materialized) {
            fields.push(materialized.field);
        }
    }
    return fields;
}

function resolveHostedRegionContinuationStartClearY(
    top: number,
    lineHeight: number,
    fields: HostedRegionFieldState[],
    queryZIndex: number
): number | null {
    let clearY: number | null = null;
    for (const field of fields) {
        if (field.wrap !== 'around') continue;
        for (const obstacle of field.obstacles) {
            if (Number(obstacle.zIndex ?? 0) !== queryZIndex) continue;
            if (!intersectsVertically(obstacle, top, top + Math.max(0, lineHeight))) continue;
            clearY = clearY === null
                ? obstacle.y + obstacle.h
                : Math.max(clearY, obstacle.y + obstacle.h);
        }
    }
    return clearY;
}

function tryPlaceHostedRegionTextActor(
    actor: PackagerUnit,
    element: Element,
    processor: LayoutProcessor,
    availableWidth: number,
    currentY: number,
    layoutBefore: number,
    activeFields: HostedRegionFieldState[]
): HostedRegionTextPlacement | null {
    if (activeFields.length === 0) return null;
    if (String(element.type || '').toLowerCase() === 'image') return null;
    const session = processor.getCurrentLayoutSession();
    const spatialMap = buildHostedRegionSpatialMap(activeFields);
    const microLanePolicy = resolveDocumentMicroLanePolicy((processor as any).config?.layout);
    const minUsableSlotWidth = resolveMinUsableLaneWidth({
        policy: microLanePolicy,
        element,
        availableWidth
    });
    const placeAgainstCurrentY = (reflowCurrentY: number) => reflowTextElementAgainstSpatialField({
        processor,
        element,
        path: [0],
        availableWidth,
        currentY: reflowCurrentY,
        layoutBefore,
        spatialMap,
        pageIndex: session ? session.getCurrentPageIndex() : 0,
        clearTopBeforeStart: false,
        minUsableSlotWidth,
        rejectSubMinimumSlots: microLanePolicy !== 'allow'
    });
    let placed = placeAgainstCurrentY(currentY);
    if (!placed) return null;

    const isContinuation = Boolean(actor.continuationOf) || Number(actor.fragmentIndex || 0) > 0;
    if (isContinuation && placed.lineSlotWidths.length > 0) {
        const leadingSlotWidths = placed.lineSlotWidths.slice(0, Math.min(3, placed.lineSlotWidths.length));
        const narrowestLeadingSlot = Math.min(...leadingSlotWidths);
        const narrowContinuationThreshold = Math.max(availableWidth * 0.6, 96);
        if (narrowestLeadingSlot < narrowContinuationThreshold) {
            const actorZIndex = resolveHostedRegionActorZIndex(element);
            const clearY = resolveHostedRegionContinuationStartClearY(
                placed.elementStartY,
                placed.uniformLineHeight,
                activeFields,
                actorZIndex
            );
            if (clearY !== null) {
                const adjustedCurrentY = Math.max(currentY, clearY - Math.max(0, layoutBefore));
                if (adjustedCurrentY > currentY + 0.01) {
                    const restarted = placeAgainstCurrentY(adjustedCurrentY);
                    if (restarted) {
                        placed = restarted;
                    }
                }
            }
        }
    }

    const consumedTop = Math.max(0, placed.elementStartY - currentY);
    const requiredHeight = consumedTop + placed.contentHeight + placed.marginBottom;
    return {
        boxes: [placed.box],
        requiredHeight: Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight),
        marginBottom: placed.marginBottom,
        reflowedPlacement: placed
    };
}

function sliceHostedRegionSourceElement(
    processor: LayoutProcessor,
    element: Element,
    lines: RichLine[],
    consumedLineCount: number
): Element {
    const renderedText: string = (processor as any).getJoinedLineText(
        lines.slice(0, consumedLineCount)
    );
    const continuationRenderedText: string = (processor as any).getJoinedLineText(
        lines.slice(consumedLineCount)
    );
    const sourceText: string = (processor as any).getElementText(element);
    let consumedChars: number = (processor as any).resolveConsumedSourceChars(
        sourceText,
        renderedText
    );
    const normalizeContinuationProbe = (text: string): string =>
        String(text || '')
            .replace(/\u00AD/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    const continuationProbe = normalizeContinuationProbe(continuationRenderedText).slice(0, 48);
    if (continuationProbe.length > 0) {
        const baseline = Math.max(0, Math.min(sourceText.length, consumedChars));
        const matchesProbe = (candidate: number): boolean => {
            const remainder = normalizeContinuationProbe(sourceText.slice(candidate));
            return remainder.startsWith(continuationProbe);
        };
        if (!matchesProbe(baseline)) {
            for (let candidate = baseline - 1; candidate >= 0; candidate--) {
                if (!matchesProbe(candidate)) continue;
                consumedChars = candidate;
                break;
            }
        }
    }
    const remaining = Math.max(0, sourceText.length - consumedChars);

    let continuation: Element;
    if (Array.isArray(element.children) && element.children.length > 0) {
        continuation = {
            ...element,
            content: '',
            children: (processor as any).sliceElements(
                element.children,
                consumedChars,
                consumedChars + remaining
            )
        };
    } else {
        continuation = {
            ...element,
            content: sourceText.slice(consumedChars)
        };
    }

    return (processor as any).trimLeadingContinuationWhitespace(continuation) as Element;
}

function trySplitHostedRegionTextPlacement(
    actor: PackagerUnit,
    entry: HostedRegionActorEntry,
    processor: LayoutProcessor,
    placement: ReturnType<typeof reflowTextElementAgainstSpatialField>,
    currentY: number,
    availableHeight: number,
    availableWidth: number,
    activeFields: HostedRegionFieldState[],
    continuationFields: HostedRegionFieldState[]
): HostedRegionTextSplitPlacement | null {
    if (!placement) return null;
    const consumedTop = Math.max(0, placement.elementStartY - currentY);
    const splitAvailableHeight = Math.max(0, availableHeight - consumedTop);
    if (splitAvailableHeight <= 0.01) return null;

    const reflowedFlowBox = (processor as any).rebuildFlowBox(
        placement.flowBox,
        placement.lines,
        placement.flowBox.style,
        placement.flowBox.meta,
        {
            ...(placement.flowBox.properties || {}),
            _lineOffsets: placement.lineOffsets.slice(),
            _lineWidths: placement.lineWidths.slice(),
            _lineYOffsets: placement.lineYOffsets.slice(),
            _isFirstLine: true,
            _isLastLine: true
        }
    );

    const split = (processor as any).splitFlowBox(
        reflowedFlowBox,
        splitAvailableHeight,
        placement.marginTop
    ) as { partA: any; partB: any } | null;
    if (!split?.partA) return null;
    const maxConsumedLineCount = Array.isArray(split.partA.lines) ? split.partA.lines.length : 0;
    if (maxConsumedLineCount <= 0) return null;

    const totalLines = placement.lines.length;
    const orphans = normalizeHostedRegionLineConstraint(reflowedFlowBox.orphans, LAYOUT_DEFAULTS.orphans);
    const widows = normalizeHostedRegionLineConstraint(reflowedFlowBox.widows, LAYOUT_DEFAULTS.widows);

    const buildCandidate = (consumedLineCount: number): HostedRegionTextSplitPlacement | null => {
        if (consumedLineCount < orphans) return null;
        if (totalLines - consumedLineCount < widows) return null;

        const leadingLines = placement.lines.slice(0, consumedLineCount);
        const continuationLines = placement.lines.slice(consumedLineCount);
        const leadingYOffsets = placement.lineYOffsets.slice(0, consumedLineCount);
        const continuationYOffsetsRaw = placement.lineYOffsets.slice(consumedLineCount, totalLines);
        const continuationYOffsetBase = continuationYOffsetsRaw[0] ?? 0;
        const continuationYOffsets = continuationYOffsetsRaw.map((offset) => Number(offset || 0) - Number(continuationYOffsetBase || 0));
        if (leadingLines.length === 0 || continuationLines.length === 0) return null;

        const leadingFlow = (processor as any).rebuildFlowBox(
            reflowedFlowBox,
            leadingLines,
            createLeadingFragmentStyle(reflowedFlowBox.style),
            createLeadingFragmentMeta(reflowedFlowBox.meta),
            {
                ...(reflowedFlowBox.properties || {}),
                _lineOffsets: placement.lineOffsets.slice(0, consumedLineCount),
                _lineWidths: placement.lineWidths.slice(0, consumedLineCount),
                _lineYOffsets: leadingYOffsets,
                _isFirstLine: true,
                _isLastLine: false
            }
        ) as FlowBox;
        leadingFlow.marginBottom = 0;

        const continuationFlow = (processor as any).rebuildFlowBox(
            reflowedFlowBox,
            continuationLines,
            createContinuationFragmentStyle(reflowedFlowBox.style),
            createContinuationFragmentMeta(reflowedFlowBox.meta, reflowedFlowBox.meta.fragmentIndex + 1),
            {
                ...(reflowedFlowBox.properties || {}),
                _lineOffsets: placement.lineOffsets.slice(consumedLineCount, totalLines),
                _lineWidths: placement.lineWidths.slice(consumedLineCount, totalLines),
                _lineYOffsets: continuationYOffsets,
                _isFirstLine: false,
                _isLastLine: true
            }
        ) as FlowBox;
        continuationFlow.marginTop = 0;

        const leadingPackager = new FlowBoxPackager(processor, leadingFlow, {
            actorId: actor.actorId,
            sourceId: actor.sourceId,
            actorKind: actor.actorKind,
            fragmentIndex: actor.fragmentIndex,
            continuationOf: actor.continuationOf
        });
        const leadingBoxes = leadingPackager.emitBoxes(
            placement.box.w,
            splitAvailableHeight,
            {
                processor,
                margins: { top: 0, right: 0, bottom: 0, left: 0 },
                pageWidth: placement.box.w,
                pageHeight: splitAvailableHeight,
                pageIndex: 0,
                cursorY: 0,
                publishActorSignal: (() => ({ sequence: -1 } as any)) as any,
                readActorSignals: (() => []) as any
            }
        );
        if (!leadingBoxes || leadingBoxes.length === 0) return null;

        const referenceBox = leadingBoxes[0];
        const shiftedLeadingBoxes = leadingBoxes.map((box) => ({
            ...box,
            x: Number(box.x || 0) + (Number(placement.box.x || 0) - Number(referenceBox?.x || 0)),
            y: Number(box.y || 0) + (Number(placement.box.y || 0) - Number(referenceBox?.y || 0)),
            properties: { ...(box.properties || {}) },
            meta: box.meta ? { ...box.meta } : box.meta
        }));

        const continuationElement = sliceHostedRegionSourceElement(
            processor,
            entry.element,
            placement.lines,
            consumedLineCount
        );
        const continuationActor = new FlowBoxPackager(
            processor,
            continuationFlow,
            createContinuationIdentity(actor, continuationFlow.meta?.fragmentIndex)
        );

        return {
            boxes: shiftedLeadingBoxes,
            requiredHeight: consumedTop + leadingPackager.getRequiredHeight(),
            continuationEntry: {
                actor: continuationActor,
                element: continuationElement
            }
        };
    };

    let consumedLineCount = maxConsumedLineCount;
    let candidate = buildCandidate(consumedLineCount);
    while (candidate) {
        const continuationPlacement = tryPlaceHostedRegionTextActor(
            candidate.continuationEntry.actor,
            candidate.continuationEntry.element,
            processor,
            availableWidth,
            0,
            candidate.continuationEntry.actor.getLeadingSpacing(),
            continuationFields.length > 0 ? continuationFields : activeFields
        );
        if (
            !isPoorHostedRegionContinuationStart(continuationPlacement?.reflowedPlacement ?? null, availableWidth)
            && !isPoorHostedRegionSplitTail(placement, consumedLineCount, availableWidth)
        ) {
            break;
        }
        if (consumedLineCount <= orphans) {
            break;
        }
        consumedLineCount -= 1;
        candidate = buildCandidate(consumedLineCount);
    }

    return candidate;
}

function resolveHostedRegionPageIndex(
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): number {
    const session = contextBase.processor.getCurrentLayoutSession?.();
    return session ? session.getCurrentPageIndex() : 0;
}

function placePackagersInHostedRegion(
    packagers: HostedRegionActorEntry[],
    availableWidth: number,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): { boxes: Box[]; height: number } {
    const placedBoxes: Box[] = [];
    const activeFields: HostedRegionFieldState[] = [];
    const pageIndex = resolveHostedRegionPageIndex(contextBase);
    let currentY = 0;
    let lastSpacingAfter = 0;

    for (const entry of packagers) {
        const actor = entry.actor;
        const fieldDirective = readHostedRegionElementFieldDirective(entry.element);
        const actorZIndex = resolveHostedRegionActorZIndex(entry.element);
        const marginTop = actor.getLeadingSpacing();
        const marginBottom = actor.getTrailingSpacing();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter;
        const blockTop = currentY + layoutDelta;

        if (fieldDirective) {
            const context: PackagerContext = {
                ...contextBase,
                pageIndex,
                cursorY: currentY,
                publishActorSignal: bindPackagerSignalPublisher(
                    contextBase.publishActorSignal,
                    pageIndex,
                    currentY,
                    resolvePackagerWorldYAtCursor({
                        ...contextBase,
                        cursorY: currentY
                    })
                )
            };
            const fieldPublisher = materializeHostedRegionFieldPublisher(
                actor,
                entry.element,
                availableWidth,
                Infinity,
                context,
                blockTop,
                actorZIndex
            );
            if (fieldPublisher) {
                placedBoxes.push(...fieldPublisher.boxes);
                activeFields.push(fieldPublisher.field);
                continue;
            }
        }

        const textPlacement = tryPlaceHostedRegionTextActor(
            actor,
            entry.element,
            contextBase.processor,
            availableWidth,
            currentY,
            layoutBefore,
            activeFields
        );
        if (textPlacement) {
            placedBoxes.push(...annotateHostedActorBoxes(actor, textPlacement.boxes));
            currentY += textPlacement.requiredHeight - marginBottom;
            lastSpacingAfter = marginBottom;
            continue;
        }

        const initialLane = resolveHostedRegionLane(availableWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields, actorZIndex);
        const context: PackagerContext = {
            ...contextBase,
            pageIndex,
            cursorY: currentY,
            publishActorSignal: bindPackagerSignalPublisher(
                contextBase.publishActorSignal,
                pageIndex,
                currentY,
                resolvePackagerWorldYAtCursor({
                    ...contextBase,
                    cursorY: currentY
                })
            )
        };
        const initialContext: PackagerContext = {
            ...context,
            contentWidthOverride: initialLane.width || availableWidth,
            pageWidth: initialLane.width || availableWidth
        };

        actor.prepare(initialLane.width || availableWidth, Infinity, initialContext);
        const provisionalHeight = Math.max(
            LAYOUT_DEFAULTS.minEffectiveHeight,
            actor.getRequiredHeight() - marginTop - marginBottom + layoutBefore + marginBottom
        );
        const lane = resolveHostedRegionLane(availableWidth, blockTop, provisionalHeight, activeFields, actorZIndex);
        const laneContext: PackagerContext = {
            ...context,
            contentWidthOverride: lane.width || availableWidth,
            pageWidth: lane.width || availableWidth
        };
        if (Math.abs(lane.width - initialLane.width) > 0.1) {
            actor.prepare(lane.width || availableWidth, Infinity, laneContext);
        }
        const emitted = actor.emitBoxes(lane.width || availableWidth, Infinity, laneContext) || [];
        const emittedFieldDirective = readHostedRegionFieldDirective(emitted);

        if (emittedFieldDirective) {
            const fieldState = buildHostedRegionFieldState(
                emitted,
                emittedFieldDirective,
                availableWidth,
                blockTop,
                Number.isFinite(Number(emittedFieldDirective.zIndex)) ? Number(emittedFieldDirective.zIndex) : actorZIndex
            );
            placedBoxes.push(...annotateHostedActorBoxes(actor, fieldState.boxes));
            activeFields.push(fieldState.field);
            continue;
        }

        for (const box of annotateHostedActorBoxes(actor, emitted)) {
            placedBoxes.push({
                ...box,
                x: (box.x || 0) + lane.x,
                y: (box.y || 0) + currentY + layoutDelta
            });
        }

        const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
        const requiredHeight = contentHeight + layoutBefore + marginBottom;
        const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
        currentY += effectiveHeight - marginBottom;
        lastSpacingAfter = marginBottom;
    }

    return { boxes: placedBoxes, height: currentY + lastSpacingAfter };
}

export function runHostedRegionSession(
    zone: HostedRegionActorQueue,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>
): HostedRegionSessionResult {
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const result = placePackagersInHostedRegion(zone.actors, zoneWidth, zoneContextBase);
    return { boxes: result.boxes, height: result.height };
}

export function runHostedRegionSessionBounded(
    zone: HostedRegionActorQueue,
    contextBase: Omit<PackagerContext, 'pageIndex' | 'cursorY'>,
    availableHeight: number
): BoundedHostedRegionSessionResult {
    const zoneWidth = zone.rect.width;
    const zoneContextBase = { ...contextBase, pageWidth: zoneWidth, contentWidthOverride: zoneWidth };
    const placedBoxes: Box[] = [];
    const activeFields: HostedRegionFieldState[] = [];
    const carryoverActors: HostedRegionActorEntry[] = [];
    const pageIndex = resolveHostedRegionPageIndex(zoneContextBase);
    let currentY = 0;
    let lastSpacingAfter = 0;
    const canAbsorbTrailingMarginOverflow = (
        requiredHeight: number,
        trailingMarginBottom: number,
        actorIndex: number
    ): boolean => {
        if (actorIndex !== zone.actors.length - 1) return false;
        if (carryoverActors.length > 0) return false;
        if (trailingMarginBottom <= 0) return false;
        return currentY + requiredHeight > availableHeight + 0.01
            && currentY + Math.max(0, requiredHeight - trailingMarginBottom) <= availableHeight + 0.01;
    };

    for (let actorIndex = 0; actorIndex < zone.actors.length; actorIndex++) {
        const entry = zone.actors[actorIndex];
        const actor = entry.actor;
        const fieldDirective = readHostedRegionElementFieldDirective(entry.element);
        const actorZIndex = resolveHostedRegionActorZIndex(entry.element);
        const marginTop = actor.getLeadingSpacing();
        const marginBottom = actor.getTrailingSpacing();
        const layoutBefore = lastSpacingAfter + marginTop;
        const layoutDelta = lastSpacingAfter;
        const remainingHeight = Math.max(0, availableHeight - currentY - layoutDelta);
        const blockTop = currentY + layoutDelta;
        const initialLane = resolveHostedRegionLane(zoneWidth, blockTop, LAYOUT_DEFAULTS.minEffectiveHeight, activeFields, actorZIndex);
        const context: PackagerContext = {
            ...zoneContextBase,
            pageIndex,
            cursorY: currentY,
            publishActorSignal: bindPackagerSignalPublisher(
                zoneContextBase.publishActorSignal,
                pageIndex,
                currentY,
                resolvePackagerWorldYAtCursor({
                    ...zoneContextBase,
                    cursorY: currentY
                })
            )
        };
        const initialContext: PackagerContext = {
            ...context,
            contentWidthOverride: initialLane.width || zoneWidth,
            pageWidth: initialLane.width || zoneWidth
        };

        if (fieldDirective) {
            const fieldPublisher = materializeHostedRegionFieldPublisher(
                actor,
                entry.element,
                zoneWidth,
                remainingHeight,
                context,
                blockTop,
                actorZIndex
            );
            if (fieldPublisher) {
                const anchorBox = fieldPublisher.boxes[0];
                const fieldTop = Number.isFinite(fieldDirective.y) ? Math.max(0, Number(fieldDirective.y)) : blockTop;
                const fieldBottom = fieldTop + Math.max(0, anchorBox?.h || 0);
                if (fieldBottom > availableHeight + 0.01) {
                    carryoverActors.push(
                        buildHostedRegionFieldCarryoverEntry(
                            entry,
                            fieldPublisher.boxes,
                            fieldPublisher.directive,
                            availableHeight
                        )
                    );
                }
                if (fieldTop >= availableHeight - 0.01) {
                    continue;
                }
                placedBoxes.push(...fieldPublisher.boxes);
                activeFields.push(fieldPublisher.field);
                continue;
            }
        }

        const textPlacement = tryPlaceHostedRegionTextActor(
            actor,
            entry.element,
            zoneContextBase.processor,
            zoneWidth,
            currentY,
            layoutBefore,
            activeFields
        );
        if (textPlacement) {
            if (canAbsorbTrailingMarginOverflow(textPlacement.requiredHeight, textPlacement.marginBottom, actorIndex)) {
                placedBoxes.push(...annotateHostedActorBoxes(actor, textPlacement.boxes));
                currentY += textPlacement.requiredHeight - textPlacement.marginBottom;
                lastSpacingAfter = 0;
                continue;
            }
            if (currentY + textPlacement.requiredHeight > availableHeight + 0.01) {
                const splitPlacement = trySplitHostedRegionTextPlacement(
                    actor,
                    entry,
                    zoneContextBase.processor,
                    textPlacement.reflowedPlacement,
                    currentY,
                    remainingHeight,
                    zoneWidth,
                    activeFields,
                    materializeHostedRegionFieldStates(
                        carryoverActors,
                        zoneWidth,
                        zoneContextBase,
                        pageIndex + 1
                    )
                );
                if (splitPlacement) {
                    placedBoxes.push(...annotateHostedActorBoxes(actor, splitPlacement.boxes));
                    currentY += splitPlacement.requiredHeight;
                    lastSpacingAfter = 0;
                    return {
                        boxes: placedBoxes,
                        height: currentY + lastSpacingAfter,
                        consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                        hasOverflow: true,
                        continuation: {
                            nextActorIndex: actorIndex + 1,
                            continuationFragment: null,
                            prefixActors: [
                                ...(carryoverActors.length > 0 ? carryoverActors : []),
                                splitPlacement.continuationEntry
                            ]
                        }
                    };
                }
                return {
                    boxes: placedBoxes,
                    height: currentY + lastSpacingAfter,
                    consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                    hasOverflow: true,
                    continuation: {
                        nextActorIndex: actorIndex,
                        continuationFragment: actor,
                        prefixActors: carryoverActors.length > 0 ? carryoverActors : undefined
                    }
                };
            }
            placedBoxes.push(...annotateHostedActorBoxes(actor, textPlacement.boxes));
            currentY += textPlacement.requiredHeight - textPlacement.marginBottom;
            lastSpacingAfter = textPlacement.marginBottom;
            continue;
        }

        actor.prepare(initialLane.width || zoneWidth, remainingHeight, initialContext);
        const provisionalHeight = Math.max(
            LAYOUT_DEFAULTS.minEffectiveHeight,
            actor.getRequiredHeight() - marginTop - marginBottom + layoutBefore + marginBottom
        );
        const lane = resolveHostedRegionLane(zoneWidth, blockTop, provisionalHeight, activeFields, actorZIndex);
        const laneContext: PackagerContext = {
            ...context,
            contentWidthOverride: lane.width || zoneWidth,
            pageWidth: lane.width || zoneWidth
        };
        if (Math.abs(lane.width - initialLane.width) > 0.1) {
            actor.prepare(lane.width || zoneWidth, remainingHeight, laneContext);
        }

        const actorRequiredHeight = actor.getRequiredHeight();
        if (actorRequiredHeight <= remainingHeight + 0.1
            || canAbsorbTrailingMarginOverflow(
                Math.max(
                    LAYOUT_DEFAULTS.minEffectiveHeight,
                    actorRequiredHeight - marginTop - marginBottom + layoutBefore + marginBottom
                ),
                marginBottom,
                actorIndex
            )) {
            const emitted = actor.emitBoxes(lane.width || zoneWidth, remainingHeight, laneContext) || [];
            const fieldDirective = readHostedRegionFieldDirective(emitted);
            if (fieldDirective) {
                const anchorBox = emitted[0];
                const fieldTop = Number.isFinite(fieldDirective.y) ? Math.max(0, Number(fieldDirective.y)) : blockTop;
                const fieldBottom = fieldTop + Math.max(0, anchorBox?.h || 0);
                if (fieldBottom > availableHeight + 0.01) {
                    carryoverActors.push(buildHostedRegionFieldCarryoverEntry(entry, emitted, fieldDirective, availableHeight));
                }
                if (fieldTop >= availableHeight - 0.01) {
                    continue;
                }
                const fieldState = buildHostedRegionFieldState(
                    emitted,
                    fieldDirective,
                    zoneWidth,
                    blockTop,
                    Number.isFinite(Number(fieldDirective.zIndex)) ? Number(fieldDirective.zIndex) : actorZIndex
                );
                placedBoxes.push(...annotateHostedActorBoxes(actor, fieldState.boxes));
                activeFields.push(fieldState.field);
                continue;
            }

            for (const box of annotateHostedActorBoxes(actor, emitted)) {
                placedBoxes.push({
                    ...box,
                    x: (box.x || 0) + lane.x,
                    y: (box.y || 0) + currentY + layoutDelta
                });
            }

            const contentHeight = Math.max(0, actor.getRequiredHeight() - marginTop - marginBottom);
            const requiredHeight = contentHeight + layoutBefore + marginBottom;
            const effectiveHeight = Math.max(requiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += effectiveHeight - marginBottom;
            lastSpacingAfter = canAbsorbTrailingMarginOverflow(requiredHeight, marginBottom, actorIndex)
                ? 0
                : marginBottom;
            continue;
        }

        if (remainingHeight <= 0 || actor.isUnbreakable(remainingHeight)) {
            return {
                boxes: placedBoxes,
                height: currentY + lastSpacingAfter,
                consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                hasOverflow: true,
                continuation: {
                    nextActorIndex: actorIndex,
                    continuationFragment: actor,
                    prefixActors: carryoverActors.length > 0 ? carryoverActors : undefined
                }
            };
        }

        const split = actor.reshape(remainingHeight, context);
        if (split.currentFragment) {
            const emitted = split.currentFragment.emitBoxes(lane.width || zoneWidth, remainingHeight, laneContext) || [];
            for (const box of annotateHostedActorBoxes(split.currentFragment, emitted)) {
                placedBoxes.push({
                    ...box,
                    x: (box.x || 0) + lane.x,
                    y: (box.y || 0) + currentY + layoutDelta
                });
            }

            const splitMarginTop = split.currentFragment.getLeadingSpacing();
            const splitMarginBottom = split.currentFragment.getTrailingSpacing();
            const splitContentHeight = Math.max(
                0,
                split.currentFragment.getRequiredHeight() - splitMarginTop - splitMarginBottom
            );
            const splitRequiredHeight = splitContentHeight + layoutBefore + splitMarginBottom;
            const splitEffectiveHeight = Math.max(splitRequiredHeight, LAYOUT_DEFAULTS.minEffectiveHeight);
            currentY += splitEffectiveHeight - splitMarginBottom;
            lastSpacingAfter = splitMarginBottom;
        }

        if (split.continuationFragment) {
            return {
                boxes: placedBoxes,
                height: currentY + lastSpacingAfter,
                consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
                hasOverflow: true,
                continuation: {
                    nextActorIndex: actorIndex,
                    continuationFragment: split.continuationFragment,
                    prefixActors: carryoverActors.length > 0 ? carryoverActors : undefined
                }
            };
        }
    }

    if (carryoverActors.length > 0) {
        return {
            boxes: placedBoxes,
            height: currentY + lastSpacingAfter,
            consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
            hasOverflow: true,
            continuation: {
                nextActorIndex: zone.actors.length,
                continuationFragment: null,
                prefixActors: carryoverActors
            }
        };
    }

    return {
        boxes: placedBoxes,
        height: currentY + lastSpacingAfter,
        consumedHeight: Math.min(availableHeight, currentY + lastSpacingAfter),
        hasOverflow: false,
        continuation: null
    };
}
