import { MarkdownFormat } from '../markdown/format';

/**
 * LiteratureFormat — markdown grammar with literary defaults.
 * Behavioral differences (verse/extract/epigraph modes, em-dash list markers,
 * roman numeral references) are declared entirely in config.defaults.yaml.
 * Visual differences are declared in themes/default.yaml.
 * No code overrides needed.
 */
export class LiteratureFormat extends MarkdownFormat {}
