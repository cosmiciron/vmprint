import { FlowBox } from '../layout-core-types';
import type { Collaborator, CollaboratorHost } from '../layout-session-types';

import { PackagerReshapeResult, PackagerUnit } from '../packagers/packager-types';
import { FlowBoxPackager } from '../packagers/flow-box-packager';

export class ContinuationMarkerCollaborator implements Collaborator {
    onActorPrepared(actor: PackagerUnit, host: CollaboratorHost): void {
        const artifacts = host.ensureContinuationArtifacts(actor);
        if (!artifacts) return;
    }

    onSplitAccepted(
        attempt: { actor: PackagerUnit },
        result: PackagerReshapeResult,
        host: CollaboratorHost
    ): void {
        const artifacts = host.ensureContinuationArtifacts(attempt.actor);
        if (!artifacts) return;
        if (result.currentFragment && artifacts.markerAfterSplit) {
            host.stageMarkersAfterSplit(result.currentFragment.actorId, [artifacts.markerAfterSplit]);
        }
        const continuation = result.continuationFragment;
        if (!continuation) return;
        if (!artifacts.markersBeforeContinuation?.length) return;

        const processor = (attempt.actor as any).processor;
        if (!processor) return;

        const markerPackagers = artifacts.markersBeforeContinuation.map((marker) =>
            new FlowBoxPackager(processor, marker)
        );
        host.stageActorsBeforeContinuation(continuation.actorId, markerPackagers);
    }
}
