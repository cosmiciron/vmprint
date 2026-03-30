import {
    interpolatePreviewProofPages,
    renderPreviewProofPageToCanvas,
    summarizePreviewTransition,
    type PreviewProofArtifact,
    type PreviewProofPage,
    type PreviewTransitionSummary
} from './playback-utils';
import { PLAYBACK_PROOFS } from './proof-library';

const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element: #${id}`);
    return element as T;
};

const proofSelect = byId<HTMLSelectElement>('proof-select');
const proofDescription = byId<HTMLElement>('proof-description');
const prevPageButton = byId<HTMLButtonElement>('prev-page-button');
const nextPageButton = byId<HTMLButtonElement>('next-page-button');
const playButton = byId<HTMLButtonElement>('play-button');
const pauseButton = byId<HTMLButtonElement>('pause-button');
const pageSlider = byId<HTMLInputElement>('page-slider');
const presentationMode = byId<HTMLSelectElement>('presentation-mode');
const speedSlider = byId<HTMLInputElement>('speed-slider');
const holdExactTicksInput = byId<HTMLInputElement>('hold-exact-ticks');
const debugTransitionsInput = byId<HTMLInputElement>('debug-transitions');
const pager = byId<HTMLElement>('pager');
const pageSize = byId<HTMLElement>('page-size');
const playbackStatus = byId<HTMLElement>('playback-status');
const modeReadout = byId<HTMLElement>('mode-readout');
const speedReadout = byId<HTMLElement>('speed-readout');
const fpsReadout = byId<HTMLElement>('fps-readout');
const holdReadout = byId<HTMLElement>('hold-readout');
const headroomReadout = byId<HTMLElement>('headroom-readout');
const status = byId<HTMLElement>('status');
const metaOutput = byId<HTMLElement>('meta-output');
const canvas = byId<HTMLCanvasElement>('proof-canvas');

PLAYBACK_PROOFS.forEach((proof) => {
    const option = document.createElement('option');
    option.value = proof.id;
    option.textContent = proof.title;
    proofSelect.append(option);
});

let currentProof: PreviewProofArtifact = PLAYBACK_PROOFS[0];
let currentPageIndex = 0;
let playbackTimer: number | null = null;
let playbackStartedAt = 0;
let playbackPosition = 0;
let playbackSpeed = 1;
let frameDurationMs = 110;
let playbackMode: 'interpolated' | 'discrete' = 'interpolated';
let holdExactTicks = false;
let debugTransitions = false;
let lastRenderTimestamp = 0;
let smoothedFps = 0;
let smoothedWorkMs = 0;

const resolveNominalFrameDurationMs = (proof: PreviewProofArtifact): number =>
    Math.max(40, proof.preferredFrameDurationMs || 110);

const updateHud = (): void => {
    modeReadout.textContent = playbackMode === 'interpolated' ? 'Interpolated' : 'Discrete';
    speedReadout.textContent = `${playbackSpeed.toFixed(2)}x`;
    fpsReadout.textContent = `${smoothedFps.toFixed(1)} fps`;
    holdReadout.textContent = holdExactTicks ? 'On' : 'Off';
    const estimatedUncappedFps = smoothedWorkMs > 0 ? (1000 / smoothedWorkMs) : 0;
    headroomReadout.textContent = smoothedWorkMs > 0
        ? `${smoothedWorkMs.toFixed(2)} ms • ~${estimatedUncappedFps.toFixed(0)} fps`
        : '0.00 ms • n/a';
};

const stopPlayback = (): void => {
    if (playbackTimer !== null) {
        window.cancelAnimationFrame(playbackTimer);
        playbackTimer = null;
    }
    playbackStatus.textContent = 'Paused';
};

