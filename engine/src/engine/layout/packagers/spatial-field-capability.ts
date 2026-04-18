import type {
    Element,
    ElementSimulationDirective,
    SimulationMotionAxis,
    SpatialFieldDirective
} from '../../types';
import {
    ObservationResult,
    PackagerContext,
    SpatialFrontier,
    resolvePackagerWorldYAtCursor
} from './packager-types';

export type SpatialFieldMovementActorInfo = {
    actorId: string;
    sourceId: string;
    actorKind: string;
    fragmentIndex: number;
};

export type SpatialFieldMovementState = {
    tick: number;
    timeSeconds: number;
    x: number;
    y: number;
    label?: string;
};

export class SpatialFieldGeometryCapability {
    private readonly field: SpatialFieldDirective | undefined;
    private readonly placement: Element['placement'];

    constructor(element: Element) {
        this.field = element.properties?.space ?? element.properties?.spatialField;
        this.placement = element.placement;
    }

    get enabled(): boolean {
        return !!this.field || !!this.placement?.exclusionAssembly || !!this.placement?.shape;
    }

    buildClipProperties(): Record<string, unknown> {
        const assembly = this.field?.exclusionAssembly ?? this.placement?.exclusionAssembly;
        const shape = this.field?.shape ?? this.placement?.shape;
        return {
            ...(assembly?.members
                ? {
                    _clipAssembly: assembly.members.map((member) => ({
                        x: Number(member.x ?? 0),
                        y: Number(member.y ?? 0),
                        w: Math.max(0, Number(member.w ?? 0)),
                        h: Math.max(0, Number(member.h ?? 0)),
                        shape: (member.shape ?? 'rect') as 'rect' | 'circle' | 'polygon',
                        ...(typeof member.path === 'string' && member.path.trim()
                            ? { path: member.path.trim() }
                            : {})
                    }))
                }
                : {}),
            ...(shape ? { _clipShape: shape } : {}),
            ...(typeof this.field?.path === 'string' && this.field.path.trim()
                ? { _clipPath: this.field.path.trim() }
                : typeof this.placement?.path === 'string' && this.placement.path.trim()
                    ? { _clipPath: this.placement.path.trim() }
                    : {})
        };
    }
}

export class SpatialFieldMovementCapability {
    private readonly motion: ElementSimulationDirective | null;
    private currentX = 0;
    private currentY = 0;
    private currentTick = 0;
    private currentTimeSeconds = 0;

    constructor(value: unknown) {
        this.motion = normalizeMotionDirective(value);
        this.currentX = resolveMotionAxisPosition(this.motion?.x, 0);
        this.currentY = resolveMotionAxisPosition(this.motion?.y, 0);
    }

    get enabled(): boolean {
        return this.motion !== null;
    }

    get state(): SpatialFieldMovementState {
        return {
            tick: this.currentTick,
            timeSeconds: this.currentTimeSeconds,
            x: this.currentX,
            y: this.currentY,
            ...(this.motion?.label ? { label: this.motion.label } : {})
        };
    }

    prepare(context: PackagerContext): void {
        if (!this.motion || !Number.isFinite(context.simulationTick)) return;
        this.currentTick = Math.max(0, Math.floor(Number(context.simulationTick)));
        this.currentTimeSeconds = resolveSimulationTimeSeconds(context, this.currentTick);
        this.currentX = resolveMotionAxisPosition(this.motion.x, this.currentTimeSeconds);
        this.currentY = resolveMotionAxisPosition(this.motion.y, this.currentTimeSeconds);
    }

    wantsSimulationTicks(context: PackagerContext): boolean {
        if (!this.motion) return false;
        const tick = Number.isFinite(context.simulationTick)
            ? Math.max(0, Math.floor(Number(context.simulationTick)))
            : 0;
        const progression = context.simulationProgression
            ?? context.processor?.getSimulationProgressionConfig?.();
        const maxTicks = Number.isFinite(this.motion.maxTicks)
            ? Math.max(0, Math.floor(Number(this.motion.maxTicks)))
            : progression?.policy === 'fixed-tick-count'
                ? Math.max(0, Math.floor(Number(progression.maxTicks)))
                : null;
        if (maxTicks !== null) {
            if (progression?.policy === 'fixed-tick-count' && this.motion.maxTicks === undefined) {
                return tick <= maxTicks;
            }
            return tick < maxTicks;
        }
        return false;
    }

