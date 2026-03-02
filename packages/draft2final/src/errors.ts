export type PipelineStage = 'parse' | 'normalize' | 'format' | 'render' | 'write' | 'cli';

export class Draft2FinalError extends Error {
    public readonly stage: PipelineStage;
    public readonly filePath: string;
    public readonly exitCode: number;

    constructor(
        stage: PipelineStage,
        filePath: string,
        message: string,
        exitCode: number,
        options?: { cause?: unknown },
    ) {
        super(message);
        this.name = 'Draft2FinalError';
        this.stage = stage;
        this.filePath = filePath;
        this.exitCode = exitCode;
        if (options?.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

export function formatDiagnostic(error: Draft2FinalError): string {
    return `[draft2final] stage=${error.stage} file=${error.filePath} message=${error.message}`;
}
