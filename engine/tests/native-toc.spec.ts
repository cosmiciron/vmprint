import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VMPrintEngine, loadDocument, toLayoutConfig } from '../src';
import { createPrintEngineRuntime } from '../src/font-management/runtime';
import { LayoutSession } from '../src/engine/layout/layout-session';
import { HeadingSignalCollaborator, HEADING_SIGNAL_TOPIC } from '../src/engine/layout/runtime/signals/heading-signal-publisher';
import { FlowBoxPackager } from '../src/engine/layout/packagers/flow-box-packager';
import type { PackagerUnit } from '../src/engine/layout/packagers/packager-types';
import { loadLocalFontManager, snapshotPages } from './harness/engine-harness';

const small = JSON.parse(fs.readFileSync(new URL('./fixtures/regression/24-toc-live-reactive.json', import.meta.url), 'utf8'));
// Keep the original synthetic stress case alongside Gavin's pinned reproduction.
const reported = JSON.parse(fs.readFileSync(new URL('./fixtures/native-toc/20-root-headings.json', import.meta.url), 'utf8'));
const gavin = JSON.parse(fs.readFileSync(new URL('./fixtures/native-toc/gavin-20-root-headings.json', import.meta.url), 'utf8'));
const book = JSON.parse(fs.readFileSync(new URL('../../docs/examples/native-toc/book.json', import.meta.url), 'utf8'));
const longSplit = JSON.parse(fs.readFileSync(new URL('./fixtures/native-toc/long-split-heading.json', import.meta.url), 'utf8'));
let FontManager: any;
function document(count: number, story?: 'paragraph' | 'heading', wrapped = false): any {
    const doc = structuredClone(reported);
    doc.layout.pageSize = { width: 420, height: 600 };
    const body: any[] = [];
    if (story === 'paragraph') body.push({ type: 'p', content: 'Opening paragraph before the first heading.' });
    for (let i = 0; i < count; i++) {
        body.push({ type: 'h2', content: `Section ${i}${wrapped ? ': A long heading exploring discovery and continuation across the printed contents pages' : ''}`, properties: { sourceId: `section-${i}` } });
        body.push({ type: 'p', content: 'The paragraph follows the heading and fills the page with enough text to exercise grouping and splitting. '.repeat(5), properties: { sourceId: `body-${i}` } });
    }
    doc.elements = [doc.elements[0], ...(story ? [{ type: 'story', columns: 2, gutter: 18, children: body }] : body)];
    return doc;
}
async function layout(doc: any) {
    return new VMPrintEngine(loadDocument(doc), new FontManager()).layout();
}
const text = (box: any) => (box.lines ?? []).map((line: any[]) => line.map(s => s.text ?? '').join('')).join(' ');
function verify(pages: any[], count: number, wrapped = false) {
    const toc = pages.flatMap(p => p.boxes.filter((b: any) => b.type === 'toc'));
    const contents = toc.map(text).join(' ').replace(/\s+/g, ' ');
    let lastIndex = -1;
    const expected: string[] = ['Contents'];
    for (let i = 0; i < count; i++) {
        const heading = `Section ${i}${wrapped ? ': A long heading exploring discovery and continuation across the printed contents pages' : ''}`;
        const page = pages.findIndex(p => p.boxes.some((b: any) => String(b.meta?.sourceId).endsWith(`:section-${i}`) && !b.meta?.isContinuation));
        assert.ok(page >= 0, `rendered heading ${i}`);
        assert.equal(pages.flatMap(p => p.boxes).filter((b: any) => String(b.meta?.sourceId).endsWith(`:section-${i}`) && !b.meta?.isContinuation && text(b).trim()).length, 1, `one visible heading ${i}`);
        const entry = `${heading} ${page + 1}`;
        expected.push(entry);
        assert.equal(contents.split(entry).length - 1, 1, `one entry with final page: ${entry}\n${contents}`);
        const index = contents.indexOf(entry);
        assert.ok(index > lastIndex, `ordered entry ${i}`);
        lastIndex = index;
    }
    assert.equal(contents, expected.join(' '), 'contents contains only the title and each heading/reference, once');
    for (const p of pages) for (const b of p.boxes.filter((b: any) => b.type === 'toc')) {
        assert.ok(b.y + b.h <= p.height - 40 + 0.1, `TOC fits page ${p.index}: ${b.y}+${b.h}`);
    }
    for (const p of pages) {
        for (const a of p.boxes.filter((b: any) => b.type === 'toc')) {
            for (const b of p.boxes.filter((b: any) => b !== a && !b.meta?.generated)) {
                assert.ok(b.y + b.h <= a.y + 0.1 || b.y >= a.y + a.h - 0.1, `no overlap with TOC on page ${p.index}`);
            }
        }
    }
    return toc;
}
async function runCase(mode: string, count: number) {
    const doc = mode === 'root' && count === 20 ? structuredClone(reported)
        : document(count, mode === 'paragraph' ? 'paragraph' : mode === 'heading' ? 'heading' : undefined, mode === 'wrapped');
    const pages = await layout(doc);
    const toc = verify(pages, count, mode === 'wrapped');
    if (mode === 'wrapped') assert.ok(pages.filter(p => p.boxes.some(b => b.type === 'toc')).length >= 2);
    if (mode === 'heading' || mode === 'paragraph') {
        assert.ok(pages.filter(p => p.boxes.some(b => /^h[1-6]$/.test(b.meta?.sourceType ?? ''))).length >= 2, 'headings on later story fragments');
    }
    assert.deepEqual(snapshotPages(await layout(doc)), snapshotPages(pages));
    console.log(`PASS native TOC ${mode}: ${count} headings, ${pages.length} pages, ${toc.length} TOC fragments`);
}

