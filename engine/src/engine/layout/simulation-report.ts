import type { FragmentationSummary } from './fragment-transition-artifact-collaborator';
import type { TransformCapabilitySummary } from './transform-capability-artifact-collaborator';
import type { TransformSummary } from './transform-artifact-collaborator';
import type { PageNumberSummary } from './page-number-artifact-collaborator';
import type { PageOverrideSummary } from './page-override-artifact-collaborator';
import type { PageReservationSummary } from './page-reservation-artifact-collaborator';
import type { PageExclusionSummary } from './page-exclusion-artifact-collaborator';
import type { PageSpatialConstraintSummary } from './page-spatial-constraint-artifact-collaborator';
import type { PageRegionSummary } from './page-region-artifact-collaborator';
import type { SourcePositionSummary } from './source-position-artifact-collaborator';
import type { HeadingTelemetrySummary } from './heading-telemetry-collaborator';
import type { LayoutProfileMetrics } from './layout-session';
import type { Element, Page } from '../types';

export type SimulationArtifactMap = {
    fragmentationSummary?: FragmentationSummary[];
    transformCapabilitySummary?: TransformCapabilitySummary[];
    transformSummary?: TransformSummary[];
    pageNumberSummary?: PageNumberSummary[];
    pageOverrideSummary?: PageOverrideSummary[];
    pageReservationSummary?: PageReservationSummary[];
    pageExclusionSummary?: PageExclusionSummary[];
    pageSpatialConstraintSummary?: PageSpatialConstraintSummary[];
    pageRegionSummary?: PageRegionSummary[];
    sourcePositionMap?: SourcePositionSummary[];
    headingTelemetry?: HeadingTelemetrySummary[];
};

export type SimulationArtifactKey = keyof SimulationArtifactMap;
export type SimulationArtifacts = SimulationArtifactMap & Record<string, unknown>;

export const simulationArtifactKeys = {
    fragmentationSummary: 'fragmentationSummary',
    transformCapabilitySummary: 'transformCapabilitySummary',
    transformSummary: 'transformSummary',
    pageNumberSummary: 'pageNumberSummary',
    pageOverrideSummary: 'pageOverrideSummary',
    pageReservationSummary: 'pageReservationSummary',
    pageExclusionSummary: 'pageExclusionSummary',
    pageSpatialConstraintSummary: 'pageSpatialConstraintSummary',
    pageRegionSummary: 'pageRegionSummary',
    sourcePositionMap: 'sourcePositionMap',
    headingTelemetry: 'headingTelemetry'
} as const satisfies Record<SimulationArtifactKey, SimulationArtifactKey>;

export const knownSimulationArtifactKeys: readonly SimulationArtifactKey[] = [
    simulationArtifactKeys.fragmentationSummary,
    simulationArtifactKeys.transformCapabilitySummary,
    simulationArtifactKeys.transformSummary,
    simulationArtifactKeys.pageNumberSummary,
    simulationArtifactKeys.pageOverrideSummary,
    simulationArtifactKeys.pageReservationSummary,
    simulationArtifactKeys.pageExclusionSummary,
    simulationArtifactKeys.pageSpatialConstraintSummary,
    simulationArtifactKeys.pageRegionSummary,
    simulationArtifactKeys.sourcePositionMap,
    simulationArtifactKeys.headingTelemetry
] as const;

export type SimulationReport = {
    pageCount: number;
    actorCount: number;
    splitTransitionCount: number;
    generatedBoxCount: number;
    profile: LayoutProfileMetrics;
    artifacts: SimulationArtifacts;
};

export type SimulationReportReader = {
    readonly report: SimulationReport | null | undefined;
    readonly pageCount: number;
    readonly actorCount: number;
    readonly splitTransitionCount: number;
    readonly generatedBoxCount: number;
    readonly profile: LayoutProfileMetrics | undefined;
    get<K extends SimulationArtifactKey>(key: K): SimulationArtifactMap[K] | undefined;
    has<K extends SimulationArtifactKey>(key: K): boolean;
    require<K extends SimulationArtifactKey>(key: K): NonNullable<SimulationArtifactMap[K]>;
};

export type PrintPipelineSnapshot = {
    readonly pages: readonly Page[];
    readonly report: SimulationReport | undefined;
    readonly reader: SimulationReportReader;
};

export type HeadingOutlineEntry = {
    sourceId: string;
    heading: string;
    pageIndex: number;
    y: number;
    actorKind?: string;
    sourceType?: string;
    semanticRole?: string;
    level?: number;
};

export type BookmarkTreeNode = HeadingOutlineEntry & {
    children: BookmarkTreeNode[];
};

