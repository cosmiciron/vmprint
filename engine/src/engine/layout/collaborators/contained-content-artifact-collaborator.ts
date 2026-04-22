import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

export type ContainedContentArtifactSummary = {
    sourceId: string;
    sourceType?: string;
    fragmentIndex: number;
    overflowMode: 'continue' | 'stash';
    pageIndices: number[];
    containedCharCount: number;
    stashedCharCount: number;
    overflowedCharCount: number;
    totalSourceCharCount: number;
};

type ContainedContentSummaryPayload = {
    overflowMode?: unknown;
    containedCharCount?: unknown;
    stashedCharCount?: unknown;
    overflowedCharCount?: unknown;
    totalSourceCharCount?: unknown;
};

export class ContainedContentArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summaries = new Map<string, ContainedContentArtifactSummary>();

        for (const page of host.getFinalizedPages()) {
            for (const box of page.boxes || []) {
                const payload = box.properties?._containedContentSummary as ContainedContentSummaryPayload | undefined;
                if (!payload || (payload.overflowMode !== 'continue' && payload.overflowMode !== 'stash')) {
                    continue;
                }

                const sourceId = String(box.meta?.sourceId || '');
                if (!sourceId) continue;

                const fragmentIndex = Math.max(0, Math.floor(Number(box.meta?.fragmentIndex || 0)));
                const key = `${sourceId}:${fragmentIndex}:${payload.overflowMode}`;
                const existing = summaries.get(key) ?? {
                    sourceId,
                    sourceType: box.meta?.sourceType,
                    fragmentIndex,
                    overflowMode: payload.overflowMode,
                    pageIndices: [],
                    containedCharCount: 0,
                    stashedCharCount: 0,
                    overflowedCharCount: 0,
                    totalSourceCharCount: 0
                };

                existing.containedCharCount = Math.max(existing.containedCharCount, Math.max(0, Number(payload.containedCharCount || 0)));
                existing.stashedCharCount = Math.max(existing.stashedCharCount, Math.max(0, Number(payload.stashedCharCount || 0)));
                existing.overflowedCharCount = Math.max(existing.overflowedCharCount, Math.max(0, Number(payload.overflowedCharCount || 0)));
                existing.totalSourceCharCount = Math.max(existing.totalSourceCharCount, Math.max(0, Number(payload.totalSourceCharCount || 0)));

                if (!existing.pageIndices.includes(page.index)) {
                    existing.pageIndices.push(page.index);
                    existing.pageIndices.sort((a, b) => a - b);
                }
                if (!existing.sourceType && box.meta?.sourceType) {
                    existing.sourceType = box.meta.sourceType;
                }

                summaries.set(key, existing);
            }
        }

        host.publishArtifact(
            simulationArtifactKeys.containedContentSummary,
            Array.from(summaries.values()).sort((a, b) =>
                a.sourceId.localeCompare(b.sourceId)
                || a.fragmentIndex - b.fragmentIndex
                || a.overflowMode.localeCompare(b.overflowMode)
            )
        );
    }
}
