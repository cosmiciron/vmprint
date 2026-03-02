import { listThemes } from '../compiler';
import { ScreenplayFormat } from './format';
import type { FormatModule } from '../types';

export const screenplayFormat: FormatModule = {
    name: 'screenplay',
    listThemes() {
        return listThemes('screenplay');
    },
    createHandler(config) {
        return new ScreenplayFormat(config);
    },
};
