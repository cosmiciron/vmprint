import asyncThoughtPages from '@proof/async-thought-pages';
import asyncThoughtTimeline from '@proof/async-thought-timeline';
import streamingThoughtPages from '@proof/streaming-thought-pages';
import streamingThoughtTimeline from '@proof/streaming-thought-timeline';
import collectorPages from '@proof/reactive-collector-pages';
import collectorTimeline from '@proof/reactive-collector-timeline';
import geometryPages from '@proof/reactive-geometry-pages';
import geometryTimeline from '@proof/reactive-geometry-timeline';
import saucerPages from '@proof/saucer-pages';
import saucerTimeline from '@proof/saucer-timeline';
import type { PreviewProofArtifact, PreviewProofPage, PreviewTimelineFrame } from './playback-utils';

type ProofPageJson = PreviewProofPage[];
type ProofTimelineJson = PreviewTimelineFrame[];

const withArtifact = (
    id: string,
    title: string,
    description: string,
    pages: ProofPageJson,
    timeline?: ProofTimelineJson,
    preferredFrameDurationMs?: number
): PreviewProofArtifact => ({
    id,
    title,
    description,
    pages,
    ...(timeline ? { timeline } : {}),
    ...(typeof preferredFrameDurationMs === 'number' ? { preferredFrameDurationMs } : {})
});

export const PLAYBACK_PROOFS: PreviewProofArtifact[] = [
    withArtifact(
        'async-thought',
        'Async Thought Board',
        'A delayed external thought starts pending, resolves later, and returns on a later replay pass as committed content and geometry.',
        asyncThoughtPages as ProofPageJson,
        asyncThoughtTimeline as ProofTimelineJson,
        2000
    ),
    withArtifact(
        'streaming-thought',
        'Streaming Thought Board',
        'A staged thought arrives over several async replay passes so the page can preserve partial becoming, not just pending and done.',
        streamingThoughtPages as ProofPageJson,
        streamingThoughtTimeline as ProofTimelineJson,
        360
    ),
    withArtifact(
        'saucer',
        'Saucer Flipbook',
        'Fixed-tick cooking across a page sequence. This is the clearest recovered proof that VMPrint can march through simulation time and emit a frame-ready world slice.',
        saucerPages as ProofPageJson,
        saucerTimeline as ProofTimelineJson
    ),
    withArtifact(
        'geometry',
        'Reactive Geometry Board',
        'Pinned actor wakes, proposes geometry growth, and forces downstream replay while preserving the upstream marker.',
        geometryPages as ProofPageJson,
        geometryTimeline as ProofTimelineJson
    ),
    withArtifact(
        'collector',
        'Reactive Collector Board',
        'Collector-style observation with downstream spatial consequence, kept compact enough to stay useful in filing and review workflows.',
        collectorPages as ProofPageJson,
        collectorTimeline as ProofTimelineJson
    )
];
