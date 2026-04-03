import { Box, DebugRegion, Element, ElementStyle, RichLine, ZoneWorldBehavior } from '../../types';
import { LayoutProcessor } from '../layout-core';
import type { NormalizedIndependentZoneStrip } from '../normalized-zone-strip';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';
import { createContinuationIdentity, createElementPackagerIdentity, PackagerIdentity } from './packager-identity';
import {
    attachHostedRegionDebugTag,
    cloneHostedRegionBoxes,
    createHostedRegionSessionContextBase,
    materializeHostedRegionsBounded,
    materializeHostedRegionsMoveWhole,
    readHostedRegionDebugTag,
    resolveHostedRegionVisibleHeight,
    type BoundedHostedRegionSessionResult,
    type HostedRegionSessionResult
} from './hosted-region-runtime';
import { runHostedRegionSession, runHostedRegionSessionBounded } from './hosted-region-settlement';
import {
    buildHostedRegionActorQueues,
    type HostedRegionActorEntry,
    type HostedRegionActorQueue,
    type HostedRegionDescriptor
} from './region-actor-queues';

type HostedRegionHostLayout = Pick<
    NormalizedIndependentZoneStrip,
    'sourceKind' | 'frameOverflow' | 'worldBehavior' | 'marginTop' | 'marginBottom'
>;

function annotateHostedActorBoxes(actor: PackagerUnit, boxes: Box[]): Box[] {
    return boxes.map((box) => ({
        ...box,
        meta: box.meta
            ? { ...box.meta, actorId: actor.actorId, sourceId: box.meta.sourceId ?? actor.sourceId }
            : { actorId: actor.actorId, sourceId: actor.sourceId }
    }));
}


class FrozenHostedRegionPackager implements PackagerUnit {
    private readonly frozenBoxes: Box[];
    private readonly frozenHeight: number;
    private readonly marginTopVal: number;
    private readonly marginBottomVal: number;
    private readonly sourceKind: NormalizedIndependentZoneStrip['sourceKind'];
    private readonly frameOverflowMode: 'move-whole' | 'continue';
    private readonly worldBehaviorMode: ZoneWorldBehavior;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        boxes: Box[],
        height: number,
        marginTop: number,
        marginBottom: number,
        sourceKind: NormalizedIndependentZoneStrip['sourceKind'],
        frameOverflowMode: 'move-whole' | 'continue',
        worldBehaviorMode: ZoneWorldBehavior,
        identity: PackagerIdentity
    ) {
        this.frozenBoxes = cloneHostedRegionBoxes(boxes);
        this.frozenHeight = height;
        this.marginTopVal = marginTop;
        this.marginBottomVal = marginBottom;
        this.sourceKind = sourceKind;
        this.frameOverflowMode = frameOverflowMode;
        this.worldBehaviorMode = worldBehaviorMode;
        this.actorId = identity.actorId;
        this.sourceId = identity.sourceId;
        this.actorKind = identity.actorKind;
        this.fragmentIndex = identity.fragmentIndex;
        this.continuationOf = identity.continuationOf;
    }

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {}

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference {
        return { minimumWidth: fullAvailableWidth, acceptsFrame: true };
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                { kind: 'split', preservesIdentity: true, producesContinuation: true }
            ]
        };
    }

    emitBoxes(_availableWidth: number, _availableHeight: number, context: PackagerContext): Box[] {
        const leftMargin = context.margins.left;
        const mt = this.marginTopVal;
        return this.frozenBoxes.map((box) => {
            const tag = readHostedRegionDebugTag(box);
            return {
                ...box,
                x: (box.x || 0) + leftMargin,
                y: (box.y || 0) + mt,
                properties: tag
                    ? {
                        ...(box.properties || {}),
                        __vmprintRegionDebugPage: {
                            fieldActorId: this.actorId,
                            fieldSourceId: this.sourceId,
                            sourceKind: this.sourceKind,
                            regionId: tag.zoneId,
                            regionIndex: tag.zoneIndex,
                            zoneId: tag.zoneId,
                            zoneIndex: tag.zoneIndex,
                            x: leftMargin + tag.rect.x,
                            y: mt + tag.rect.y,
                            w: tag.rect.width,
                            explicitHeight: tag.rect.height,
                            frameOverflowMode: this.frameOverflowMode,
                            worldBehaviorMode: this.worldBehaviorMode
                        }
                    }
                    : { ...(box.properties || {}) },
                meta: box.meta ? { ...box.meta } : box.meta
            };
        });
    }

    split(_availableHeight: number, _context: PackagerContext): PackagerSplitResult {
        return { currentFragment: null, continuationFragment: this };
    }

    getRequiredHeight(): number { return this.frozenHeight; }
    isUnbreakable(_availableHeight: number): boolean { return true; }
    getMarginTop(): number { return this.marginTopVal; }
    getMarginBottom(): number { return this.marginBottomVal; }
}

