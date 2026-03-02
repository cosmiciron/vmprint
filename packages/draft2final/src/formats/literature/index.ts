import { listThemes } from '../compiler';
import { LiteratureFormat } from './format';
import type { FormatModule } from '../types';

export const literatureFormat: FormatModule = {
    name: 'literature',
    listThemes() {
        return listThemes('literature');
    },
    createHandler(config) {
        return new LiteratureFormat(config);
    },
};