export type PhysicalPageReference = {
    readonly originalPageIndex: number;
    readonly finalPageIndex: number | null;
    readonly originalPageLabel: string;
    readonly finalPageLabel: string | null;
    readonly originalLinkTarget: string;
    readonly finalLinkTarget: string | null;
};

export type SourceAnchorReference = {
    readonly sourceId: string;
    readonly sourceType?: string;
    readonly firstPageIndex: number;
    readonly finalFirstPageIndex: number | null;
    readonly firstY: number;
    readonly pageIndices: readonly number[];
    readonly finalPageIndices: readonly (number | null)[];
    readonly fragmentCount: number;
    readonly linkTarget: string;
    readonly finalLinkTarget: string | null;
};

export type TableOfContentsElementOptions = {
    title?: string;
    titleType?: string;
    entryType?: string;
    indentPerLevel?: number;
    includeTitle?: boolean;
};

export type ReservedTableOfContentsPlan = {
    readonly reservedPageCount: number;
    readonly tocElements: readonly Element[];
    readonly tocPages: readonly Page[];
    readonly tocSnapshot: PrintPipelineSnapshot;
    readonly bodyPages: readonly Page[];
    readonly fitsReservation: boolean;
    readonly overflowPageCount: number;
};

export type PrintPipelineArtifactBundle = {
    readonly body: PrintPipelineSnapshot;
    readonly tableOfContents: {
        readonly declared: boolean;
        readonly status: 'not-configured' | 'fits-reservation' | 'overflow';
        readonly overflowPageCount: number;
        readonly plan: ReservedTableOfContentsPlan | null;
    };
    readonly assembly: PrintAssemblyPlan;
    readonly bodyPageReferences: readonly PhysicalPageReference[];
    readonly navigation: {
        readonly headingOutline: readonly HeadingOutlineEntry[];
        readonly assembledHeadingOutline: readonly HeadingOutlineEntry[];
        readonly bookmarkTree: readonly BookmarkTreeNode[];
        readonly assembledBookmarkTree: readonly BookmarkTreeNode[];
        readonly sourceAnchorsBySourceId: Readonly<Record<string, SourceAnchorReference>>;
    };
    getSourceAnchor(sourceId: string): SourceAnchorReference | undefined;
};

export type PrintAssemblyPageEntry = {
    readonly finalPageIndex: number;
    readonly source: 'toc' | 'body' | 'reserved-empty';
    readonly sourcePageIndex: number | null;
};

export type PrintAssemblyPlan = {
    readonly status: 'body-only' | 'reserved-front-matter' | 'overflow';
    readonly reservedFrontMatterPageCount: number;
    readonly bodyStartPageIndex: number;
    readonly omittedTocPageCount: number;
    readonly bodyFinalPageIndexByBodyPageIndex: readonly number[];
    readonly tocFinalPageIndexByTocPageIndex: readonly (number | null)[];
    readonly pages: readonly PrintAssemblyPageEntry[];
};

export function getSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): SimulationArtifactMap[K] | undefined {
    return report?.artifacts?.[key] as SimulationArtifactMap[K] | undefined;
}

export function hasSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): boolean {
    return getSimulationArtifact(report, key) !== undefined;
}

export function requireSimulationArtifact<K extends SimulationArtifactKey>(
    report: SimulationReport | null | undefined,
    key: K
): NonNullable<SimulationArtifactMap[K]> {
    const artifact = getSimulationArtifact(report, key);
    if (artifact === undefined) {
        throw new Error(`[SimulationReport] Missing required artifact "${key}".`);
    }
    return artifact as NonNullable<SimulationArtifactMap[K]>;
}

export function createSimulationReportReader(
    report: SimulationReport | null | undefined
): SimulationReportReader {
    return {
        report,
        pageCount: report?.pageCount ?? 0,
        actorCount: report?.actorCount ?? 0,
        splitTransitionCount: report?.splitTransitionCount ?? 0,
        generatedBoxCount: report?.generatedBoxCount ?? 0,
        profile: report?.profile,
        get: (key) => getSimulationArtifact(report, key),
        has: (key) => hasSimulationArtifact(report, key),
        require: (key) => requireSimulationArtifact(report, key)
    };
}

export function createPrintPipelineSnapshot(
    pages: readonly Page[],
    report: SimulationReport | null | undefined
): PrintPipelineSnapshot {
    return {
        pages,
        report: report ?? undefined,
        reader: createSimulationReportReader(report)
    };
}

function createReaderFromSource(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined
): SimulationReportReader {
    return 'reader' in (source || {})
        ? (source as PrintPipelineSnapshot).reader
        : createSimulationReportReader(source as SimulationReport | null | undefined);
}

