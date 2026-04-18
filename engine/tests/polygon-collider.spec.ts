import assert from 'node:assert/strict';

import { LayoutEngine } from '../src/engine/layout-engine';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { resolveDocumentPaths, toLayoutConfig, type DocumentInput } from '../src';
import { setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager } from './harness/engine-harness';

async function run(): Promise<void> {
    const LocalFontManager = await loadLocalFontManager();
    const runtime = createPrintEngineRuntime({ fontManager: new LocalFontManager() });
    setDefaultEngineRuntime(runtime);

    const document: DocumentInput = {
        documentVersion: '1.1',
        layout: {
            pageSize: { width: 420, height: 520 },
            margins: { top: 36, right: 36, bottom: 36, left: 36 },
            fontFamily: 'Arimo',
            fontSize: 11,
            lineHeight: 1.3,
            storyWrapOpticalUnderhang: true
        },
        fonts: {
            regular: 'Arimo'
        },
        styles: {
            p: {
                marginBottom: 8,
                allowLineSplit: true
            }
        },
        elements: [
            {
                type: 'story',
                content: '',
                children: [
                    {
                        type: 'image',
                        content: '',
                        placement: {
                            mode: 'float',
                            align: 'left',
                            wrap: 'around',
                            gap: 8,
                            shape: 'polygon',
                            path: 'M0,66 L66,0 L132,66 L66,132 Z'
                        },
                        properties: {
                            sourceId: 'polygon-float',
                            style: {
                                width: 132,
                                height: 132
                            }
                        },
                        image: {
                            mimeType: 'image/png',
                            fit: 'fill',
                            data: 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAkElEQVR42u3QMQ0AAAwDoEqv9Fnot4cEBSQtKwWyZMmSJQsFsmTJkiULBbJkyZIlCwWyZMmSJQsFsmTJkiULBbJkyZIlCwWyZMmSJQsFsmTJkiULBbJkyZIlCwWyZMmSJQsFsmTJkiULBbJkyZIlCwWyZMmSJQsFsmTJkiULBbJkyZIlCwWyZMmSJQsFsmR9OyMOEkoQG4WbAAAAAElFTkSuQmCC'
                        }
                    },
                    {
                        type: 'p',
                        name: 'polygon-copy',
                        content: 'Polygon wrap in VMPrint should behave like a real collider feature instead of a decorative shortcut. The opening lines should give the float a wide berth near the diamond shoulders, then reclaim width as the band falls below the obstacle and the story can breathe again. This sentence is deliberately long so the paragraph produces enough wrapped lines to show the changing horizontal slot over time.'
                    }
                ]
            }
        ]
    };

    const resolved = resolveDocumentPaths(document, 'polygon-collider.spec.json');
    const engine = new LayoutEngine(toLayoutConfig(resolved, false), runtime);
    await engine.waitForFonts();
    const pages = engine.simulate(resolved.elements);

    assert.equal(pages.length, 1, 'polygon collider proof should fit on one page');
    const page = pages[0]!;
    const imageBox = page.boxes.find((box) => !!box.image);
    assert.ok(imageBox, 'expected polygon float image box');
    assert.equal(imageBox?.properties?._clipShape, 'polygon', 'polygon float should preserve polygon clip shape');
    assert.equal(
        imageBox?.properties?._clipPath,
        'M0,66 L66,0 L132,66 L66,132 Z',
        'polygon float should preserve authored clip path'
    );

    const textBox = page.boxes.find((box) => Array.isArray(box.lines) && box.lines.length > 0);
    assert.ok(textBox, 'expected polygon copy text box');

    const lineOffsets = Array.isArray(textBox?.properties?._lineOffsets)
        ? (textBox?.properties?._lineOffsets as number[]).map((value) => Number(value || 0))
        : [];
    const lineWidths = Array.isArray(textBox?.properties?._lineWidths)
        ? (textBox?.properties?._lineWidths as number[]).map((value) => Number(value || 0))
        : [];

    assert.ok(lineOffsets.length >= 6, 'polygon proof should yield several wrapped lines');
    assert.ok(lineOffsets.some((value) => value > 0.5), 'polygon wrap should shift at least one line laterally');
    assert.ok(lineOffsets.some((value) => value <= 0.5), 'polygon wrap should restore near-full-width lines after clearing the obstacle');
    assert.ok(
        new Set(lineWidths.map((value) => Math.round(value))).size >= 3,
        'polygon wrap should produce multiple distinct line widths across the band'
    );
}

run().catch((error) => {
    console.error('[polygon-collider.spec] FAILED', error);
    process.exitCode = 1;
});
