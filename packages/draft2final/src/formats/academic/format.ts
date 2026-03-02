import { MarkdownFormat } from '../markdown/format';

/**
 * AcademicFormat — markdown grammar with academic defaults.
 * Behavioral differences (theorem/lemma/proof block modes, compact list spacing,
 * no-indent continuation) are declared entirely in config.defaults.yaml.
 * Visual differences are declared in themes/default.yaml.
 * No code overrides needed.
 */
export class AcademicFormat extends MarkdownFormat {}
