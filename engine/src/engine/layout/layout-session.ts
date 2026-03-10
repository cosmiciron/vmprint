import type { Box, Page } from '../types';
import type { EngineRuntime } from '../runtime';
import type { ContinuationArtifacts } from './layout-core-types';
import type { PackagerUnit } from './packagers/packager-types';

export type RegionReservation = {
    id: string;
    height: number;
    source?: string;
};

export type SpatialExclusion = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    source?: string;
};

export class ConstraintField {
    readonly reservations: RegionReservation[] = [];
    readonly exclusions: SpatialExclusion[] = [];

    constructor(
        public availableWidth: number,
        public availableHeight: number
    ) { }

    get effectiveAvailableHeight(): number {
        const reserved = this.reservations.reduce((sum, reservation) => {
            const height = Number.isFinite(reservation.height) ? Math.max(0, Number(reservation.height)) : 0;
            return sum + height;
        }, 0);
        return Math.max(0, this.availableHeight - reserved);
    }
}

export class PageSurface {
    constructor(
        public readonly pageIndex: number,
        public readonly width: number,
        public readonly height: number,
        public readonly boxes: Box[]
    ) { }

    finalize(): Page {
        return {
            index: this.pageIndex,
            width: this.width,
            height: this.height,
            boxes: this.boxes
        };
    }
}

export interface LayoutCollaborator {
    onSimulationStart?(session: LayoutSession): void;
    onActorSpawn?(actor: PackagerUnit, session: LayoutSession): void;
    onPageStart?(pageIndex: number, surface: PageSurface, session: LayoutSession): void;
    onConstraintNegotiation?(actor: PackagerUnit, constraints: ConstraintField, session: LayoutSession): void;
    onActorPrepared?(actor: PackagerUnit, session: LayoutSession): void;
    onActorCommitted?(actor: PackagerUnit, committed: Box[], surface: PageSurface, session: LayoutSession): void;
    onContinuationProduced?(predecessor: PackagerUnit, successor: PackagerUnit, session: LayoutSession): void;
    onPageFinalized?(surface: PageSurface, session: LayoutSession): void;
    onSimulationComplete?(pages: Page[], session: LayoutSession): boolean | void;
}

type LayoutSessionOptions = {
    runtime: EngineRuntime;
    collaborators?: readonly LayoutCollaborator[];
};

export class LayoutSession {
    readonly runtime: EngineRuntime;
    readonly collaborators: readonly LayoutCollaborator[];
    readonly actorRegistry: PackagerUnit[] = [];
    readonly telemetry = new Map<string, unknown>();
    private readonly continuationArtifacts = new Map<string, ContinuationArtifacts>();

    currentPageIndex = 0;
    currentY = 0;
    currentConstraintField: ConstraintField | null = null;
    currentSurface: PageSurface | null = null;

    constructor(options: LayoutSessionOptions) {
        this.runtime = options.runtime;
        this.collaborators = options.collaborators ?? [];
    }

    notifySimulationStart(): void {
        for (const collaborator of this.collaborators) {
            collaborator.onSimulationStart?.(this);
        }
    }

    notifyActorSpawn(actor: PackagerUnit): void {
        this.actorRegistry.push(actor);
        for (const collaborator of this.collaborators) {
            collaborator.onActorSpawn?.(actor, this);
        }
    }

    notifyPageStart(pageIndex: number, width: number, height: number, boxes: Box[]): void {
        this.currentPageIndex = pageIndex;
        this.currentSurface = new PageSurface(pageIndex, width, height, boxes);
        for (const collaborator of this.collaborators) {
            collaborator.onPageStart?.(pageIndex, this.currentSurface, this);
        }
    }

    notifyConstraintNegotiation(actor: PackagerUnit, constraints: ConstraintField): void {
        this.currentConstraintField = constraints;
        for (const collaborator of this.collaborators) {
            collaborator.onConstraintNegotiation?.(actor, constraints, this);
        }
    }

    notifyActorPrepared(actor: PackagerUnit): void {
        for (const collaborator of this.collaborators) {
            collaborator.onActorPrepared?.(actor, this);
        }
    }

    notifyActorCommitted(actor: PackagerUnit, committed: Box[]): void {
        if (!this.currentSurface) return;
        for (const collaborator of this.collaborators) {
            collaborator.onActorCommitted?.(actor, committed, this.currentSurface, this);
        }
    }

    notifyContinuationProduced(predecessor: PackagerUnit, successor: PackagerUnit): void {
        this.actorRegistry.push(successor);
        for (const collaborator of this.collaborators) {
            collaborator.onContinuationProduced?.(predecessor, successor, this);
        }
    }

    finalizePages(pages: Page[]): Page[] {
        const finalizedPages = pages.map((page) => {
            const surface = new PageSurface(page.index, page.width, page.height, [...page.boxes]);
            for (const collaborator of this.collaborators) {
                collaborator.onPageFinalized?.(surface, this);
            }
            return surface.finalize();
        });

        for (const collaborator of this.collaborators) {
            collaborator.onSimulationComplete?.(finalizedPages, this);
        }

        return finalizedPages;
    }

    setTelemetry<T>(key: string, value: T): void {
        this.telemetry.set(key, value);
    }

    getTelemetry<T>(key: string): T | undefined {
        return this.telemetry.get(key) as T | undefined;
    }

    setContinuationArtifacts(actorId: string, artifacts: ContinuationArtifacts): void {
        this.continuationArtifacts.set(actorId, artifacts);
    }

    getContinuationArtifacts(actorId: string): ContinuationArtifacts | undefined {
        return this.continuationArtifacts.get(actorId);
    }
}
