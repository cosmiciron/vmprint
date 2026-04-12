export class TextDelegateLoadError extends Error {
    constructor(public readonly url: string, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'TextDelegateLoadError';
        if (options?.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}