async function checkAuthoredDocument(doc: any, name: string, multiPageToc = false) {
    const headings: any[] = [];
    const visit = (elements: any[]) => {
        for (const element of elements) {
            if (/^h[1-6]$/.test(element.type)) headings.push(element);
            if (element.children) visit(element.children);
        }
    };
    visit(doc.elements);
    const pages = await layout(doc);
    const contents = pages.flatMap(page => page.boxes.filter(box => box.type === 'toc')).map(text).join(' ').replace(/\s+/g, ' ').trim();
    const expected = ['Contents'];
    for (const heading of headings) {
        const id = heading.properties.sourceId;
        const headingPage = pages.findIndex(page => page.boxes.some(box => box.meta?.sourceId === `author:${id}` && text(box).trim()));
        assert.ok(headingPage >= 0, `${name}: rendered heading ${id}`);
        expected.push(`${heading.content.trim().replace(/\s+/g, ' ')} ${headingPage + 1}`);
    }
    assert.equal(contents, expected.join(' '), `${name}: every heading once, in order, with its final page`);
    if (multiPageToc) {
        const tocBoxes = pages.flatMap(page => page.boxes.filter(box => box.type === 'toc'));
        assert.ok(pages.filter(page => page.boxes.some(box => box.type === 'toc')).length >= 2, `${name}: multiple contents pages`);
        assert.ok(tocBoxes.reduce((sum, box) => sum + (box.lines?.length ?? 0), 0) > headings.length + 1, `${name}: wrapped contents title`);
    }
    assert.deepEqual(snapshotPages(await layout(doc)), snapshotPages(pages), `${name}: deterministic output`);
    console.log(`PASS ${name}: ${headings.length} entries, ${pages.length} pages`);
}

