import { FontConfig } from '@vmprint/contracts';

export const normalizeFamilyKey = (family: string): string => String(family || '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ');

export const cloneFontConfig = (font: FontConfig): FontConfig => ({ ...font });
export const cloneFontRegistry = (fonts: FontConfig[]): FontConfig[] => fonts.map(cloneFontConfig);
