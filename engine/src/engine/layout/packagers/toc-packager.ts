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

function resolvedHeight(entryCount: number, isContinuation: boolean): number {
    if (isContinuation) return entryCount * ENTRY_HEIGHT + PADDING;
    return TITLE_HEIGHT + entryCount * ENTRY_HEIGHT + PADDING;
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
        if (this.firstCommittedPageIndex === null) this.firstCommittedPageIndex = context.pageIndex;
        if (this.firstCommittedActorIndex === null && typeof context.actorIndex === 'number') {
            this.firstCommittedActorIndex = context.actorIndex;
        }
        const packager = this.base ?? this.buildPackager(context);
        return packager.emitBoxes(availableWidth, availableHeight, context);
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const packager = this.base ?? this.buildPackager(context);
        const result = packager.split(availableHeight, context);
        if (!result.continuation) return result;

        const continuationIdentity = createContinuationIdentity(this.identity);
        const continuation = new TocPackager(this.processor, this.flowBox, continuationIdentity);
        return { ...result, continuation };
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
                ? {
                    pageIndex: this.firstCommittedPageIndex ?? 0,
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
                pageIndex: signal.pageIndex,
                level: signal.payload?.level != null ? Number(signal.payload.level) : undefined
            }))
            .filter((e) => e.heading.length > 0)
            .filter((e) => !levelFilter || levelFilter.length === 0 || (e.level != null && levelFilter.includes(e.level)));
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

        this.renderedFlowBox = (this.processor as any).shapeElement(syntheticElement, {
            sourceId: this.sourceId,
            sourceType: 'toc',
            fragmentIndex: this.fragmentIndex,
            isContinuation
        });
        this.base = new FlowBoxPackager(this.processor, this.renderedFlowBox, this.identity);
        return this.base;
    }
}
