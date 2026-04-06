import type { Box, Page } from '../../types';
import type { PageSurface } from '../runtime/session/session-lifecycle-types';
import type { Collaborator, CollaboratorHost } from '../runtime/session/session-runtime-types';

import { simulationArtifactKeys } from '../simulation-report';

export type TemporalPresentationTextSegmentSnapshot = {
    text: string;
    width: number;
    ascent: number;
    descent: number;
    fontFamily: string;
};

export type TemporalPresentationBoxSnapshot = {
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    sourceId: string;
    engineKey: string;
    sourceType: string;
    fragmentIndex: number;
    isContinuation: boolean;
    lines: TemporalPresentationTextSegmentSnapshot[][];
};

export type TemporalPresentationPageSnapshot = {
    index: number;
    width: number;
    height: number;
    boxes: TemporalPresentationBoxSnapshot[];
};

export type TemporalPresentationFrame = {
    captureIndex: number;
    tick: number;
    pageCount: number;
    pages: TemporalPresentationPageSnapshot[];
};

export type TemporalPresentationTimeline = TemporalPresentationFrame[];

function snapshotBox(box: Box): TemporalPresentationBoxSnapshot {
    return {
        type: String(box.type || ''),
        x: Number((box.x || 0).toFixed(6)),
        y: Number((box.y || 0).toFixed(6)),
        w: Number((box.w || 0).toFixed(6)),
        h: Number((box.h || 0).toFixed(6)),
        sourceId: String(box.meta?.sourceId || ''),
        engineKey: String(box.meta?.engineKey || ''),
        sourceType: String(box.meta?.sourceType || ''),
        fragmentIndex: Number(box.meta?.fragmentIndex || 0),
        isContinuation: Boolean(box.meta?.isContinuation),
        lines: (box.lines || []).map((line) => line.map((segment) => ({
            text: String(segment.text || ''),
            width: Number((segment.width || 0).toFixed(6)),
            ascent: Number((segment.ascent || 0).toFixed(6)),
            descent: Number((segment.descent || 0).toFixed(6)),
            fontFamily: String(segment.fontFamily || '')
        })))
    };
}

function snapshotPage(page: Page): TemporalPresentationPageSnapshot {
    return {
        index: page.index,
        width: Number((page.width || 0).toFixed(6)),
        height: Number((page.height || 0).toFixed(6)),
        boxes: (page.boxes || []).map((box) => snapshotBox(box))
    };
}

function clonePageSnapshot(page: TemporalPresentationPageSnapshot): TemporalPresentationPageSnapshot {
    return {
        index: page.index,
        width: page.width,
        height: page.height,
        boxes: page.boxes.map((box) => ({
            ...box,
            lines: box.lines.map((line) => line.map((segment) => ({ ...segment })))
        }))
    };
}

function cloneTimeline(frames: TemporalPresentationTimeline): TemporalPresentationTimeline {
    return frames.map((frame, index) => ({
        captureIndex: index,
        tick: frame.tick,
        pageCount: frame.pageCount,
        pages: frame.pages.map((page) => clonePageSnapshot(page))
    }));
}

export class TemporalPresentationCollaborator implements Collaborator {
    readonly mutationMode = 'observer' as const;

    private readonly latestPages = new Map<number, TemporalPresentationPageSnapshot>();
    private frames: TemporalPresentationTimeline = [];

    onSimulationStart(): void {
        this.latestPages.clear();
        this.frames = [];
    }

    onPageFinalized(surface: PageSurface, host: CollaboratorHost): void {
        const page = surface.finalize();
        this.latestPages.set(page.index, snapshotPage(page));
        const pages = Array.from(this.latestPages.values())
            .sort((a, b) => a.index - b.index)
            .map((entry) => clonePageSnapshot(entry));

        this.frames.push({
            captureIndex: this.frames.length,
            tick: host.getSimulationTick(),
            pageCount: pages.length,
            pages
        });
    }

    onSimulationComplete(host: CollaboratorHost): void {
        host.publishArtifact(
            simulationArtifactKeys.temporalPresentationTimeline,
            cloneTimeline(this.frames)
        );
    }
}
