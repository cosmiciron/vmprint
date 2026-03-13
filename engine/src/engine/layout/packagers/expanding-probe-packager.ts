import type { Box } from '../../types';
import type { FlowBox } from '../layout-core-types';
import type { LayoutProcessor } from '../layout-core';
import { createContinuationIdentity, type PackagerIdentity } from './packager-identity';
import { FlowBoxPackager } from './flow-box-packager';
import type {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerSplitResult,
    PackagerTransformProfile,
    PackagerUnit
} from './packager-types';

export class ExpandingProbePackager implements PackagerUnit {
    private readonly base: FlowBoxPackager;
    private readonly identity: PackagerIdentity;
    private readonly fragmentHeightOverride?: number;
    private readonly totalContentHeight: number;
    private readonly fragmentMarginBottom: number;
    private readonly fragmentOffsetY: number;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    get pageBreakBefore(): boolean | undefined {
        return this.fragmentIndex === 0 ? this.base.pageBreakBefore : undefined;
    }
    get keepWithNext(): boolean | undefined { return this.base.keepWithNext; }

    constructor(
        processor: LayoutProcessor,
        flowBox: FlowBox,
        identity: PackagerIdentity,
        fragmentHeightOverride?: number,
        fragmentMarginBottom?: number,
        fragmentOffsetY: number = 0
    ) {
        this.base = new FlowBoxPackager(processor, flowBox, identity);
        this.identity = identity;
        this.fragmentHeightOverride = fragmentHeightOverride;
        const configuredHeight = Number(flowBox.properties?.style?.height);
        this.totalContentHeight = Number.isFinite(configuredHeight) && configuredHeight > 0
            ? configuredHeight
            : 0;
        this.fragmentMarginBottom = fragmentMarginBottom ?? flowBox.marginBottom;
        this.fragmentOffsetY = fragmentOffsetY;
        this.actorId = this.base.actorId;
        this.sourceId = this.base.sourceId;
        this.actorKind = this.base.actorKind;
        this.fragmentIndex = this.base.fragmentIndex;
        this.continuationOf = this.base.continuationOf;
    }

    prepare(availableWidth: number, availableHeight: number, context: PackagerContext): void {
        this.base.prepare(availableWidth, availableHeight, context);
    }

    getPlacementPreference(fullAvailableWidth: number, context: PackagerContext): PackagerPlacementPreference | null {
        return this.base.getPlacementPreference?.(fullAvailableWidth, context) ?? null;
    }

    getTransformProfile(): PackagerTransformProfile {
        return {
            capabilities: [
                {
                    kind: 'split',
                    preservesIdentity: true,
                    producesContinuation: true
                }
            ]
        };
    }

    emitBoxes(availableWidth: number, availableHeight: number, context: PackagerContext): Box[] | null {
        const boxes = this.base.emitBoxes(availableWidth, availableHeight, context);
        if (!boxes || boxes.length === 0) return boxes;

        const fragmentHeight = this.getRenderedFragmentHeight(availableHeight);
        const regionBoxes = boxes.map((box) => {
            const cloned: Box = {
                ...box,
                h: fragmentHeight,
                style: {
                    ...box.style,
                    height: fragmentHeight
                },
                properties: {
                    ...(box.properties || {}),
                    style: {
                        ...((box.properties?.style as Record<string, unknown>) || {}),
                        height: fragmentHeight,
                        pageBreakBefore: this.pageBreakBefore
                    }
                },
                meta: {
                    ...(box.meta || {}),
                    fragmentIndex: this.fragmentIndex,
                    isContinuation: !!this.continuationOf
                }
            };
            return cloned;
        });

        const primary = regionBoxes[0];
        const markerBoxes = primary ? this.buildGrowthMarkers(primary) : [];
        return [...regionBoxes, ...markerBoxes];
    }

    split(availableHeight: number, context: PackagerContext): PackagerSplitResult {
        const contentHeight = this.getFragmentContentHeight();
        if (contentHeight <= availableHeight) {
            return { currentFragment: this, continuationFragment: null };
        }

        const currentHeight = Math.max(0, availableHeight);
        const remainingHeight = Math.max(0, contentHeight - currentHeight);
        if (currentHeight <= 0 || remainingHeight <= 0) {
            return { currentFragment: null, continuationFragment: this };
        }

        return {
            currentFragment: this.wrap(currentHeight, this.fragmentIndex, this.continuationOf, 0, this.fragmentOffsetY),
            continuationFragment: this.wrap(
                remainingHeight,
                this.fragmentIndex + 1,
                this.actorId,
                this.fragmentMarginBottom,
                this.fragmentOffsetY + currentHeight
            )
        };
    }

    getRequiredHeight(): number {
        return this.getFragmentContentHeight() + this.getMarginTop() + this.getMarginBottom();
    }

    isUnbreakable(availableHeight: number): boolean {
        if (this.getFragmentContentHeight() > availableHeight) {
            return false;
        }
        return this.base.isUnbreakable(availableHeight);
    }

    getMarginTop(): number {
        return this.base.getMarginTop();
    }

    getMarginBottom(): number {
        return this.fragmentMarginBottom;
    }

