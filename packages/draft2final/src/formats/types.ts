import type { FormatHandler } from './compiler';

export type FormatModule = {
    name: string;
    listThemes(): string[];
    createHandler(config: Record<string, unknown>): FormatHandler;
};