    stepSimulationTick(
        context: PackagerContext,
        actor: SpatialFieldMovementActorInfo,
        resolveFrontier: () => SpatialFrontier
    ): ObservationResult | null {
        if (!this.motion || !this.wantsSimulationTicks(context)) {
            return null;
        }

        const tick = Number.isFinite(context.simulationTick)
            ? Math.max(0, Math.floor(Number(context.simulationTick)))
            : 0;
        const timeSeconds = resolveSimulationTimeSeconds(context, tick);
        const nextX = resolveMotionAxisPosition(this.motion.x, timeSeconds);
        const nextY = resolveMotionAxisPosition(this.motion.y, timeSeconds);
        const changed =
            Math.abs(nextX - this.currentX) > 0.01
            || Math.abs(nextY - this.currentY) > 0.01
            || tick !== this.currentTick;

        this.currentTick = tick;
        this.currentTimeSeconds = timeSeconds;
        this.currentX = nextX;
        this.currentY = nextY;

        context.publishActorSignal({
            topic: 'simulation:actor-tick',
            publisherActorId: actor.actorId,
            publisherSourceId: actor.sourceId,
            publisherActorKind: actor.actorKind,
            fragmentIndex: actor.fragmentIndex,
            pageIndex: context.pageIndex,
            cursorY: context.cursorY,
            worldY: resolvePackagerWorldYAtCursor(context),
            signalKey: `${actor.actorId}:tick:${tick}`,
            payload: {
                tick,
                timeSeconds,
                x: this.currentX,
                y: this.currentY,
                label: this.motion.label
            }
        });

        if (!changed) {
            return {
                changed: false,
                geometryChanged: false,
                updateKind: 'none'
            };
        }

        const updateKind = this.motion.updateKind ?? 'geometry';
        const frontier = updateKind === 'geometry' ? resolveFrontier() : undefined;

        return {
            changed: true,
            geometryChanged: updateKind === 'geometry',
            updateKind,
            earliestAffectedFrontier: frontier
        };
    }
}

export function normalizeMotionDirective(value: unknown): ElementSimulationDirective | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const directive = value as ElementSimulationDirective;
    if (directive.enabled === false) {
        return null;
    }
    const hasMotion = directive.x !== undefined || directive.y !== undefined;
    if (!hasMotion && !directive.label) {
        return null;
    }
    return {
        enabled: true,
        ...(Number.isFinite(directive.maxTicks) ? { maxTicks: Math.max(0, Math.floor(Number(directive.maxTicks))) } : {}),
        updateKind: directive.updateKind === 'content-only' ? 'content-only' : 'geometry',
        ...(directive.x ? { x: normalizeAxis(directive.x) } : {}),
        ...(directive.y ? { y: normalizeAxis(directive.y) } : {}),
        ...(typeof directive.label === 'string' ? { label: directive.label } : {})
    };
}

function normalizeAxis(axis: SimulationMotionAxis): SimulationMotionAxis {
    return {
        start: Number.isFinite(axis.start) ? Number(axis.start) : 0,
        velocity: Number.isFinite(axis.velocity) ? Number(axis.velocity) : 0,
        amplitude: Number.isFinite(axis.amplitude) ? Number(axis.amplitude) : 0,
        frequency: Number.isFinite(axis.frequency) ? Number(axis.frequency) : 0,
        phase: Number.isFinite(axis.phase) ? Number(axis.phase) : 0
    };
}

export function resolveMotionAxisPosition(axis: SimulationMotionAxis | null | undefined, timeSeconds: number): number {
    if (!axis) return 0;
    const start = Number.isFinite(axis.start) ? Number(axis.start) : 0;
    const velocity = Number.isFinite(axis.velocity) ? Number(axis.velocity) : 0;
    const amplitude = Number.isFinite(axis.amplitude) ? Number(axis.amplitude) : 0;
    const frequency = Number.isFinite(axis.frequency) ? Number(axis.frequency) : 0;
    const phase = Number.isFinite(axis.phase) ? Number(axis.phase) : 0;
    return start
        + (velocity * timeSeconds)
        + (amplitude !== 0 ? amplitude * Math.sin(phase + (frequency * timeSeconds)) : 0);
}

function resolveSimulationTimeSeconds(context: PackagerContext, tick: number): number {
    const tickRateHz = Number.isFinite(context.simulationTickRateHz)
        ? Math.max(1, Number(context.simulationTickRateHz))
        : Number.isFinite(context.simulationProgression?.tickRateHz)
            ? Math.max(1, Number(context.simulationProgression?.tickRateHz))
            : Math.max(1, Number(context.processor?.getSimulationProgressionConfig?.().tickRateHz || 24));
    const offsetSeconds = Number.isFinite(context.simulationTimeOffsetSeconds)
        ? Number(context.simulationTimeOffsetSeconds)
        : 0;
    return offsetSeconds + (tick / tickRateHz);
}