function checkGroupedPublication(headingTail = false) {
    let canSplit = false;
    const commits: string[] = [];
    const session = new LayoutSession({
        config: toLayoutConfig(loadDocument(reported), false),
        runtime: createPrintEngineRuntime({ fontManager: new FontManager() }),
        collaborators: [new HeadingSignalCollaborator(), {
            onActorCommitted(actor) { commits.push(actor.sourceId); }
        }]
    });
    const actor = (id: string, type: string, content: string, height: number): PackagerUnit => ({
        actorId: `actor:${id}`, sourceId: id, actorKind: type, fragmentIndex: 0,
        prepare() {}, getRequiredHeight: () => height, getLeadingSpacing: () => 0, getTrailingSpacing: () => 0,
        isUnbreakable: () => false,
        emitBoxes: () => [{ type, content, x: 40, y: 0, w: 340, h: height,
            meta: { sourceId: id, engineKey: id, sourceType: type, fragmentIndex: 0, isContinuation: false } }],
        reshape: () => ({ currentFragment: null, continuationFragment: null })
    });
    const heading = actor('group-heading', 'h2', 'Grouped heading', 20);
    const tail = actor('tail', headingTail ? 'h2' : 'p', 'Complete tail heading', 100);
    const partA = actor('tail', headingTail ? 'h2' : 'p', 'First body lines', 40);
    partA.getSourceText = () => 'Complete tail heading';
    const partB = { ...actor('tail', 'p', 'Remaining body lines', 60), actorId: 'tail:continuation', fragmentIndex: 1, continuationOf: tail.actorId };
    tail.reshape = () => canSplit ? { currentFragment: partA, continuationFragment: partB }
        : { currentFragment: null, continuationFragment: tail };
    const boxes: any[] = [];
    const queue = [heading, tail];
    const pages: any[] = [];
    const context: any = { processor: {}, pageWidth: 420, pageHeight: 600,
        margins: { top: 40, right: 40, bottom: 40, left: 40 }, readActorSignals: (topic?: string) => session.getActorSignals(topic) };
    const run = (pageIndex: number) => {
        session.notifyPageStart(pageIndex, 420, 600, boxes);
        return session.transitionsRuntime.executeTailSplitFormationBranch(
            pages, boxes, pageIndex, 420, 600, 40, 0, queue,
            { prefix: [heading], splitCandidate: tail, replaceCount: 2, splitMarkerReserve: 0 },
            { currentY: 490, lastSpacingAfter: 0, pageLimit: 560, availableWidth: 340 },
            'tail-split-formation', context, false, () => []);
    };
    run(0);
    assert.equal(boxes.length, 0, 'rejected prefix placement rolls back boxes');
    assert.equal(commits.length, 0, 'rejected candidate publishes no commit callbacks');
    assert.equal(session.getActorSignals(HEADING_SIGNAL_TOPIC).length, 0, 'rejected candidate publishes no facts');
    const snapshot = session.fragmentSessionRuntime.captureLocalBranchSnapshot(boxes, queue, 490, 0);
    canSplit = true;
    run(0);
    assert.equal(commits.filter(id => id === heading.sourceId).length, 1);
    assert.equal(pages[0].boxes.find((b: any) => b.meta.sourceId === heading.sourceId).y, 490);
    assert.equal(session.getActorSignals(HEADING_SIGNAL_TOPIC)[0].pageIndex, 0);
    session.fragmentSessionRuntime.restoreLocalBranchSnapshot(boxes, queue, snapshot);
    pages.length = 0;
    assert.equal(session.getActorSignals(HEADING_SIGNAL_TOPIC).length, 0, 'rollback removes accepted heading fact');
    run(2);
    const allSignals = session.getActorSignals(HEADING_SIGNAL_TOPIC);
    if (headingTail) {
        assert.deepEqual(allSignals.map(signal => signal.publisherSourceId), [heading.sourceId, tail.sourceId], 'prefix publishes before split heading tail');
        assert.equal(allSignals[1].payload?.heading, 'Complete tail heading');
    }
    const signals = allSignals.filter(signal => signal.publisherSourceId === heading.sourceId);
    assert.equal(signals.length, 1, 'replay publishes one heading');
    assert.equal(signals[0].pageIndex, 2, 'replay replaces the old page position');
    assert.equal(signals[0].cursorY, 490);
    assert.equal(signals[0].payload?.heading, 'Grouped heading');
    session.notifyActorCommitted(heading, pages[0].boxes.filter((b: any) => b.meta.sourceId === heading.sourceId));
    assert.equal(session.getActorSignals(HEADING_SIGNAL_TOPIC).filter(signal => signal.publisherSourceId === heading.sourceId).length, 1, 'repeated commit remains keyed by heading identity');
    console.log('PASS grouped heading accepted/rejected placement, rollback, and replay');
}

async function main() {
    FontManager = await loadLocalFontManager();
    checkGroupedPublication();
    checkGroupedPublication(true);
    const sourceText = FlowBoxPackager.prototype.getSourceText;
    let revision = 0;
    try {
        FlowBoxPackager.prototype.getSourceText = function () {
            const text = sourceText.call(this);
            if (revision >= 32) throw new Error('Oscillation guard failed to stop within 32 heading revisions');
            return this.sourceId === 'author:outer' ? `${text} revision ${revision++ % 2}` : text;
        };
        await assert.rejects(() => layout(longSplit), /Reactive geometry resettlement exceeded the cycle cap|Reactive geometry oscillation detected/,
            'finalization-driven oscillation remains bounded across replay ticks');
    } finally {
        FlowBoxPackager.prototype.getSourceText = sourceText;
    }
    console.log('PASS finalization-driven oscillation hard stop');
    await checkAuthoredDocument(longSplit, 'Long split heading');
    await checkAuthoredDocument(gavin, 'Gavin pinned original');
    await checkAuthoredDocument(book, 'Native TOC book example', true);
    if (process.argv[2]) return runCase(process.argv[2], Number(process.argv[3] ?? 20));
    for (const count of [1, 20, 80, 200]) await runCase('root', count);
    await runCase('paragraph', 20);
    await runCase('heading', 20);
    await runCase('wrapped', 40);
    const smallPages = await layout(small);
    assert.deepEqual(snapshotPages(await layout(small)), snapshotPages(smallPages));
    console.log('PASS existing small native TOC determinism');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