export function getHeadingOutline(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined
): HeadingOutlineEntry[] {
    const reader = createReaderFromSource(source);
    const headings = reader.get(simulationArtifactKeys.headingTelemetry) ?? [];

    return headings.map((heading) => ({
        sourceId: heading.sourceId,
        heading: heading.heading,
        pageIndex: heading.pageIndex,
        y: heading.y,
        actorKind: heading.actorKind,
        sourceType: heading.sourceType,
        semanticRole: heading.semanticRole,
        level: heading.level
    }));
}

export function remapHeadingOutlineWithAssembly(
    outline: readonly HeadingOutlineEntry[],
    assembly: PrintAssemblyPlan
): HeadingOutlineEntry[] {
    return outline.map((entry) => {
        const originalPageIndex = Number.isFinite(entry.pageIndex) ? Math.max(0, Number(entry.pageIndex)) : 0;
        const finalPageIndex = assembly.bodyFinalPageIndexByBodyPageIndex[originalPageIndex];
        return {
            ...entry,
            pageIndex: Number.isFinite(finalPageIndex) ? Number(finalPageIndex) : originalPageIndex
        };
    });
}

export function remapBodyPageIndexWithAssembly(
    pageIndex: number,
    assembly: PrintAssemblyPlan
): number | null {
    const originalPageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(Number(pageIndex))) : 0;
    const finalPageIndex = assembly.bodyFinalPageIndexByBodyPageIndex[originalPageIndex];
    return Number.isFinite(finalPageIndex) ? Number(finalPageIndex) : null;
}

export function buildPhysicalPageLinkTarget(
    pageIndex: number
): string {
    const normalizedPageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(Number(pageIndex))) : 0;
    return `#page=${normalizedPageIndex + 1}`;
}

export function remapPhysicalPageLinkTargetWithAssembly(
    pageIndex: number,
    assembly: PrintAssemblyPlan
): string | null {
    const finalPageIndex = remapBodyPageIndexWithAssembly(pageIndex, assembly);
    return finalPageIndex === null ? null : buildPhysicalPageLinkTarget(finalPageIndex);
}

export function resolvePhysicalPageReference(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined,
    pageIndex: number,
    assembly?: PrintAssemblyPlan
): PhysicalPageReference {
    const reader = createReaderFromSource(source);
    const originalPageIndex = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(Number(pageIndex))) : 0;
    const finalPageIndex = assembly
        ? remapBodyPageIndexWithAssembly(originalPageIndex, assembly)
        : originalPageIndex;

    return {
        originalPageIndex,
        finalPageIndex,
        originalPageLabel: resolveTableOfContentsPageLabel(reader, originalPageIndex),
        finalPageLabel: finalPageIndex === null ? null : String(finalPageIndex + 1),
        originalLinkTarget: buildPhysicalPageLinkTarget(originalPageIndex),
        finalLinkTarget: finalPageIndex === null ? null : buildPhysicalPageLinkTarget(finalPageIndex)
    };
}

export function buildBookmarkTree(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined
): BookmarkTreeNode[] {
    const outline = getHeadingOutline(source);
    return buildBookmarkTreeFromOutline(outline);
}

export function buildBookmarkTreeFromOutline(
    outline: readonly HeadingOutlineEntry[]
): BookmarkTreeNode[] {
    const roots: BookmarkTreeNode[] = [];
    const stack: BookmarkTreeNode[] = [];

    for (const entry of outline) {
        const normalizedLevel = Number.isFinite(entry.level) ? Math.max(1, Number(entry.level)) : 1;
        const node: BookmarkTreeNode = {
            ...entry,
            level: normalizedLevel,
            children: []
        };

        while (stack.length > 0 && Number(stack[stack.length - 1]?.level || 1) >= normalizedLevel) {
            stack.pop();
        }

        if (stack.length === 0) {
            roots.push(node);
        } else {
            stack[stack.length - 1].children.push(node);
        }

        stack.push(node);
    }

    return roots;
}

export function buildAssembledBookmarkTree(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined,
    assembly: PrintAssemblyPlan
): BookmarkTreeNode[] {
    return buildBookmarkTreeFromOutline(remapHeadingOutlineWithAssembly(getHeadingOutline(source), assembly));
}

export function buildSourceAnchorsBySourceId(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined,
    assembly?: PrintAssemblyPlan
): Readonly<Record<string, SourceAnchorReference>> {
    const reader = createReaderFromSource(source);
    const positions = reader.get(simulationArtifactKeys.sourcePositionMap) ?? [];
    const anchors: Record<string, SourceAnchorReference> = {};

    for (const position of positions) {
        const finalFirstPageIndex = assembly
            ? remapBodyPageIndexWithAssembly(position.firstPageIndex, assembly)
            : position.firstPageIndex;
        const finalPageIndices = position.pageIndices.map((pageIndex) =>
            assembly ? remapBodyPageIndexWithAssembly(pageIndex, assembly) : pageIndex
        );
        anchors[position.sourceId] = {
            sourceId: position.sourceId,
            sourceType: position.sourceType,
            firstPageIndex: position.firstPageIndex,
            finalFirstPageIndex,
            firstY: position.firstY,
            pageIndices: [...position.pageIndices],
            finalPageIndices,
            fragmentCount: position.fragmentCount,
            linkTarget: buildPhysicalPageLinkTarget(position.firstPageIndex),
            finalLinkTarget: finalFirstPageIndex === null ? null : buildPhysicalPageLinkTarget(finalFirstPageIndex)
        };
    }

    return anchors;
}

