export type AsyncThoughtState = 'pending' | 'completed' | 'failed';

export type AsyncThoughtHandle<T = unknown> = {
    key: string;
    state: AsyncThoughtState;
    result?: T;
    error?: string;
    completedAt?: number;
    metadata?: Record<string, unknown>;
};

type AsyncThoughtEntry = AsyncThoughtHandle & {
    promise?: Promise<unknown>;
};

export type AsyncThoughtRequest<T = unknown> = {
    key: string;
    executor: () => Promise<T>;
    metadata?: Record<string, unknown>;
};

export class AsyncThoughtHost {
    private readonly entries = new Map<string, AsyncThoughtEntry>();
    private completionVersion = 0;
    private readonly waiters = new Set<() => void>();

    request<T>(request: AsyncThoughtRequest<T>): AsyncThoughtHandle<T> {
        const existing = this.entries.get(request.key);
        if (existing) {
            return {
                key: existing.key,
                state: existing.state,
                result: existing.result as T | undefined,
                error: existing.error,
                completedAt: existing.completedAt,
                metadata: existing.metadata
            };
        }

        const entry: AsyncThoughtEntry = {
            key: request.key,
            state: 'pending',
            metadata: request.metadata
        };
        entry.promise = request.executor()
            .then((result) => {
                entry.state = 'completed';
                entry.result = result;
                entry.completedAt = Date.now();
                this.notifyCompletion();
            })
            .catch((error) => {
                entry.state = 'failed';
                entry.error = error instanceof Error ? error.message : String(error);
                entry.completedAt = Date.now();
                this.notifyCompletion();
            });
        this.entries.set(request.key, entry);
        return {
            key: entry.key,
            state: entry.state,
            metadata: entry.metadata
        };
    }

    read<T>(key: string): AsyncThoughtHandle<T> | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        return {
            key: entry.key,
            state: entry.state,
            result: entry.result as T | undefined,
            error: entry.error,
            completedAt: entry.completedAt,
            metadata: entry.metadata
        };
    }

    hasPending(): boolean {
        for (const entry of this.entries.values()) {
            if (entry.state === 'pending') return true;
        }
        return false;
    }

    getSummary(): AsyncThoughtHandle[] {
        return Array.from(this.entries.values()).map((entry) => ({
            key: entry.key,
            state: entry.state,
            result: entry.result,
            error: entry.error,
            completedAt: entry.completedAt,
            metadata: entry.metadata
        }));
    }

    async waitForNextCompletion(timeoutMs: number): Promise<boolean> {
        if (!this.hasPending()) return false;
        const observedVersion = this.completionVersion;
        if (this.completionVersion > observedVersion) return true;
        return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                this.waiters.delete(onCompletion);
                resolve(value);
            };
            const onCompletion = () => finish(true);
            this.waiters.add(onCompletion);
            const timer = timeoutMs > 0
                ? setTimeout(() => finish(false), timeoutMs)
                : null;
        });
    }

    private notifyCompletion(): void {
        this.completionVersion += 1;
        for (const waiter of Array.from(this.waiters)) {
            waiter();
        }
    }
}
