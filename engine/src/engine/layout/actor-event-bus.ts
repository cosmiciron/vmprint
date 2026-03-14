export type ActorSignalPayload = Record<string, unknown> | undefined;

export type ActorSignalDraft = {
    topic: string;
    publisherActorId: string;
    publisherSourceId: string;
    publisherActorKind: string;
    fragmentIndex: number;
    pageIndex?: number;
    signalKey?: string;
    payload?: ActorSignalPayload;
};

export type ActorSignal = {
    topic: string;
    publisherActorId: string;
    publisherSourceId: string;
    publisherActorKind: string;
    fragmentIndex: number;
    pageIndex: number;
    signalKey?: string;
    payload?: ActorSignalPayload;
    sequence: number;
};

export type ActorEventBusSnapshot = {
    signals: ActorSignal[];
    keyedSignalIndices: Map<string, number>;
    sequence: number;
};

export class ActorEventBus {
    private signals: ActorSignal[] = [];
    private keyedSignalIndices = new Map<string, number>();
    private sequence = 0;

    resetForSimulation(): void {
        this.signals = [];
        this.keyedSignalIndices.clear();
        this.sequence = 0;
    }

    publish(signal: ActorSignalDraft): ActorSignal {
        const topic = String(signal.topic || '').trim();
        if (!topic) {
            throw new Error('[ActorEventBus] Cannot publish a signal without a topic.');
        }

        const normalized: ActorSignal = {
            topic,
            publisherActorId: signal.publisherActorId,
            publisherSourceId: signal.publisherSourceId,
            publisherActorKind: signal.publisherActorKind,
            fragmentIndex: Math.max(0, Math.floor(Number(signal.fragmentIndex || 0))),
            pageIndex: Number.isFinite(signal.pageIndex) ? Math.max(0, Number(signal.pageIndex)) : 0,
            signalKey: signal.signalKey,
            payload: signal.payload ? { ...signal.payload } : undefined,
            sequence: ++this.sequence
        };

        if (normalized.signalKey && this.keyedSignalIndices.has(normalized.signalKey)) {
            const index = this.keyedSignalIndices.get(normalized.signalKey)!;
            const previous = this.signals[index];
            const replacement: ActorSignal = {
                ...normalized,
                sequence: previous.sequence
            };
            this.signals[index] = replacement;
            return replacement;
        }

        this.signals.push(normalized);
        if (normalized.signalKey) {
            this.keyedSignalIndices.set(normalized.signalKey, this.signals.length - 1);
        }
        return normalized;
    }

    read(topic?: string): readonly ActorSignal[] {
        if (!topic) {
            return this.signals;
        }
        return this.signals.filter((signal) => signal.topic === topic);
    }

    captureSnapshot(): ActorEventBusSnapshot {
        return {
            signals: this.signals.map((signal) => ({
                ...signal,
                payload: signal.payload ? { ...signal.payload } : undefined
            })),
            keyedSignalIndices: new Map(this.keyedSignalIndices),
            sequence: this.sequence
        };
    }

    restoreSnapshot(snapshot: ActorEventBusSnapshot): void {
        this.signals = snapshot.signals.map((signal) => ({
            ...signal,
            payload: signal.payload ? { ...signal.payload } : undefined
        }));
        this.keyedSignalIndices = new Map(snapshot.keyedSignalIndices);
        this.sequence = snapshot.sequence;
    }
}
