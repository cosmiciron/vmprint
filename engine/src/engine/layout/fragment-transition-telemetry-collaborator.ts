import type { Page } from '../types';
import { LayoutCollaborator, LayoutSession } from './layout-session';

export type FragmentationSummary = {
    sourceActorId: string;
    splitCount: number;
    continuationCount: number;
    pageIndices: number[];
};

export class FragmentTransitionTelemetryCollaborator implements LayoutCollaborator {
    onSimulationComplete(_pages: Page[], session: LayoutSession): void {
        const summaries = new Map<string, FragmentationSummary>();
        for (const transition of session.getFragmentTransitions()) {
            const existing = summaries.get(transition.sourceActorId) ?? {
                sourceActorId: transition.sourceActorId,
                splitCount: 0,
                continuationCount: 0,
                pageIndices: []
            };
            existing.splitCount += 1;
            if (transition.continuationActorId) {
                existing.continuationCount += 1;
            }
            if (!existing.pageIndices.includes(transition.pageIndex)) {
                existing.pageIndices.push(transition.pageIndex);
                existing.pageIndices.sort((a, b) => a - b);
            }
            summaries.set(transition.sourceActorId, existing);
        }

        session.setTelemetry('fragmentationSummary', Array.from(summaries.values()));
    }
}