export class HostedRegionPackager implements PackagerUnit {
    private readonly normalizeStrip: (availableWidth: number) => NormalizedIndependentZoneStrip;
    private readonly resolveHostLayout: (availableWidth: number) => HostedRegionHostLayout;
    private readonly buildInitialQueues?: (availableWidth: number) => HostedRegionActorQueue[];
    private readonly describeRegions: (availableWidth: number) => readonly HostedRegionDescriptor[];
    private readonly sourceKind: NormalizedIndependentZoneStrip['sourceKind'];
    readonly frameOverflowMode: 'move-whole' | 'continue';
    readonly worldBehaviorMode: ZoneWorldBehavior;
    private regionQueues: HostedRegionActorQueue[] | null;
    private readonly fragmentMarginTop: number;
    private readonly fragmentMarginBottom: number;
    private hostedRuntimeActorIds = new Set<string>();
    private lastAvailableWidth: number = -1;
    private lastAvailableHeight: number = -1;
    private materializedBoxes: Box[] | null = null;
    private marginTopVal: number = 0;
    private marginBottomVal: number = 0;
    private totalRegionHeight: number = 0;
    private boundedBoxes: Box[] | null = null;
    private boundedHeight: number = 0;
    private boundedOverflow: boolean = false;
    private boundedContinuationQueues: HostedRegionActorQueue[] | null = null;
    private lastEmittedLeftMargin: number = 0;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly element: Element,
        private readonly processor: LayoutProcessor,
        identity?: PackagerIdentity,
        regionQueues?: HostedRegionActorQueue[] | null,
        fragmentMarginTop?: number,
        fragmentMarginBottom?: number,
        normalizeStrip?: (availableWidth: number) => NormalizedIndependentZoneStrip,
        resolveHostLayout?: (availableWidth: number) => HostedRegionHostLayout,
        buildInitialQueues?: (availableWidth: number) => HostedRegionActorQueue[],
        describeRegions?: (availableWidth: number) => readonly HostedRegionDescriptor[]
    ) {
        this.normalizeStrip = normalizeStrip ?? ((availableWidth) => {
            throw new Error(`HostedRegionPackager requires normalizeStrip for ${this.element.type} at width ${availableWidth}`);
        });
        this.resolveHostLayout = resolveHostLayout ?? ((availableWidth) => {
            const normalized = this.normalizeStrip(availableWidth);
            return {
                sourceKind: normalized.sourceKind,
                frameOverflow: normalized.frameOverflow,
                worldBehavior: normalized.worldBehavior,
                marginTop: normalized.marginTop,
                marginBottom: normalized.marginBottom
            };
        });
        this.buildInitialQueues = buildInitialQueues;
        this.describeRegions = describeRegions ?? ((availableWidth) => this.normalizeStrip(availableWidth).zones);
        const resolved = identity ?? createElementPackagerIdentity(element, [0]);
        this.regionQueues = regionQueues ?? null;
        const hostLayout = this.resolveHostLayout(0);
        this.sourceKind = hostLayout.sourceKind;
        this.frameOverflowMode = hostLayout.frameOverflow;
        this.worldBehaviorMode = hostLayout.worldBehavior;
        this.fragmentMarginTop = fragmentMarginTop ?? (resolved.fragmentIndex > 0 ? 0 : hostLayout.marginTop);
        this.fragmentMarginBottom = fragmentMarginBottom ?? hostLayout.marginBottom;
        this.actorId = resolved.actorId;
        this.sourceId = resolved.sourceId;
        this.actorKind = resolved.actorKind;
        this.fragmentIndex = resolved.fragmentIndex;
        this.continuationOf = resolved.continuationOf;
        if (this.usesSpanningContinuation()) {
            this.marginTopVal = this.fragmentMarginTop;
            this.marginBottomVal = this.fragmentMarginBottom;
        }
    }

    private usesSpanningContinuation(): boolean {
        if (this.frameOverflowMode !== 'continue') return false;
        if (this.worldBehaviorMode === 'expandable') return true;
        return this.worldBehaviorMode === 'spanning';
    }

    get pageBreakBefore(): boolean | undefined {
        if (this.fragmentIndex > 0) return undefined;
        return (this.element.properties?.style as ElementStyle | undefined)?.pageBreakBefore ?? undefined;
    }

    get keepWithNext(): boolean | undefined {
        if (this.fragmentIndex > 0) return undefined;
        return (this.element.properties?.style as ElementStyle | undefined)?.keepWithNext ?? undefined;
    }

    getHostedRuntimeActors(): readonly PackagerUnit[] {
        if (!this.regionQueues) return [];
        return this.regionQueues.flatMap((zone) => zone.actors.map((entry) => entry.actor));
    }

    private ensureRegionQueues(availableWidth: number): HostedRegionActorQueue[] {
        if (this.regionQueues) return this.regionQueues;
        if (this.buildInitialQueues) {
            this.regionQueues = this.buildInitialQueues(availableWidth);
            return this.regionQueues;
        }
        const normalizedStrip = this.normalizeStrip(availableWidth);
        this.regionQueues = buildHostedRegionActorQueues(normalizedStrip, this.processor);
        return this.regionQueues;
    }

    private syncHostedActors(actorIndex?: number): void {
        const session = this.processor.getCurrentLayoutSession();
        if (!session) return;
        const actors = this.getHostedRuntimeActors();
        const activeIds = new Set(actors.map((actor) => actor.actorId));
        for (const actor of actors) {
            if (!this.hostedRuntimeActorIds.has(actor.actorId)) {
                session.notifyActorSpawn(actor);
                this.hostedRuntimeActorIds.add(actor.actorId);
            }
            if (actorIndex !== undefined) {
                session.noteActorRuntimeIndex(actor, actorIndex);
            }
        }
        for (const actorId of [...this.hostedRuntimeActorIds]) {
            if (activeIds.has(actorId)) continue;
            const staleActor = session.getRegisteredActors().find((entry) => entry.actorId === actorId);
            if (staleActor) {
                session.notifyActorDespawn(staleActor as PackagerUnit);
            }
            this.hostedRuntimeActorIds.delete(actorId);
        }
    }

    annotateHostedActorBoxes(actor: PackagerUnit, boxes: Box[]): Box[] {
        return annotateHostedActorBoxes(actor, boxes);
    }

    private collectHostedActorIds(actor: PackagerUnit): string[] {
        const ids = [actor.actorId];
        const maybeHosted = actor as PackagerUnit & { getHostedRuntimeActors?(): readonly PackagerUnit[] };
        for (const hosted of maybeHosted.getHostedRuntimeActors?.() ?? []) {
            ids.push(...this.collectHostedActorIds(hosted));
        }
        return ids;
    }

    private trackHostedActorsAsActive(actors: readonly PackagerUnit[]): void {
        for (const actor of actors) {
            for (const actorId of this.collectHostedActorIds(actor)) {
                this.hostedRuntimeActorIds.add(actorId);
            }
        }
    }

    private trackHostedActorsAsRemoved(actors: readonly PackagerUnit[]): void {
        for (const actor of actors) {
            for (const actorId of this.collectHostedActorIds(actor)) {
                this.hostedRuntimeActorIds.delete(actorId);
            }
        }
    }

    private invalidateMaterialization(): void {
        this.materializedBoxes = null;
        this.boundedBoxes = null;
        this.boundedContinuationQueues = null;
        this.boundedHeight = 0;
        this.boundedOverflow = false;
        this.totalRegionHeight = 0;
        this.lastAvailableHeight = -1;
    }

    private createActorEntries(
        sourceElements: readonly Element[] | undefined,
        actors: readonly PackagerUnit[]
    ): HostedRegionActorEntry[] | null {
        if (!sourceElements || sourceElements.length !== actors.length) return null;
        return actors.map((actor, index) => ({ actor, element: sourceElements[index] as Element }));
    }

    private findHostedActorLocation(targetActor: PackagerUnit): { zone: HostedRegionActorQueue; actorIndex: number } | null {
        if (!this.regionQueues) return null;
        for (const zone of this.regionQueues) {
            const actorIndex = zone.actors.findIndex((entry) => entry.actor.actorId === targetActor.actorId);
            if (actorIndex >= 0) return { zone, actorIndex };
        }
        return null;
    }

    handlesHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        return this.findHostedActorLocation(targetActor) !== null;
    }

    insertHostedRuntimeActors(
        targetActor: PackagerUnit,
        insertions: readonly PackagerUnit[],
        position: 'before' | 'after',
        sourceElements?: readonly Element[]
    ): boolean {
        const location = this.findHostedActorLocation(targetActor);
        const entries = this.createActorEntries(sourceElements, insertions);
        if (!location || !entries) return false;
        const insertionIndex = position === 'before' ? location.actorIndex : location.actorIndex + 1;
        location.zone.actors.splice(insertionIndex, 0, ...entries);
        this.trackHostedActorsAsActive(insertions);
        this.invalidateMaterialization();
        return true;
    }

    deleteHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        const location = this.findHostedActorLocation(targetActor);
        if (!location) return false;
        const [removed] = location.zone.actors.splice(location.actorIndex, 1);
        if (!removed) return false;
        this.trackHostedActorsAsRemoved([removed.actor]);
        this.invalidateMaterialization();
        return true;
    }

    replaceHostedRuntimeActor(
        targetActor: PackagerUnit,
        replacements: readonly PackagerUnit[],
        sourceElements?: readonly Element[]
    ): boolean {
        const location = this.findHostedActorLocation(targetActor);
        const entries = this.createActorEntries(sourceElements, replacements);
        if (!location || !entries) return false;
        const [removed] = location.zone.actors.splice(location.actorIndex, 1, ...entries);
        if (!removed) return false;
        this.trackHostedActorsAsRemoved([removed.actor]);
        this.trackHostedActorsAsActive(replacements);
        this.invalidateMaterialization();
        return true;
    }

    refreshHostedRuntimeActor(targetActor: PackagerUnit): boolean {
        if (!this.handlesHostedRuntimeActor(targetActor)) return false;
        this.invalidateMaterialization();
        return true;
    }

    private materializeMoveWhole(availableWidth: number): void {
        if (this.materializedBoxes !== null && this.lastAvailableWidth === availableWidth) return;
        const contextBase = createHostedRegionSessionContextBase(availableWidth, this.processor);
        const queues = this.ensureRegionQueues(availableWidth);
        const { boxes, totalHeight } = materializeHostedRegionsMoveWhole(
            queues,
            this.sourceKind,
            '',
            '',
            runHostedRegionSession,
            contextBase
        );
        this.materializedBoxes = boxes.map((box) => {
            const tag = readHostedRegionDebugTag(box);
            return tag
                ? attachHostedRegionDebugTag(box, { ...tag, fieldActorId: this.actorId, fieldSourceId: this.sourceId })
                : box;
        });
        this.marginTopVal = this.fragmentMarginTop;
        this.marginBottomVal = this.fragmentMarginBottom;
        this.totalRegionHeight = totalHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = Infinity;
    }

    private materializeBounded(availableWidth: number, availableHeight: number): void {
        if (this.boundedBoxes !== null && this.lastAvailableWidth === availableWidth && this.lastAvailableHeight === availableHeight) {
            return;
        }
        if (!Number.isFinite(availableHeight)) {
            this.materializeMoveWhole(availableWidth);
            this.boundedBoxes = this.materializedBoxes ? cloneHostedRegionBoxes(this.materializedBoxes) : [];
            this.boundedHeight = this.totalRegionHeight;
            this.boundedOverflow = false;
            this.boundedContinuationQueues = null;
            return;
        }
        const queues = this.ensureRegionQueues(availableWidth);
        const contextBase = createHostedRegionSessionContextBase(availableWidth, this.processor);
        const { boxes, occupiedHeight, hasOverflow, continuationQueues, totalHeight } =
            materializeHostedRegionsBounded(
                queues,
                this.sourceKind,
                this.actorId,
                this.sourceId,
                availableHeight,
                runHostedRegionSessionBounded,
                contextBase
            );
        this.marginTopVal = this.fragmentMarginTop;
        this.marginBottomVal = hasOverflow ? 0 : this.fragmentMarginBottom;
        this.boundedBoxes = boxes;
        this.boundedHeight = occupiedHeight;
        this.boundedOverflow = hasOverflow;
        this.boundedContinuationQueues = hasOverflow ? continuationQueues : null;
        if (hasOverflow) {
            this.regionQueues = continuationQueues;
        }
        this.totalRegionHeight = totalHeight;
        this.lastAvailableWidth = availableWidth;
        this.lastAvailableHeight = availableHeight;
    }

    private materialize(availableWidth: number, availableHeight: number): void {
        if (this.usesSpanningContinuation()) {
            this.materializeBounded(availableWidth, availableHeight);
            return;
        }
        this.materializeMoveWhole(availableWidth);
    }

    private createFrozenCurrentFragment(): FrozenHostedRegionPackager {
        return new FrozenHostedRegionPackager(
            this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []),
            this.marginTopVal + (this.usesSpanningContinuation() ? this.boundedHeight : this.totalRegionHeight) + this.marginBottomVal,
            this.marginTopVal,
            this.marginBottomVal,
            this.sourceKind,
            this.frameOverflowMode,
            this.worldBehaviorMode,
            {
                actorId: this.actorId,
                sourceId: this.sourceId,
                actorKind: this.actorKind,
                fragmentIndex: this.fragmentIndex,
                continuationOf: this.continuationOf
            }
        );
    }

    private createContinuationPackager(): HostedRegionPackager | null {
        if (!this.boundedContinuationQueues || this.boundedContinuationQueues.every((zone) => zone.actors.length === 0)) {
            return null;
        }
        return new HostedRegionPackager(
            this.element,
            this.processor,
            createContinuationIdentity(this),
            this.boundedContinuationQueues,
            0,
            this.fragmentMarginBottom,
            this.normalizeStrip,
            this.resolveHostLayout,
            this.buildInitialQueues,
            this.describeRegions
        );
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.ensureRegionQueues(availableWidth);
        this.syncHostedActors(context.actorIndex);
        this.materialize(availableWidth, availableHeight);
    }

    getPlacementPreference(fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference {
        return { minimumWidth: fullAvailableWidth, acceptsFrame: true };
    }

    getTransformProfile(): PackagerTransformProfile {
        return { capabilities: [{ kind: 'morph', preservesIdentity: true, reflowsContent: true }] };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] {
        this.materialize(availableWidth, availableHeight);
        const mt = this.marginTopVal;
        const leftMargin = context.margins.left;
        this.lastEmittedLeftMargin = leftMargin;
        const boxes = this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []);
        return boxes.map((b) => {
            const tag = readHostedRegionDebugTag(b);
            return {
                ...b,
                x: (b.x || 0) + leftMargin,
                y: (b.y || 0) + mt,
                properties: tag
                    ? {
                        ...(b.properties || {}),
                        __vmprintRegionDebugPage: {
                            fieldActorId: this.actorId,
                            fieldSourceId: this.sourceId,
                            sourceKind: tag.sourceKind,
                            regionId: tag.zoneId,
                            regionIndex: tag.zoneIndex,
                            zoneId: tag.zoneId,
                            zoneIndex: tag.zoneIndex,
                            x: leftMargin + tag.rect.x,
                            y: mt + tag.rect.y,
                            w: tag.rect.width,
                            explicitHeight: tag.rect.height,
                            frameOverflowMode: this.frameOverflowMode,
                            worldBehaviorMode: this.worldBehaviorMode
                        }
                    }
                    : b.properties
            };
        });
    }

    getDebugRegions(): DebugRegion[] {
        const availableWidth = this.lastAvailableWidth > 0 ? this.lastAvailableWidth : 0;
        const regions = this.describeRegions(availableWidth);
        const boxes = this.usesSpanningContinuation() ? (this.boundedBoxes || []) : (this.materializedBoxes || []);
        const bottomsByZone = new Map<number, number>();
        for (const box of boxes) {
            const tag = readHostedRegionDebugTag(box);
            if (!tag) continue;
            const localBottom = (box.y || 0) + (box.h || 0);
            const currentBottom = bottomsByZone.get(tag.zoneIndex) ?? tag.rect.y;
            if (localBottom > currentBottom) {
                bottomsByZone.set(tag.zoneIndex, localBottom);
            }
        }
        return regions.map((zone, zoneIndex) => {
            const explicitHeight = zone.rect.height !== undefined ? Math.max(0, Number(zone.rect.height)) : 0;
            const contentHeight = Math.max(0, (bottomsByZone.get(zoneIndex) ?? zone.rect.y) - zone.rect.y);
            const visibleHeight = this.usesSpanningContinuation()
                ? resolveHostedRegionVisibleHeight({ id: zone.id, rect: { ...zone.rect }, style: zone.style, actors: [] }, Math.max(0, this.lastAvailableHeight))
                : contentHeight;
            const height = Math.max(explicitHeight, contentHeight, visibleHeight);
            return {
                fieldActorId: this.actorId,
                fieldSourceId: this.sourceId,
                sourceKind: this.sourceKind,
                regionId: zone.id,
                regionIndex: zoneIndex,
                zoneId: zone.id,
                zoneIndex,
                x: this.lastEmittedLeftMargin + zone.rect.x,
                y: this.marginTopVal + zone.rect.y,
                w: zone.rect.width,
                h: height,
                frameOverflowMode: this.frameOverflowMode,
                worldBehaviorMode: this.worldBehaviorMode
            };
        }).filter((zone) => zone.w > 0 && zone.h > 0);
    }

    getRequiredHeight(): number {
        const regionHeight = this.usesSpanningContinuation() ? this.boundedHeight : this.totalRegionHeight;
        const reportedHeight = this.usesSpanningContinuation() && this.boundedOverflow
            ? Math.max(regionHeight, this.lastAvailableHeight + 1)
            : regionHeight;
        return this.marginTopVal + reportedHeight + this.marginBottomVal;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return !this.usesSpanningContinuation();
    }

    getMarginTop(): number { return this.marginTopVal; }
    getMarginBottom(): number { return this.marginBottomVal; }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        if (!this.usesSpanningContinuation()) {
            return { currentFragment: null, continuationFragment: this };
        }
        const availableWidth = this.lastAvailableWidth > 0
            ? this.lastAvailableWidth
            : (context.pageWidth - context.margins.left - context.margins.right);
        this.materializeBounded(availableWidth, availableHeight);
        if ((this.boundedBoxes || []).length === 0) {
            return { currentFragment: null, continuationFragment: this };
        }
        const currentFragment = this.createFrozenCurrentFragment();
        if (!this.boundedOverflow) {
            return { currentFragment, continuationFragment: null };
        }
        return {
            currentFragment,
            continuationFragment: this.createContinuationPackager()
        };
    }
}
