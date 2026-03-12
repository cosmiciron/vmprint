import type { PackagerTransformCapability } from './packagers/packager-types';
import { LayoutCollaborator, LayoutSession } from './layout-session';
import { simulationArtifactKeys } from './simulation-report';
import { resolvePackagerTransformProfile } from './packagers/packager-types';

export type TransformCapabilitySummary = {
    sourceId: string;
    actorKind: string;
    supportedTransforms: string[];
    capabilities: PackagerTransformCapability[];
};

export class TransformCapabilityArtifactCollaborator implements LayoutCollaborator {
    onSimulationComplete(session: LayoutSession): void {
        const summaries = new Map<string, TransformCapabilitySummary>();

        for (const actor of session.getRegisteredActors()) {
            const profile = resolvePackagerTransformProfile(actor);
            if (!profile) continue;

            const key = `${actor.sourceId}::${actor.actorKind}`;
            const existing = summaries.get(key);
            if (!existing) {
                summaries.set(key, {
                    sourceId: actor.sourceId,
                    actorKind: actor.actorKind,
                    supportedTransforms: [...(profile.supportedTransforms || [])].sort(),
                    capabilities: [...(profile.capabilities || [])].sort((a, b) => a.kind.localeCompare(b.kind))
                });
                continue;
            }

            existing.supportedTransforms = Array.from(
                new Set([...existing.supportedTransforms, ...(profile.supportedTransforms || [])])
            ).sort();
            const capabilityMap = new Map(existing.capabilities.map((capability) => [capability.kind, capability] as const));
            for (const capability of profile.capabilities || []) {
                const current = capabilityMap.get(capability.kind);
                capabilityMap.set(capability.kind, {
                    kind: capability.kind,
                    preservesIdentity: current?.preservesIdentity || capability.preservesIdentity,
                    producesContinuation: current?.producesContinuation || capability.producesContinuation,
                    reflowsContent: current?.reflowsContent || capability.reflowsContent,
                    clonesStableSubstructure: current?.clonesStableSubstructure || capability.clonesStableSubstructure
                });
            }
            existing.capabilities = Array.from(capabilityMap.values()).sort((a, b) => a.kind.localeCompare(b.kind));
        }

        session.publishArtifact(
            simulationArtifactKeys.transformCapabilitySummary,
            Array.from(summaries.values()).sort((a, b) =>
                a.sourceId.localeCompare(b.sourceId) || a.actorKind.localeCompare(b.actorKind)
            )
        );
    }
}
