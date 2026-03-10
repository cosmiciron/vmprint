import { ContinuationArtifacts, FlowBox } from './layout-core-types';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { PackagerSplitResult, PackagerUnit } from './packagers/packager-types';
import { FlowBoxPackager } from './packagers/flow-box-packager';

function resolveFlowBox(actor: PackagerUnit): FlowBox | null {
    const flowBox = (actor as any).flowBox as FlowBox | undefined;
    if (!flowBox) return null;
    return flowBox;
}

function hasContinuationSpec(flowBox: FlowBox): boolean {
    return !!(flowBox?.properties?.paginationContinuation ?? flowBox?._sourceElement?.properties?.paginationContinuation);
}

export class ContinuationMarkerCollaborator implements LayoutCollaborator {
    onActorPrepared(actor: PackagerUnit, session: LayoutSession): void {
        if (session.getContinuationArtifacts(actor.actorId)) return;
        const artifacts = this.resolveArtifacts(actor);
        if (!artifacts) return;
        session.setContinuationArtifacts(actor.actorId, artifacts);
    }

    onSplitAccepted(
        attempt: { actor: PackagerUnit },
        result: PackagerSplitResult,
        session: LayoutSession
    ): void {
        const artifacts = session.getContinuationArtifacts(attempt.actor.actorId) ?? this.resolveArtifacts(attempt.actor);
        if (!artifacts) return;
        session.setContinuationArtifacts(attempt.actor.actorId, artifacts);
        if (result.currentFragment && artifacts.markerAfterSplit) {
            session.stageMarkersAfterSplit(result.currentFragment.actorId, [artifacts.markerAfterSplit]);
        }
        const continuation = result.continuationFragment;
        if (!continuation) return;
        if (!artifacts.markersBeforeContinuation?.length) return;

        const processor = (attempt.actor as any).processor;
        if (!processor) return;

        const markerPackagers = artifacts.markersBeforeContinuation.map((marker) =>
            new FlowBoxPackager(processor, marker)
        );
        session.stageActorsBeforeContinuation(continuation.actorId, markerPackagers);
    }

    private resolveArtifacts(actor: PackagerUnit): ContinuationArtifacts | undefined {
        const flowBox = resolveFlowBox(actor);
        if (!flowBox || !hasContinuationSpec(flowBox)) return;

        const continuationSpec =
            flowBox.properties?.paginationContinuation ??
            flowBox._sourceElement?.properties?.paginationContinuation;
        if (continuationSpec && flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
            flowBox.properties.paginationContinuation = continuationSpec;
        }

        return ((actor as any).processor as any)?.getContinuationArtifacts?.(flowBox) as ContinuationArtifacts | undefined;
    }
}
