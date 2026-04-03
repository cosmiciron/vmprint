import type { Box, Page } from '../types';

export type ChunkAdvanceOutcome = {
    nextChunkIndex: number;
    nextChunkBoxes: Box[];
    nextCurrentY: number;
    nextLastSpacingAfter: number;
};

export type ChunkAdvanceInput = {
    pages: Page[];
    currentChunkBoxes: Box[];
    currentChunkIndex: number;
    chunkWidth: number;
    chunkHeight: number;
    nextChunkStartY: number;
    finalizeChunk: (chunkIndex: number, width: number, height: number, boxes: readonly Box[]) => Page;
    notifyChunkStart: (chunkIndex: number, width: number, height: number, boxes: Box[]) => void;
};

export interface ChunkPolicy {
    resolveChunkOriginWorldY(chunkIndex: number, chunkHeight: number): number;
    advanceChunk(input: ChunkAdvanceInput): ChunkAdvanceOutcome;
}

export class SequentialPageChunkPolicy implements ChunkPolicy {
    resolveChunkOriginWorldY(chunkIndex: number, chunkHeight: number): number {
        const normalizedIndex = Number.isFinite(chunkIndex) ? Math.max(0, Number(chunkIndex)) : 0;
        const normalizedHeight = Number.isFinite(chunkHeight) ? Math.max(0, Number(chunkHeight)) : 0;
        return normalizedIndex * normalizedHeight;
    }

    advanceChunk(input: ChunkAdvanceInput): ChunkAdvanceOutcome {
        if (input.currentChunkBoxes.length > 0) {
            input.pages.push(
                input.finalizeChunk(
                    input.currentChunkIndex,
                    input.chunkWidth,
                    input.chunkHeight,
                    input.currentChunkBoxes
                )
            );
        }

        const nextChunkIndex = input.currentChunkIndex + 1;
        const nextChunkBoxes: Box[] = [];
        input.notifyChunkStart(nextChunkIndex, input.chunkWidth, input.chunkHeight, nextChunkBoxes);

        return {
            nextChunkIndex,
            nextChunkBoxes,
            nextCurrentY: input.nextChunkStartY,
            nextLastSpacingAfter: 0
        };
    }
}