export function getSourceAnchorReference(
    bundle: PrintPipelineArtifactBundle,
    sourceId: string
): SourceAnchorReference | undefined {
    return bundle.navigation.sourceAnchorsBySourceId[String(sourceId || '')];
}

function resolveTableOfContentsPageLabel(
    reader: SimulationReportReader,
    pageIndex: number
): string {
    const pageSummaries = reader.get(simulationArtifactKeys.pageNumberSummary) ?? [];
    const pageSummary = pageSummaries.find((item) => item.pageIndex === pageIndex);
    if (pageSummary?.usesLogicalNumbering && pageSummary.logicalPageNumber !== null) {
        return String(pageSummary.logicalPageNumber);
    }
    if (pageSummary?.physicalPageNumber) {
        return String(pageSummary.physicalPageNumber);
    }
    return String(pageIndex + 1);
}

export function buildTableOfContentsElements(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined,
    options: TableOfContentsElementOptions = {}
): Element[] {
    const {
        title = 'Contents',
        titleType = 'h1',
        entryType = 'p',
        indentPerLevel = 18,
        includeTitle = true
    } = options;
    const reader = createReaderFromSource(source);
    const outline = getHeadingOutline(source);
    const elements: Element[] = [];

    if (includeTitle) {
        elements.push({
            type: titleType,
            content: title,
            properties: {
                sourceId: 'generated-toc-title',
                semanticRole: 'toc-title'
            }
        });
    }

    for (const entry of outline) {
        const depth = Math.max(0, (entry.level ?? 1) - 1);
        const pageLabel = resolveTableOfContentsPageLabel(reader, entry.pageIndex);
        const linkTarget = buildPhysicalPageLinkTarget(entry.pageIndex);
        elements.push({
            type: entryType,
            content: `${entry.heading} ${pageLabel}`,
            properties: {
                sourceId: `generated-toc:${entry.sourceId}`,
                linkTarget,
                semanticRole: 'toc-entry',
                _generatedTocSourceId: entry.sourceId,
                _generatedTocLevel: entry.level ?? 1,
                _generatedTocPageIndex: entry.pageIndex,
                _generatedTocPageLabel: pageLabel,
                _generatedTocLinkTarget: linkTarget,
                style: {
                    marginLeft: depth * indentPerLevel,
                    marginBottom: 4,
                    fontWeight: depth === 0 ? 'bold' : undefined
                }
            }
        });
    }

    return elements;
}

export function buildAssembledTableOfContentsElements(
    source: PrintPipelineSnapshot | SimulationReport | null | undefined,
    assembly: PrintAssemblyPlan,
    options: TableOfContentsElementOptions = {}
): Element[] {
    const outline = remapHeadingOutlineWithAssembly(getHeadingOutline(source), assembly);
    const {
        title = 'Contents',
        titleType = 'h1',
        entryType = 'p',
        indentPerLevel = 18,
        includeTitle = true
    } = options;
    const elements: Element[] = [];

    if (includeTitle) {
        elements.push({
            type: titleType,
            content: title,
            properties: {
                sourceId: 'generated-toc-title',
                semanticRole: 'toc-title'
            }
        });
    }

    for (const entry of outline) {
        const depth = Math.max(0, (entry.level ?? 1) - 1);
        const finalPageIndex = entry.pageIndex;
        const pageLabel = String(finalPageIndex + 1);
        const linkTarget = buildPhysicalPageLinkTarget(finalPageIndex);
        elements.push({
            type: entryType,
            content: `${entry.heading} ${pageLabel}`,
            properties: {
                sourceId: `generated-toc:${entry.sourceId}`,
                linkTarget,
                semanticRole: 'toc-entry',
                _generatedTocSourceId: entry.sourceId,
                _generatedTocLevel: entry.level ?? 1,
                _generatedTocPageIndex: finalPageIndex,
                _generatedTocPageLabel: pageLabel,
                _generatedTocLinkTarget: linkTarget,
                style: {
                    marginLeft: depth * indentPerLevel,
                    marginBottom: 4,
                    fontWeight: depth === 0 ? 'bold' : undefined
                }
            }
        });
    }

    return elements;
}
