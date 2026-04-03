import type { Box, Element } from '../../types';
import type { LayoutProcessor } from '../layout-core';
import type { FlowBox } from '../layout-core-types';
import { createContinuationIdentity, type PackagerIdentity } from './packager-identity';
import { FlowBoxPackager } from './flow-box-packager';
import { HEADING_SIGNAL_TOPIC } from '../collaborators/heading-signal-collaborator';
import type {
    ObservationResult,
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';

const ENTRY_HEIGHT = 20;  // px per TOC entry line
const TITLE_HEIGHT = 28;  // px for the TOC title line
const PADDING = 16;        // top + bottom internal padding

type TocEntry = {
    heading: string;
    pageIndex: number;
    cursorY?: number;
    level: number | undefined;
};

type TocProperties = {
    title?: string;
    levelFilter?: number[];
    style?: Record<string, unknown>;
};

function buildTocContent(title: string | undefined, entries: TocEntry[], isContinuation: boolean): string {
    if (isContinuation) {
        return entries.map((e) => formatEntry(e)).join('\n');
    }
    const lines: string[] = [];
    if (title) lines.push(title);
    if (entries.length === 0) {
        lines.push('(no headings found)');
    } else {
        for (const entry of entries) {
            lines.push(formatEntry(entry));
        }
    }
    return lines.join('\n');
}

function formatEntry(entry: TocEntry): string {
    const page = entry.pageIndex + 1;
    const indent = entry.level && entry.level > 1 ? '  '.repeat(entry.level - 1) : '';
    return `${indent}${entry.heading}  ${page}`;
}

function compareTocEntries(a: TocEntry, b: TocEntry): number {
    if (a.pageIndex !== b.pageIndex) {
        return a.pageIndex - b.pageIndex;
    }
    const aCursorY = Number.isFinite(a.cursorY) ? Number(a.cursorY) : Number.POSITIVE_INFINITY;
    const bCursorY = Number.isFinite(b.cursorY) ? Number(b.cursorY) : Number.POSITIVE_INFINITY;
    if (aCursorY !== bCursorY) {
        return aCursorY - bCursorY;
    }
    const aLevel = Number.isFinite(a.level) ? Number(a.level) : Number.POSITIVE_INFINITY;
    const bLevel = Number.isFinite(b.level) ? Number(b.level) : Number.POSITIVE_INFINITY;
    if (aLevel !== bLevel) {
        return aLevel - bLevel;
    }
    return a.heading.localeCompare(b.heading);
}

function resolvedHeight(entryCount: number, isContinuation: boolean): number {
    if (isContinuation) return entryCount * ENTRY_HEIGHT + PADDING;
    return TITLE_HEIGHT + entryCount * ENTRY_HEIGHT + PADDING;
}

function isEarlierCommittedPosition(
    pageIndex: number,
    cursorY: number | undefined,
    actorIndex: number | undefined,
    currentPageIndex: number | null,
    currentCursorY: number | null,
    currentActorIndex: number | null
): boolean {
    if (currentPageIndex === null) {
        return true;
    }
    if (pageIndex !== currentPageIndex) {
        return pageIndex < currentPageIndex;
    }

    const nextCursorY = Number.isFinite(cursorY) ? Number(cursorY) : Number.POSITIVE_INFINITY;
    const existingCursorY = Number.isFinite(currentCursorY) ? Number(currentCursorY) : Number.POSITIVE_INFINITY;
    if (Math.abs(nextCursorY - existingCursorY) > 0.01) {
        return nextCursorY < existingCursorY;
    }

    const nextActorIndex = Number.isFinite(actorIndex) ? Number(actorIndex) : Number.POSITIVE_INFINITY;
    const existingActorIndex = Number.isFinite(currentActorIndex) ? Number(currentActorIndex) : Number.POSITIVE_INFINITY;
    return nextActorIndex < existingActorIndex;
}

/**
 * A live in-flow Table of Contents actor.
 *
 * Subscribes to committed heading signals via observeCommittedSignals().
 * Grows its geometry as headings are discovered during layout.
 * Triggers downstream resettlement when its footprint changes.
 *
 * Place this packager near the front of the document as `type: 'toc'`.
 * Heading actors emit committed signals via HeadingSignalCollaborator.
 */
export class TocPackager implements PackagerUnit {
    private base: FlowBoxPackager | null = null;
    private renderedFlowBox: FlowBox | null = null;
    private observationSignature: string | null = null;
    private geometrySignature: string | null = null;
    private firstCommittedPageIndex: number | null = null;
    private firstCommittedActorIndex: number | null = null;
    private firstCommittedCursorY: number | null = null;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind = 'toc';
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly processor: LayoutProcessor,
        private readonly flowBox: FlowBox,
        private readonly identity: PackagerIdentity
    ) {
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined {
        return this.renderedFlowBox?.pageBreakBefore ?? this.flowBox.pageBreakBefore;
    }

    get keepWithNext(): boolean | undefined {
        return this.renderedFlowBox?.keepWithNext ?? this.flowBox.keepWithNext;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base = this.buildPackager(context);
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        return (this.base ?? this.buildPackager(context)).getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [{ kind: 'split', preservesIdentity: true, producesContinuation: true }]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        if (isEarlierCommittedPosition(
            context.pageIndex,
            context.cursorY,
            typeof context.actorIndex === 'number' ? context.actorIndex : undefined,
            this.firstCommittedPageIndex,
            this.firstCommittedCursorY,
            this.firstCommittedActorIndex
        )) {
            this.firstCommittedPageIndex = context.pageIndex;
            this.firstCommittedActorIndex = typeof context.actorIndex === 'number'
                ? context.actorIndex
                : this.firstCommittedActorIndex;
            this.firstCommittedCursorY = Number.isFinite(context.cursorY)
                ? Number(context.cursorY)
                : this.firstCommittedCursorY;
        }
        const packager = this.base ?? this.buildPackager(context);
        return packager.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.buildPackager(context);
        const result = packager.split(availableHeight, context);
        if (!result.continuationFragment) return result;

        const continuationIdentity = createContinuationIdentity(this.identity);
        const continuationFragment = new TocPackager(this.processor, this.flowBox, continuationIdentity);
        return { ...result, continuationFragment };
    }

    getRequiredHeight(): number { return this.base?.getRequiredHeight() ?? 0; }
    isUnbreakable(availableHeight: number): boolean { return this.base?.isUnbreakable(availableHeight) ?? false; }
    getMarginTop(): number { return this.base?.getMarginTop() ?? (this.flowBox.marginTop ?? 0); }
    getMarginBottom(): number { return this.base?.getMarginBottom() ?? (this.flowBox.marginBottom ?? 0); }

    getCommittedSignalSubscriptions(): readonly string[] {
        return [HEADING_SIGNAL_TOPIC];
    }

    updateCommittedState(context: PackagerContext): ObservationResult {
        return this.observeCommittedSignals(context);
    }

    observeCommittedSignals(context: PackagerContext): ObservationResult {
        if (this.firstCommittedPageIndex === null) {
            return { changed: false, geometryChanged: false, updateKind: 'none' };
        }
        const entries = this.readEntries(context);
        const isContinuation = this.fragmentIndex > 0 || !!this.continuationOf;
        const tocProps = this.getTocProperties();
        const title = tocProps.title;
        const content = buildTocContent(title, entries, isContinuation);
        const height = resolvedHeight(entries.length, isContinuation);

        const nextObservationSig = JSON.stringify({ content });
        const nextGeometrySig = JSON.stringify({ height });

        const changed = this.observationSignature !== nextObservationSig;
        const geometryChanged = this.geometrySignature !== nextGeometrySig;

        this.observationSignature = nextObservationSig;
        this.geometrySignature = nextGeometrySig;

        return {
            changed,
            geometryChanged,
            updateKind: geometryChanged ? 'geometry' : (changed ? 'content-only' : 'none'),
            earliestAffectedFrontier: geometryChanged
                && this.firstCommittedPageIndex !== null
                ? {
                    pageIndex: this.firstCommittedPageIndex,
                    ...(Number.isFinite(this.firstCommittedCursorY)
                        ? { cursorY: Number(this.firstCommittedCursorY) }
                        : {}),
                    actorIndex: this.firstCommittedActorIndex ?? undefined,
                    actorId: this.actorId,
                    sourceId: this.sourceId
                }
                : undefined
        };
    }

    private readEntries(context: PackagerContext): TocEntry[] {
        const tocProps = this.getTocProperties();
        const levelFilter = tocProps.levelFilter;
        const signals = context.readActorSignals(HEADING_SIGNAL_TOPIC);
        return signals
            .map((signal) => ({
                heading: String(signal.payload?.heading ?? ''),
                pageIndex: Number.isFinite(signal.pageIndex) ? Number(signal.pageIndex) : Number.POSITIVE_INFINITY,
                cursorY: Number.isFinite(signal.cursorY) ? Number(signal.cursorY) : undefined,
                level: signal.payload?.level != null ? Number(signal.payload.level) : undefined
            }))
            .filter((e) => e.heading.length > 0)
            .filter((e) => Number.isFinite(e.pageIndex))
            .filter((e) => !levelFilter || levelFilter.length === 0 || (e.level != null && levelFilter.includes(e.level)))
            .sort(compareTocEntries);
    }

    private getTocProperties(): TocProperties {
        return (this.flowBox.properties?.toc as TocProperties) ?? {};
    }

    private buildPackager(context: PackagerContext): FlowBoxPackager {
        const entries = this.readEntries(context);
        const isContinuation = this.fragmentIndex > 0 || !!this.continuationOf;
        const tocProps = this.getTocProperties();
        const title = tocProps.title;
        const content = buildTocContent(title, entries, isContinuation);
        const height = resolvedHeight(entries.length, isContinuation);

        this.observationSignature = JSON.stringify({ content });
        this.geometrySignature = JSON.stringify({ height });

        const sourceElement = (this.flowBox._sourceElement || this.flowBox._unresolvedElement || {
            type: 'toc',
            content: ''
        }) as Element;

        const syntheticElement: Element = {
            ...sourceElement,
            content,
            children: undefined,
            properties: {
                ...(sourceElement.properties ?? {}),
                sourceId: this.sourceId,
                style: {
                    ...((tocProps.style as Record<string, unknown>) ?? {}),
                    ...(height > 0 ? { height } : {})
                }
            }
        };

        const renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: 'toc',
            fragmentIndex: this.fragmentIndex,
            isContinuation
        }) as FlowBox;
        this.renderedFlowBox = renderedFlowBox;
        this.base = new FlowBoxPackager(this.processor, renderedFlowBox, this.identity);
        return this.base;
    }
}
