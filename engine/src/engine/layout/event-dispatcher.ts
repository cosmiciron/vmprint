import type { Box } from '../types';
import type { PackagerSplitResult, PackagerUnit } from './packagers/packager-types';
import type { LayoutSession } from './layout-session';
import type { Collaborator, ConstraintField, PageSurface, SplitAttempt } from './layout-session-types';

export class EventDispatcher {
    constructor(
        private readonly collaborators: readonly Collaborator[]
    ) { }

    onSimulationStart(session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSimulationStart?.(session);
        }
    }

    onActorSpawn(actor: PackagerUnit, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorSpawn?.(actor, session);
        }
    }

    onPageStart(pageIndex: number, surface: PageSurface, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onPageStart?.(pageIndex, surface, session);
        }
    }

    onConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onConstraintNegotiation?.(actor, constraints, session);
        }
    }

    onActorPrepared(actor: PackagerUnit, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorPrepared?.(actor, session);
        }
    }

    onSplitAttempt(attempt: SplitAttempt, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAttempt?.(attempt, session);
        }
    }

    onSplitAccepted(attempt: SplitAttempt, result: PackagerSplitResult, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSplitAccepted?.(attempt, result, session);
        }
    }

    onActorCommitted(actor: PackagerUnit, committed: Box[], surface: PageSurface, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorCommitted?.(actor, committed, surface, session);
        }
    }

    onContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationProduced?.(predecessor, successor, session);
        }
    }

    onContinuationEnqueued(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationEnqueued?.(predecessor, successor, session);
            collaborator.onContinuationProduced?.(predecessor, successor, session);
        }
    }

    onPageFinalized(surface: PageSurface, session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onPageFinalized?.(surface, session);
        }
    }

    onSimulationComplete(session: LayoutSession): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSimulationComplete?.(session);
        }
    }
}