const resolveDisplayedPage = (): PreviewProofPage => {
    const timeline = currentProof.timeline;
    if (!timeline || timeline.length === 0) {
        return currentProof.pages[currentPageIndex] || currentProof.pages[0];
    }
    const maxPosition = Math.max(0, timeline.length - 1);
    const normalizedPosition = Math.max(0, Math.min(maxPosition, playbackPosition));
    const baseIndex = Math.floor(normalizedPosition);
    const alpha = playbackMode === 'interpolated' && !holdExactTicks ? (normalizedPosition - baseIndex) : 0;
    const currentFrame = timeline[baseIndex];
    const nextFrame = timeline[Math.min(timeline.length - 1, baseIndex + 1)];
    const currentPage = currentFrame.pages[0] || currentProof.pages[Math.min(currentProof.pages.length - 1, baseIndex)] || currentProof.pages[0];
    const nextPage = nextFrame.pages[0] || currentPage;
    return alpha > 0 ? interpolatePreviewProofPages(currentPage, nextPage, alpha) : currentPage;
};

const resolveTransitionSummary = (): PreviewTransitionSummary | null => {
    const timeline = currentProof.timeline;
    if (!timeline || timeline.length < 2) return null;
    const maxPosition = Math.max(0, timeline.length - 1);
    const normalizedPosition = Math.max(0, Math.min(maxPosition, playbackPosition));
    const baseIndex = Math.floor(normalizedPosition);
    const currentFrame = timeline[baseIndex];
    const nextFrame = timeline[Math.min(timeline.length - 1, baseIndex + 1)];
    const currentPage = currentFrame.pages[0];
    const nextPage = nextFrame.pages[0];
    if (!currentPage || !nextPage) return null;
    return summarizePreviewTransition(currentPage, nextPage);
};

const render = (timestamp?: number): void => {
    const workStart = performance.now();
    if (typeof timestamp === 'number') {
        if (lastRenderTimestamp > 0) {
            const delta = Math.max(1, timestamp - lastRenderTimestamp);
            const instantFps = 1000 / delta;
            smoothedFps = smoothedFps > 0 ? (smoothedFps * 0.82) + (instantFps * 0.18) : instantFps;
        }
        lastRenderTimestamp = timestamp;
    }

    const page = resolveDisplayedPage();
    const frameCount = currentProof.timeline?.length || currentProof.pages.length;
    const frameIndex = currentProof.timeline ? Math.floor(playbackPosition) : currentPageIndex;
    const transitionSummary = resolveTransitionSummary();

    renderPreviewProofPageToCanvas(page, canvas, { scale: 1.6, debugTransitions });
    proofDescription.textContent = currentProof.description || '';
    pageSlider.min = '1';
    pageSlider.max = String(frameCount);
    pageSlider.value = String(frameIndex + 1);
    pager.textContent = `${frameIndex + 1} / ${frameCount}`;
    pageSize.textContent = `${page.width} x ${page.height}`;
    prevPageButton.disabled = frameIndex <= 0;
    nextPageButton.disabled = frameIndex >= frameCount - 1;
    metaOutput.textContent = JSON.stringify({
        proof: currentProof.id,
        title: currentProof.title,
        pageIndex: frameIndex,
        pageCount: frameCount,
        pageWidth: page.width,
        pageHeight: page.height,
        boxCount: page.boxes.length,
        timeline: Boolean(currentProof.timeline),
        tick: currentProof.timeline?.[Math.floor(Math.max(0, Math.min(frameCount - 1, playbackPosition)))]?.tick ?? null,
        interpolationAlpha: currentProof.timeline && playbackMode === 'interpolated'
            ? Number((playbackPosition - Math.floor(playbackPosition)).toFixed(3))
            : 0,
        playbackMode,
        playbackSpeed: Number(playbackSpeed.toFixed(2)),
        debugTransitions,
        nominalFrameDurationMs: frameDurationMs,
        renderWorkMs: Number(smoothedWorkMs.toFixed(3)),
        estimatedUncappedFps: smoothedWorkMs > 0 ? Number((1000 / smoothedWorkMs).toFixed(1)) : null,
        transitionSummary
    }, null, 2);

    const instantWorkMs = Math.max(0, performance.now() - workStart);
    smoothedWorkMs = smoothedWorkMs > 0 ? (smoothedWorkMs * 0.82) + (instantWorkMs * 0.18) : instantWorkMs;
    updateHud();
    status.textContent = `Showing ${currentProof.title}, frame ${frameIndex + 1} of ${frameCount}.`;
};

