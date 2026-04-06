import type { PackagerReshapeCapability } from '../packagers/packager-types';
import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';
import { resolvePackagerReshapeProfile } from '../packagers/packager-types';

export type TransformCapabilitySummary = {
    sourceId: string;
    actorKind: string;
    supportedReshapes: string[];
    capabilities: PackagerReshapeCapability[];
};

export class TransformCapabilityArtifactCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    onSimulationComplete(host: CollaboratorHost): void {
        const summaries = new Map<string, TransformCapabilitySummary>();

        for (const actor of host.getRegisteredActors()) {
            const profile = resolvePackagerReshapeProfile(actor);
            if (!profile) continue;

            const key = `${actor.sourceId}::${actor.actorKind}`;
            const existing = summaries.get(key);
            if (!existing) {
                summaries.set(key, {
                    sourceId: actor.sourceId,
                    actorKind: actor.actorKind,
                    supportedReshapes: [...(profile.supportedReshapes || [])].sort(),
                    capabilities: [...(profile.capabilities || [])].sort((a, b) => a.kind.localeCompare(b.kind))
                });
                continue;
            }

            existing.supportedReshapes = Array.from(
                new Set([...existing.supportedReshapes, ...(profile.supportedReshapes || [])])
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

        host.publishArtifact(
            simulationArtifactKeys.transformCapabilitySummary,
            Array.from(summaries.values()).sort((a, b) =>
                a.sourceId.localeCompare(b.sourceId) || a.actorKind.localeCompare(b.actorKind)
            )
        );
    }
}