    private getFragmentContentHeight(availableHeight?: number): number {
        const rawHeight = this.fragmentHeightOverride ?? this.totalContentHeight;
        if (!Number.isFinite(rawHeight) || rawHeight <= 0) {
            return this.base.getRequiredHeight() - this.base.getMarginTop() - this.base.getMarginBottom();
        }
        return rawHeight;
    }

    private getRenderedFragmentHeight(availableHeight?: number): number {
        const contentHeight = this.getFragmentContentHeight();
        if (availableHeight === undefined) {
            return contentHeight;
        }
        return Math.min(contentHeight, Math.max(0, availableHeight));
    }

    private wrap(
        fragmentHeight: number,
        fragmentIndex: number,
        continuationOf: string | undefined,
        fragmentMarginBottom: number,
        fragmentOffsetY: number
    ): PackagerUnit | null {
        const flowBox = (this.base as any).flowBox as FlowBox | undefined;
        if (!flowBox) return null;
        return new ExpandingProbePackager(
            (this.base as any).processor,
            flowBox,
            continuationOf
                ? createContinuationIdentity(this.identity, fragmentIndex)
                : {
                    actorId: this.actorId,
                    sourceId: this.sourceId,
                    actorKind: this.actorKind,
                    fragmentIndex,
                    continuationOf
                },
            fragmentHeight,
            fragmentMarginBottom,
            fragmentOffsetY
        );
    }

    private buildGrowthMarkers(baseBox: Box): Box[] {
        const probe = baseBox.properties?._expandingProbe as {
            initialHeight?: number;
            currentHeight?: number;
            growthEventCount?: number;
            chaptersObserved?: number;
            heightSnapshots?: number[];
        } | undefined;
        if (!probe) return [];

        const initialHeight = Number(probe.initialHeight || 0);
        const currentHeight = Number(probe.currentHeight || baseBox.h || 0);
        const snapshots = Array.isArray(probe.heightSnapshots)
            ? probe.heightSnapshots.filter((value) => Number.isFinite(value))
            : [];
        if (currentHeight <= 0) return [];

        const fragmentStart = this.fragmentOffsetY;
        const fragmentEnd = fragmentStart + baseBox.h;
        const insetLeft = 16;
        const insetRight = 16;
        const lineX = baseBox.x + insetLeft;
        const lineW = Math.max(0, baseBox.w - insetLeft - insetRight);
        const chapterCount = Math.max(0, Number(probe.chaptersObserved || probe.growthEventCount || snapshots.length || 0));

        const decorations: Box[] = [];

        const spineWidth = 6;
        decorations.push({
            type: 'expanding-probe-decoration',
            x: baseBox.x + 10,
            y: baseBox.y + 10,
            w: spineWidth,
            h: Math.max(0, baseBox.h - 20),
            style: {
                backgroundColor: '#7c2d12',
                zIndex: 1
            },
            properties: {
                sourceId: `${baseBox.properties?.sourceId || 'probe:expanding-box'}:spine`
            },
            meta: {
                ...(baseBox.meta || {}),
                generated: true
            }
        });

        if (initialHeight >= fragmentStart && initialHeight <= fragmentEnd) {
            const initialY = baseBox.y + Math.max(0, Math.min(baseBox.h - 2, initialHeight - fragmentStart - 2));
            decorations.push({
                type: 'expanding-probe-decoration',
                x: lineX,
                y: initialY,
                w: lineW,
                h: 2,
                style: {
                    backgroundColor: '#111827',
                    zIndex: 1
                },
                properties: {
                    sourceId: `${baseBox.properties?.sourceId || 'probe:expanding-box'}:initial-marker`
                },
                meta: {
                    ...(baseBox.meta || {}),
                    generated: true
                }
            });
        }

        snapshots.forEach((heightAfter, index) => {
            const globalHeight = Number(heightAfter);
            if (globalHeight < fragmentStart || globalHeight > fragmentEnd) {
                return;
            }
            const clampedY = baseBox.y + Math.max(0, Math.min(baseBox.h - 1, globalHeight - fragmentStart - 1));
            const isMajor = (index + 1) % 5 === 0 || index === snapshots.length - 1;
            decorations.push({
                type: 'expanding-probe-decoration',
                x: lineX,
                y: clampedY,
                w: lineW,
                h: isMajor ? 2 : 1,
                style: {
                    backgroundColor: isMajor ? '#9a3412' : '#b45309',
                    zIndex: 1
                },
                properties: {
                    sourceId: `${baseBox.properties?.sourceId || 'probe:expanding-box'}:growth:${index + 1}`
                },
                meta: {
                    ...(baseBox.meta || {}),
                    generated: true
                }
            });
        });

        if (chapterCount > 0 && this.fragmentOffsetY === 0) {
            const barHeight = 18;
            decorations.push({
                type: 'expanding-probe-decoration',
                x: baseBox.x + 12,
                y: baseBox.y + Math.max(0, baseBox.h - barHeight - 12),
                w: Math.max(0, Math.min(baseBox.w - 24, chapterCount * 4)),
                h: barHeight,
                style: {
                    backgroundColor: '#78350f',
                    zIndex: 1
                },
                properties: {
                    sourceId: `${baseBox.properties?.sourceId || 'probe:expanding-box'}:chapter-band`
                },
                meta: {
                    ...(baseBox.meta || {}),
                    generated: true
                }
            });
        }

        return decorations;
    }
}
