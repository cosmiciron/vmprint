import { listThemes } from '../compiler';
import { AcademicFormat } from './format';
import type { FormatModule } from '../types';

export const academicFormat: FormatModule = {
    name: 'academic',
    listThemes() {
        return listThemes('academic');
    },
    createHandler(config) {
        return new AcademicFormat(config);
    },
};
