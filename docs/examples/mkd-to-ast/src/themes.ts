import defaultTheme from '../../../../draft2final/src/formats/markdown/themes/default.yaml';
import novelTheme from '../../../../draft2final/src/formats/markdown/themes/novel.yaml';
import opensourceTheme from '../../../../draft2final/src/formats/markdown/themes/opensource.yaml';

export const THEMES: Record<string, string> = {
  default: defaultTheme,
  opensource: opensourceTheme,
  novel: novelTheme
};

export const THEME_NAMES = Object.keys(THEMES);
