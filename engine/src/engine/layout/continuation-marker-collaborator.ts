import { ContinuationArtifacts, FlowBox } from './layout-core-types';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { PackagerUnit } from './packagers/packager-types';

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
        const flowBox = resolveFlowBox(actor);
        if (!flowBox || !hasContinuationSpec(flowBox)) return;

        const continuationSpec =
            flowBox.properties?.paginationContinuation ??
            flowBox._sourceElement?.properties?.paginationContinuation;
        if (continuationSpec && flowBox.properties && flowBox.properties.paginationContinuation === undefined) {
            flowBox.properties.paginationContinuation = continuationSpec;
        }

        const artifacts = ((actor as any).processor as any)?.getContinuationArtifacts?.(flowBox) as ContinuationArtifacts | undefined;
        if (!artifacts) return;
        session.setContinuationArtifacts(actor.actorId, artifacts);
    }
}
