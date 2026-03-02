import { listThemes } from '../compiler';
import { MarkdownFormat } from './format';
import type { FormatModule } from '../types';

export const markdownFormat: FormatModule = {
    name: 'markdown',
    listThemes() {
        return listThemes('markdown');
    },
    createHandler(config) {
        return new MarkdownFormat(config);
    },
};
