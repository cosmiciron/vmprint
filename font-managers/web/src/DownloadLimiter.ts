export class DownloadLimiter {
    private activeCount = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly maxConcurrent: number) { }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.maxConcurrent > 0 && this.activeCount >= this.maxConcurrent) {
            await new Promise<void>((resolve) => {
                this.queue.push(resolve);
            });
        }

        this.activeCount += 1;
        try {
            return await task();
        } finally {
            this.activeCount -= 1;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}
