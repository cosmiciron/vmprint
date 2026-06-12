import assert from 'node:assert/strict';

import {
    CURRENT_DOCUMENT_VERSION,
    LayoutEngine,
    loadDocument,
    setDefaultEngineRuntime,
    toLayoutConfig,
    type DocumentInput
} from '../src';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { loadLocalFontManager } from './harness/engine-harness';
import { checkAsync, logStep } from './harness/test-utils';

const TEST_PREFIX = 'publication-mode.spec';
const log = (msg: string) => logStep(TEST_PREFIX, msg);
const _checkAsync = (desc: string, exp: string, fn: () => Promise<void>) => checkAsync(TEST_PREFIX, desc, exp, fn);

function makeDocument(
    layout: Partial<DocumentInput['layout']> = {}
): DocumentInput {
    const blockText = 'Continuous publication keeps browser flow in one world while print pagination can still slice it into pages.';
    return {
        documentVersion: CURRENT_DOCUMENT_VERSION,
        layout: {
            pageSize: 'LETTER',
            margins: { top: 72, right: 72, bottom: 72, left: 72 },
            fontFamily: 'Arimo',
            fontSize: 13,
            lineHeight: 1.35,
            ...layout
        },
        fonts: { regular: 'Arimo' },
        styles: {
            p: {
                marginBottom: 10,
                allowLineSplit: true,
                orphans: 2,
                widows: 2
            }
        },
        elements: [
            { type: 'p', name: 'lead', content: blockText.repeat(2) },
            {
                type: 'p',
                name: 'forcedBreak',
                content: blockText.repeat(2),
                properties: { style: { pageBreakBefore: true } }
            },
            ...Array.from({ length: 120 }, (_, index) => ({
                type: 'p',
                name: `tail${index + 1}`,
                content: `${index + 1}. ${blockText}`
            }))
        ]
    };
}

async function layout(document: DocumentInput): Promise<{ engine: LayoutEngine; pages: ReturnType<LayoutEngine['simulate']> }> {
    const ir = loadDocument(document, `publication-mode:${document.layout.publicationMode || 'paginated'}`);
    const engine = new LayoutEngine(toLayoutConfig(ir, false));
    await engine.waitForFonts();
    return { engine, pages: engine.simulate(ir.elements) };
}

async function main(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
    setDefaultEngineRuntime(runtime);

    log('Installing local font runtime');

    await _checkAsync('continuous publication ignores print breaks by default', 'one resized page with no continuations', async () => {
        const { engine, pages } = await layout(makeDocument({ publicationMode: 'continuous' }));
        assert.equal(pages.length, 1);
        assert.ok(pages[0].height > 792, 'continuous page should grow beyond the default LETTER page height');
        assert.ok(pages[0].height < 10_000_000, 'continuous page should publish at explored content height');
        const registry = (engine.getCurrentLayoutSession() as any)?.kernel?.actorRegistry || [];
        assert.equal(registry.filter((actor: any) => actor?.continuationOf).length, 0);
    });

    await _checkAsync('continuous publication can preserve print breaks explicitly', 'forced break still creates a page boundary', async () => {
        const { pages } = await layout(makeDocument({
            publicationMode: 'continuous',
            printBreakPolicy: 'preserve'
        }));
        assert.ok(pages.length > 1);
    });

    await _checkAsync('paginated publication preserves print breaks by default', 'ordinary print layout remains multi-page', async () => {
        const { pages } = await layout(makeDocument());
        assert.ok(pages.length > 1);
    });

    // Keep the runtime alive through all checks; the local variable makes that
    // explicit for environments with aggressive module cleanup.
    assert.ok(runtime);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
