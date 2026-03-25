// Note: defaultTheme is now handled by the transmuter itself if undefined is passed.
// Previously this pointed to a retired monolithic path.
const defaultTheme = undefined;
import novelTheme from './themes/novel.yaml';
import opensourceTheme from './themes/opensource.yaml';

export const THEMES: Record<string, string | undefined> = {
  default: defaultTheme,
  opensource: opensourceTheme,
  novel: novelTheme
};

export const THEME_NAMES = Object.keys(THEMES);
