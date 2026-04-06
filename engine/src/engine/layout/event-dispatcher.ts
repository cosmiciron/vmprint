import type { Box } from '../types';
import type { PackagerReshapeResult, PackagerUnit } from './packagers/packager-types';
import type { CollaboratorConstraintField } from './runtime/session/session-constraint-types';
import type { PageSurface, SplitAttempt } from './runtime/session/session-lifecycle-types';
import type { Collaborator, CollaboratorHost } from './runtime/session/session-runtime-types';

export class EventDispatcher {
    private readonly coordinators: readonly Collaborator[];
    private readonly observers: readonly Collaborator[];

    constructor(collaborators: readonly Collaborator[]) {
        this.coordinators = collaborators.filter((c) => (c.mutationMode ?? 'coordinator') !== 'observer');
        this.observers = collaborators.filter((c) => c.mutationMode === 'observer');
    }

    private get all(): readonly Collaborator[] {
        return [...this.coordinators, ...this.observers];
    }

    onSimulationStart(host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onSimulationStart?.(host);
        }
    }

    onActorSpawn(actor: PackagerUnit, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onActorSpawn?.(actor, host);
        }
    }

    onPageStart(pageIndex: number, surface: PageSurface, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onPageStart?.(pageIndex, surface, host);
        }
    }

    onConstraintNegotiation(actor: PackagerUnit, constraints: CollaboratorConstraintField, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onConstraintNegotiation?.(actor, constraints, host);
        }
    }

    onActorPrepared(actor: PackagerUnit, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onActorPrepared?.(actor, host);
        }
    }

    onSplitAttempt(attempt: SplitAttempt, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onSplitAttempt?.(attempt, host);
        }
    }

    onSplitAccepted(attempt: SplitAttempt, result: PackagerReshapeResult, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onSplitAccepted?.(attempt, result, host);
        }
    }

    onActorCommitted(actor: PackagerUnit, committed: Box[], surface: PageSurface, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onActorCommitted?.(actor, committed, surface, host);
        }
    }

    onContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onContinuationProduced?.(predecessor, successor, host);
        }
    }

    onContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit, host: CollaboratorHost): void {
        for (const collaborator of this.all) {
            collaborator.onContinuationEnqueued?.(predecessor, successor, host);
            collaborator.onContinuationProduced?.(predecessor, successor, host);
        }
    }

    // Coordinators run before observers — a coordinator may mutate state that observers then read.
    onPageFinalized(surface: PageSurface, host: CollaboratorHost): void {
        for (const collaborator of this.coordinators) {
            collaborator.onPageFinalized?.(surface, host);
        }
        for (const collaborator of this.observers) {
            collaborator.onPageFinalized?.(surface, host);
        }
    }

    // Coordinators run before observers — same reason as onPageFinalized.
    onSimulationComplete(host: CollaboratorHost): void {
        for (const collaborator of this.coordinators) {
            collaborator.onSimulationComplete?.(host);
        }
        for (const collaborator of this.observers) {
            collaborator.onSimulationComplete?.(host);
        }
    }
}