const selectProof = (proofId: string): void => {
    currentProof = PLAYBACK_PROOFS.find((proof) => proof.id === proofId) || PLAYBACK_PROOFS[0];
    currentPageIndex = 0;
    playbackPosition = 0;
    frameDurationMs = resolveNominalFrameDurationMs(currentProof) / playbackSpeed;
    smoothedFps = 0;
    smoothedWorkMs = 0;
    lastRenderTimestamp = 0;
    stopPlayback();
    playbackStatus.textContent = currentProof.timeline ? 'Interpolated timeline' : 'Static board';
    render();
};

const advancePage = (direction: number): void => {
    stopPlayback();
    const frameCount = currentProof.timeline?.length || currentProof.pages.length;
    const currentIndex = currentProof.timeline ? Math.floor(playbackPosition) : currentPageIndex;
    const nextIndex = Math.max(0, Math.min(frameCount - 1, currentIndex + direction));
    currentPageIndex = nextIndex;
    playbackPosition = nextIndex;
    render();
};

proofSelect.addEventListener('change', () => selectProof(proofSelect.value));
prevPageButton.addEventListener('click', () => advancePage(-1));
nextPageButton.addEventListener('click', () => advancePage(1));
pageSlider.addEventListener('input', () => {
    currentPageIndex = Number(pageSlider.value) - 1;
    playbackPosition = currentPageIndex;
    render();
});
presentationMode.addEventListener('change', () => {
    playbackMode = presentationMode.value === 'discrete' ? 'discrete' : 'interpolated';
    playbackStatus.textContent = playbackMode === 'interpolated' ? 'Interpolated timeline' : 'Discrete ticks';
    render();
});
speedSlider.addEventListener('input', () => {
    playbackSpeed = Math.max(0.25, Number(speedSlider.value) || 1);
    frameDurationMs = resolveNominalFrameDurationMs(currentProof) / playbackSpeed;
    render();
});
holdExactTicksInput.addEventListener('change', () => {
    holdExactTicks = holdExactTicksInput.checked;
    if (holdExactTicks) playbackPosition = Math.floor(playbackPosition);
    render();
});
debugTransitionsInput.addEventListener('change', () => {
    debugTransitions = debugTransitionsInput.checked;
    render();
});
playButton.addEventListener('click', () => {
    const frameCount = currentProof.timeline?.length || currentProof.pages.length;
    if (frameCount <= 1) {
        playbackStatus.textContent = 'No animation available';
        return;
    }
    stopPlayback();
    playbackStatus.textContent = 'Playing';
    const startingPosition = playbackPosition;
    playbackStartedAt = performance.now();
    smoothedFps = 0;
    smoothedWorkMs = 0;
    lastRenderTimestamp = 0;
    const step = (timestamp: number): void => {
        const elapsed = timestamp - playbackStartedAt;
        const span = Math.max(1, frameCount - 1);
        const continuousPosition = (startingPosition + (elapsed / Math.max(1, frameDurationMs))) % span;
        playbackPosition = holdExactTicks ? Math.floor(continuousPosition) : continuousPosition;
        render(timestamp);
        playbackTimer = window.requestAnimationFrame(step);
    };
    playbackTimer = window.requestAnimationFrame(step);
});
pauseButton.addEventListener('click', () => {
    stopPlayback();
    render();
});
window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        advancePage(-1);
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        advancePage(1);
        return;
    }
    if (event.key === ' ') {
        event.preventDefault();
        if (playbackTimer !== null) {
            stopPlayback();
            render();
        } else {
            playButton.click();
        }
    }
});

updateHud();
selectProof('saucer');
