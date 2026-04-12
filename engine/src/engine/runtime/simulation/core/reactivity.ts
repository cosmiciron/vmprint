export type ReactiveCheckpointSignatureInput = {
    kind: 'observer';
    checkpoint: {
        kind: string;
        pageIndex: number;
        actorIndex: number;
        anchorActorId?: string;
        anchorSourceId?: string;
        frontier: {
            cursorY?: number;
            worldY?: number;
        };
    };
    frontier: {
        pageIndex: number;
        cursorY?: number;
        worldY?: number;
        actorIndex?: number;
        actorId?: string;
        sourceId?: string;
    };
    sequenceOrTick: number;
};

export function buildReactiveResettlementSignature(input: ReactiveCheckpointSignatureInput): string {
    const { kind, checkpoint, frontier, sequenceOrTick } = input;
    return [
        kind,
        checkpoint.kind,
        checkpoint.pageIndex,
        Number.isFinite(checkpoint.frontier.cursorY) ? Number(checkpoint.frontier.cursorY).toFixed(3) : 'na',
        Number.isFinite(checkpoint.frontier.worldY) ? Number(checkpoint.frontier.worldY).toFixed(3) : 'na',
        checkpoint.actorIndex,
        checkpoint.anchorActorId ?? 'na',
        checkpoint.anchorSourceId ?? 'na',
        frontier.pageIndex,
        Number.isFinite(frontier.cursorY) ? Number(frontier.cursorY).toFixed(3) : 'na',
        Number.isFinite(frontier.worldY) ? Number(frontier.worldY).toFixed(3) : 'na',
        frontier.actorIndex ?? 'na',
        frontier.actorId ?? 'na',
        frontier.sourceId ?? 'na',
        sequenceOrTick
    ].join('|');
}
