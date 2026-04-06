import { FlowBox } from '../layout-core-types';
import type { Collaborator } from '../layout-session-types';
import { LayoutSession } from '../layout-session';
import { PackagerReshapeResult, PackagerUnit } from '../packagers/packager-types';
import { FlowBoxPackager } from '../packagers/flow-box-packager';

export class ContinuationMarkerCollaborator implements Collaborator {
    onActorPrepared(actor: PackagerUnit, session: LayoutSession): void {
        const artifacts = session.ensureContinuationArtifacts(actor);
        if (!artifacts) return;
    }

    onSplitAccepted(
        attempt: { actor: PackagerUnit },
        result: PackagerReshapeResult,
        session: LayoutSession
    ): void {
        const artifacts = session.ensureContinuationArtifacts(attempt.actor);
        if (!artifacts) return;
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
}
