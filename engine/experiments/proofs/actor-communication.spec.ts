import assert from 'node:assert/strict';
import { LayoutEngine } from '../../src/engine/layout-engine';
import { LayoutSession } from '../../src/engine/layout/layout-session';
import { Element, LayoutConfig } from '../../src/engine/types';
import { createEngineRuntime, setDefaultEngineRuntime } from '../../src/engine/runtime';
import { loadLocalFontManager } from '../../tests/harness/engine-harness';
import { experimentFactory } from '../packagers/experiment-factory';

function logStep(message: string): void {
    console.log(`[actor-communication.spec] ${message}`);
}

function check(description: string, expected: string, assertion: () => void): void {
    logStep(`CHECK: ${description}`);
    logStep(`EXPECT: ${expected}`);
    assertion();
    logStep(`PASS: ${description}`);
}

function buildConfig(): LayoutConfig {
    return {
        layout: {
            pageSize: { width: 320, height: 220 },
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            fontFamily: 'Arimo',
            fontSize: 12,
            lineHeight: 1.2
        },
        fonts: {
            regular: 'Arimo'
        },
        styles: {
            filler: { height: 70, marginBottom: 0 },
            hero: { height: 70, marginBottom: 0, keepWithNext: true },
            body: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 },
            p: { marginBottom: 8, allowLineSplit: true, orphans: 2, widows: 2 }
        }
    };
}

function longParagraph(seed: string): string {
    return `${seed} `.repeat(90).trim();
}

function repeatedParagraph(seed: string, repeatCount: number): string {
    return `${seed} `.repeat(repeatCount).trim();
}

function getBoxText(box: any): string {
    if (!Array.isArray(box.lines)) return '';
    return box.lines
        .map((line: any[]) => line.map((seg: any) => seg.text || '').join(''))
        .join('\n');
}

async function testLabeledHeadingPublishersDriveObserverGeometry() {
    logStep('Scenario: ordinary labeled chapter headings publish signals into one observer without becoming custom publisher types');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const headingStyle = {
        textAlign: 'center',
        fontWeight: 700,
        marginTop: 24,
        marginBottom: 18,
        keepWithNext: true
    };

    const elements: Element[] = [
        {
            type: 'chapter-heading',
            content: 'Chapter 1: Signal Fire',
            properties: {
                sourceId: 'heading-1',
                style: headingStyle,
                _actorSignalPublish: {
                    topic: 'outline-entry',
                    payload: { label: 'Chapter 1: Signal Fire' }
                }
            }
        },
        { type: 'p', content: longParagraph('Signal fire body one.') },
        { type: 'p', content: longParagraph('Signal fire body two.') },
        {
            type: 'chapter-heading',
            content: 'Chapter 2: Echo Valley',
            properties: {
                sourceId: 'heading-2',
                style: headingStyle,
                _actorSignalPublish: {
                    topic: 'outline-entry',
                    payload: { label: 'Chapter 2: Echo Valley' }
                }
            }
        },
        { type: 'p', content: longParagraph('Echo valley body one.') },
        { type: 'p', content: longParagraph('Echo valley body two.') },
        {
            type: 'chapter-heading',
            content: 'Chapter 3: Lantern Shore',
            properties: {
                sourceId: 'heading-3',
                style: headingStyle,
                _actorSignalPublish: {
                    topic: 'outline-entry',
                    payload: { label: 'Chapter 3: Lantern Shore' }
                }
            }
        },
        { type: 'p', content: longParagraph('Lantern shore body one.') },
        { type: 'p', content: longParagraph('Lantern shore body two.') },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'outline-observer',
                style: {
                    marginTop: 8,
                    marginBottom: 8
                },
                _actorSignalObserve: {
                    topic: 'outline-entry',
                    title: 'Observed Headings',
                    backgroundColor: '#dcfce7',
                    borderColor: '#15803d',
                    baseHeight: 70,
                    growthPerSignal: 28
                }
            }
        }
    ];

    const pages = engine.simulate(elements);
    const observerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box }))
    );
    const headingTextBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'chapter-heading')
            .map((box) => ({ pageIndex, text: getBoxText(box) }))
            .filter(({ text }) => /Chapter [123]:/.test(text))
    );

    check(
        'ordinary chapter headings publish through the bulletin board',
        'the layout contains the three labeled chapter headings across multiple pages before the observer reads them',
        () => {
            const combinedHeadingText = headingTextBoxes.map(({ text }) => text).join('\n');
            assert.match(combinedHeadingText, /Chapter 1: Signal Fire/, 'expected first heading text in layout');
            assert.match(combinedHeadingText, /Chapter 2: Echo Valley/, 'expected second heading text in layout');
            assert.match(combinedHeadingText, /Chapter 3: Lantern Shore/, 'expected third heading text in layout');
            assert.ok(new Set(headingTextBoxes.map(({ pageIndex }) => pageIndex)).size >= 2, 'expected headings across multiple pages');
        }
    );

    check(
        'observer actor sees labeled heading signals from ordinary domain actors',
        'observer text includes heading labels published by chapter-heading elements',
        () => {
            assert.ok(observerBoxes.length > 0, 'expected an observer box');
            const observer = observerBoxes[0];
            assert.ok(observer.pageIndex > headingTextBoxes[0].pageIndex, 'expected observer after heading publishers');
            const combinedText = observerBoxes.map(({ box }) => getBoxText(box)).join('\n');
            assert.match(combinedText, /Count:\s*3/, 'observer should include the signal count');
            assert.match(combinedText, /Observed Headings/, 'observer should include its title');
            assert.match(combinedText, /Chapter 1: Signal Fire/, 'observer should include first heading label');
            assert.match(combinedText, /Chapter 2:\s*Echo Valley/, 'observer should include second heading label even if split across fragments');
            assert.match(combinedText, /Chapter 3: Lantern Shore/, 'observer should include third heading label');
        }
    );

    check(
        'observer geometry still reacts to real heading traffic',
        'observer footprint grows enough to require more than one fragment under aggregate heading load',
        () => {
            assert.ok(observerBoxes.length >= 2, 'expected observer to span more than one fragment');
        }
    );
}

async function testObserverSummaryDrivesFollowerLayout() {
    logStep('Scenario: observer summary signal drives a downstream follower actor layout shift');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const publisherStyle = {
        height: 110,
        marginBottom: 12,
        paddingTop: 12,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 12,
        backgroundColor: '#dbeafe',
        borderColor: '#2563eb',
        borderWidth: 1
    };

    const elements: Element[] = [
        {
            type: 'test-signal-publisher',
            content: 'Publisher Alpha',
            properties: {
                sourceId: 'chain-pub-alpha',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Alpha' }
                }
            }
        },
        { type: 'p', content: longParagraph('Alpha filler for chained follower proof.') },
        {
            type: 'test-signal-publisher',
            content: 'Publisher Beta',
            properties: {
                sourceId: 'chain-pub-beta',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Beta' }
                }
            }
        },
        { type: 'p', content: longParagraph('Beta filler for chained follower proof.') },
        {
            type: 'test-signal-publisher',
            content: 'Publisher Gamma',
            properties: {
                sourceId: 'chain-pub-gamma',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Gamma' }
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'chain-observer',
                style: {
                    marginTop: 8,
                    marginBottom: 8
                },
                _actorSignalObserve: {
                    topic: 'probe-heading',
                    title: 'Observed Publishers',
                    publishTopic: 'observer-summary',
                    backgroundColor: '#dcfce7',
                    borderColor: '#15803d',
                    baseHeight: 80,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'test-signal-follower',
            content: '',
            properties: {
                sourceId: 'chain-follower',
                style: {
                    marginTop: 10,
                    marginBottom: 8
                },
                _actorSignalFollow: {
                    topic: 'observer-summary',
                    title: 'Follower Shift',
                    backgroundColor: '#ede9fe',
                    borderColor: '#7c3aed',
                    baseHeight: 72,
                    indentPerSignal: 18
                }
            }
        }
    ];

    const pages = engine.simulate(elements);
    const observerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes.filter((box) => box.type === 'test-signal-observer').map((box) => ({ pageIndex, box }))
    );
    const followerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes.filter((box) => box.type === 'test-signal-follower').map((box) => ({ pageIndex, box }))
    );

    check(
        'observer publishes an aggregate summary for downstream actors',
        'follower text includes the observer summary count and labels',
        () => {
            assert.ok(observerBoxes.length > 0, 'expected observer boxes');
            assert.ok(followerBoxes.length > 0, 'expected follower boxes');
            const followerText = followerBoxes.map(({ box }) => getBoxText(box)).join('\n');
            assert.match(followerText, /Observer Count:\s*3/, 'expected observer count in follower text');
            assert.match(followerText, /Alpha/, 'expected Alpha label in follower text');
            assert.match(followerText, /Beta/, 'expected Beta label in follower text');
            assert.match(followerText, /Gamma/, 'expected Gamma label in follower text');
        }
    );

    check(
        'follower changes its own layout from the observer summary',
        'follower box shifts right from the default left margin after reading the aggregate signal',
        () => {
            const firstFollower = followerBoxes[0].box;
            assert.ok(firstFollower.x > 40, `expected follower x to shift right beyond the default lane, got ${firstFollower.x}`);
        }
    );
}

async function testSyntheticCollectorListDrivesTrailingFlow() {
    logStep('Scenario: synthetic TOC-like collector list grows from many labels and pushes trailing flow');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const publisherStyle = {
        height: 64,
        marginBottom: 10,
        paddingTop: 10,
        paddingLeft: 10,
        paddingRight: 10,
        paddingBottom: 10,
        backgroundColor: '#e0f2fe',
        borderColor: '#0891b2',
        borderWidth: 1
    };

    const labels = [
        'Chapter 1: Signal Fire',
        'Chapter 2: Echo Valley',
        'Chapter 3: Lantern Shore',
        'Chapter 4: Ridge of Glass',
        'Chapter 5: Hollow Drum',
        'Chapter 6: Cedar Crossing',
        'Chapter 7: The Quiet Port',
        'Chapter 8: Ember Rain'
    ];

    const elements: Element[] = [];
    labels.forEach((label, index) => {
        elements.push({
            type: 'test-signal-publisher',
            content: `Heading Publisher ${index + 1}\n${label}`,
            properties: {
                sourceId: `collector-publisher-${index + 1}`,
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'collector-entry',
                    payload: { label }
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`Collector proof filler ${index + 1}.`),
            properties: { sourceId: `collector-filler-${index + 1}` }
        });
    });

    elements.push({
        type: 'test-signal-observer',
        content: '',
        properties: {
            sourceId: 'synthetic-collector',
            style: {
                marginTop: 10,
                marginBottom: 12
            },
            _actorSignalObserve: {
                topic: 'collector-entry',
                title: 'Synthetic Collector',
                renderMode: 'collector-list',
                backgroundColor: '#f8fafc',
                borderColor: '#475569',
                color: '#0f172a',
                baseHeight: 96,
                growthPerSignal: 34
            }
        }
    });

    elements.push({
        type: 'p',
        content: longParagraph('Trailing aftermath proof text should be displaced by the collector list and appear after its final fragment.'),
        properties: { sourceId: 'collector-aftermath' }
    });

    const pages = engine.simulate(elements);
    const collectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes.filter((box) => box.type === 'test-signal-observer').map((box) => ({ pageIndex, box }))
    );
    const aftermathBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'p')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
            .filter(({ text }) => /Trailing aftermath proof text/.test(text))
    );

    check(
        'collector renders a TOC-like numbered list from aggregate labels',
        'collector text includes numbered entries from 1 through 8',
        () => {
            assert.ok(collectorBoxes.length > 0, 'expected collector boxes');
            const collectorText = collectorBoxes.map(({ box }) => getBoxText(box)).join('\n');
            assert.match(collectorText, /Synthetic Collector/, 'expected collector title');
            assert.match(collectorText, /1\.\s+Chapter 1: Signal Fire/, 'expected first numbered entry');
            assert.match(collectorText, /8\.\s+Chapter 8: Ember Rain/, 'expected last numbered entry');
        }
    );

    check(
        'collector grows enough to span multiple pages',
        'collector list should produce more than one fragment under aggregate label load',
        () => {
            assert.ok(collectorBoxes.length >= 2, 'expected collector to span multiple fragments');
        }
    );

    check(
        'collector causes spatial consequence for trailing flow',
        'aftermath paragraph should begin after the collector finishes, not before it',
        () => {
            assert.ok(aftermathBoxes.length > 0, 'expected aftermath boxes');
            const firstAftermathPage = aftermathBoxes[0].pageIndex;
            const lastCollectorPage = collectorBoxes[collectorBoxes.length - 1].pageIndex;
            assert.ok(firstAftermathPage >= lastCollectorPage, `expected aftermath to start on or after collector page ${lastCollectorPage}, got ${firstAftermathPage}`);
            if (firstAftermathPage === lastCollectorPage) {
                assert.ok(
                    aftermathBoxes[0].box.y > collectorBoxes[collectorBoxes.length - 1].box.y,
                    'expected aftermath to sit below the collector when sharing a page'
                );
            }
        }
    );
}

async function testInFlowCollectorResettlesFromLaterSignals() {
    logStep('Scenario: in-flow synthetic collector near the front grows from later mature signals and resettles earlier layout');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const publisherStyle = {
        height: 64,
        marginBottom: 10,
        paddingTop: 10,
        paddingLeft: 10,
        paddingRight: 10,
        paddingBottom: 10,
        backgroundColor: '#ede9fe',
        borderColor: '#7c3aed',
        borderWidth: 1
    };

    const labels = [
        'Chapter 1: Signal Fire',
        'Chapter 2: Echo Valley',
        'Chapter 3: Lantern Shore',
        'Chapter 4: Ridge of Glass'
    ];

    const elements: Element[] = [
        {
            type: 'p',
            content: 'This same-page fixture places ordinary flow before the collector so the dirty frontier resolves to an actor checkpoint instead of a page-start checkpoint.',
            properties: { sourceId: 'same-page-intro' }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'inflow-collector',
                style: {
                    marginTop: 8,
                    marginBottom: 10
                },
                _actorSignalObserve: {
                    topic: 'inflow-collector-entry',
                    title: 'In-Flow Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 72,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'p',
            content: longParagraph('Aftermath body should be pushed downward once the collector grows from mature signals discovered later in the run.'),
            properties: { sourceId: 'inflow-aftermath-1' }
        },
        {
            type: 'p',
            content: longParagraph('More aftermath body keeps the early pages occupied so the collector has real downstream consequences.'),
            properties: { sourceId: 'inflow-aftermath-2' }
        },
        {
            type: 'p',
            content: longParagraph('Still more aftermath body extends the early region before the late publishers are encountered.'),
            properties: { sourceId: 'inflow-aftermath-3' }
        }
    ];

    labels.forEach((label, index) => {
        elements.push({
            type: 'test-signal-publisher',
            content: `Heading Publisher ${index + 1}\n${label}`,
            properties: {
                sourceId: `inflow-publisher-${index + 1}`,
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'inflow-collector-entry',
                    signalKey: `inflow-collector-entry:${index + 1}`,
                    payload: { label }
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`Late publisher filler ${index + 1} keeps the collector proof marching across later pages.`),
            properties: { sourceId: `inflow-publisher-filler-${index + 1}` }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`Additional late filler ${index + 1} keeps the publishers meaningfully downstream from the collector.`),
            properties: { sourceId: `inflow-publisher-filler-extra-${index + 1}` }
        });
    });

    const pages = engine.simulate(elements);
    const collectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes.filter((box) => box.type === 'test-signal-observer').map((box) => ({ pageIndex, box }))
    );
    const publisherBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-publisher')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const aftermathBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'p')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
            .filter(({ text }) => /Aftermath body should be pushed downward/.test(text))
    );

    check(
        'collector near the front eventually reflects labels discovered later in the run',
        'collector sits on an early page but renders entries for the later publishers',
        () => {
            assert.ok(collectorBoxes.length > 0, 'expected collector boxes');
            const collectorText = collectorBoxes.map(({ box }) => getBoxText(box)).join('\n');
            assert.ok(
                collectorBoxes[0].pageIndex <= 1,
                `expected collector to begin near the front of the document, got page ${collectorBoxes[0].pageIndex}`
            );
            assert.match(collectorText, /1\.\s+Chapter 1: Signal Fire/, 'expected first late label in collector');
            assert.match(collectorText, /4\.\s+Chapter 4: Ridge of Glass/, 'expected last late label in collector');
        }
    );

    check(
        'publishers remain later in the document than the collector they feed',
        'at least one publisher begins on a later page than the collector start page',
        () => {
            assert.ok(publisherBoxes.length >= labels.length, 'expected publisher boxes');
            const firstPublisherPage = Math.min(...publisherBoxes.map(({ pageIndex }) => pageIndex));
            assert.ok(firstPublisherPage > collectorBoxes[0].pageIndex, `expected first publisher after collector page ${collectorBoxes[0].pageIndex}, got ${firstPublisherPage}`);
        }
    );

    check(
        'resettling gives the collector real spatial consequence near the front',
        'aftermath text begins only after the collector finishes claiming space',
        () => {
            assert.ok(aftermathBoxes.length > 0, 'expected aftermath boxes');
            const lastCollectorPage = collectorBoxes[collectorBoxes.length - 1].pageIndex;
            const firstAftermath = aftermathBoxes[0];
            assert.ok(firstAftermath.pageIndex >= lastCollectorPage, `expected aftermath on or after collector page ${lastCollectorPage}, got ${firstAftermath.pageIndex}`);
            if (firstAftermath.pageIndex === lastCollectorPage) {
                assert.ok(
                    firstAftermath.box.y > collectorBoxes[collectorBoxes.length - 1].box.y,
                    'expected aftermath to sit below the collector when they share a page'
                );
            }
        }
    );
}

async function testSamePageCollectorSettlesAtActorBoundary() {
    logStep('Scenario: same-page collector settles at an actor-boundary checkpoint before any page boundary');
    const base = buildConfig();
    const config: LayoutConfig = {
        ...base,
        layout: {
            ...base.layout,
            pageSize: { width: 320, height: 520 }
        }
    };
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'same-page-collector',
                style: { marginTop: 8, marginBottom: 10 },
                _actorSignalObserve: {
                    topic: 'same-page-entry',
                    title: 'Same-Page Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 56,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early aftermath occupies the same page so the collector must reclaim space before the page boundary.', 8),
            properties: { sourceId: 'same-page-aftermath-1' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Heading Publisher\nSame Page Entry',
            properties: {
                sourceId: 'same-page-publisher',
                style: {
                    height: 64,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    borderWidth: 1,
                    color: '#1e3a8a',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'same-page-entry',
                    signalKey: 'same-page-entry:1',
                    payload: { label: 'Same Page Entry' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Late aftermath should still live on the first page after the actor-boundary settle happens.', 6),
            properties: { sourceId: 'same-page-aftermath-2' }
        }
    ];

    const pages = engine.simulate(elements);
    const snapshot = engine.getLastPrintPipelineSnapshot();
    const profile = snapshot.report?.profile;
    const collectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const publisherBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-publisher')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );

    check(
        'same-page publisher feeds the collector before any page boundary is crossed',
        'collector and publisher both remain on the first page while collector still reflects the later label',
        () => {
            assert.ok(collectorBoxes.length > 0, 'expected collector boxes');
            assert.ok(publisherBoxes.length > 0, 'expected publisher box');
            assert.equal(collectorBoxes[0].pageIndex, 0, 'expected collector on page 0');
            assert.equal(publisherBoxes[0].pageIndex, 0, 'expected publisher on page 0');
            const collectorText = collectorBoxes.map(({ text }) => text).join('\n');
            assert.match(collectorText, /1\.\s+Same Page Entry/, 'expected same-page label in collector');
        }
    );

    check(
        'same-page resettling happens before the publisher ever forces a page turn',
        'profile records a settle in the same-page scenario, proving the collector updated intra-page rather than waiting until EOF',
        () => {
            assert.ok(profile, 'expected a simulation profile');
            assert.ok(profile.observerSettleCalls > 0, 'expected at least one settle in the same-page scenario');
        }
    );
}

async function testContentOnlyObserverWakeAvoidsResettlement() {
    logStep('Scenario: topic-scoped awakened observer reports content-only change without triggering resettlement');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'content-only-observer',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'content-only-entry',
                    title: 'Content-Only Observer',
                    backgroundColor: '#ecfccb',
                    borderColor: '#65a30d',
                    color: '#365314',
                    baseHeight: 72,
                    growthPerSignal: 0
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'content-only-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Content-Only Marker',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 52
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early committed content gives the observer and marker a stable page presence before the later publisher fires.', 8),
            properties: { sourceId: 'content-only-early-filler' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Content-Only Publisher\nQuiet Update',
            properties: {
                sourceId: 'content-only-publisher',
                style: {
                    height: 68,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    borderWidth: 2,
                    color: '#1e3a8a',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'content-only-entry',
                    signalKey: 'content-only-entry:1',
                    payload: { label: 'Quiet Update' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Bridge content keeps the observer later in normal document order while preserving a same-pass content-only proof.', 8),
            properties: { sourceId: 'content-only-bridge' }
        }
    ];

    const pages = engine.simulate(elements);
    const snapshot = engine.getLastPrintPipelineSnapshot();
    const profile = snapshot.report?.profile;
    const observerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const markerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-replay-marker')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );

    check(
        'content-only observer redraws in place after the later publisher',
        'observer and marker appear early, and the observer later shows the committed label without changing its geometry',
        () => {
            assert.ok(observerBoxes.length > 0, 'expected content-only observer box');
            assert.ok(markerBoxes.length > 0, 'expected content-only marker box');
            const observerText = observerBoxes.map(({ text }) => text).join('\n');
            assert.match(observerText, /Content-Only Observer/, 'expected observer title');
            assert.match(observerText, /Quiet Update/, 'expected redrawn observer label');
            const heights = new Set(
                observerBoxes.map(({ box }) => Number(box.h || box.height || box.properties?._observedSignalHeight || 0).toFixed(3))
            );
            assert.equal(heights.size, 1, 'expected fixed geometry across content-only observer fragments');
        }
    );

    check(
        'content-only observer wakes without resettlement',
        'profile records signal awakening and content-only updates while the committed replay marker stays at render count 1 and settle count stays at zero',
        () => {
            assert.ok(profile, 'expected simulation profile');
            assert.ok(profile.actorActivationSignalWakeCalls > 0, 'expected at least one signal wake');
            assert.ok(profile.actorUpdateContentOnlyCalls > 0, 'expected at least one content-only update');
            assert.equal(profile.actorUpdateGeometryCalls, 0, 'expected no geometry updates');
            assert.ok(profile.actorUpdateRedrawCalls > 0, 'expected at least one redraw-in-place');
            assert.equal(profile.observerSettleCalls, 0, 'expected no resettlement for content-only update');
            const markerText = markerBoxes.map(({ text }) => text).join('\n');
            assert.match(markerText, /Render Count:\s*1/, 'expected marker to remain at render count 1');
        }
    );
}

async function testGeometryObserverWakeTriggersBoundedResettlement() {
    logStep('Scenario: topic-scoped awakened observer reports geometry change, settles from its checkpoint, and replays only downstream actors');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'geometry-prelude-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Geometry Prelude',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 52
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'geometry-observer',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'geometry-entry',
                    title: 'Geometry Observer',
                    renderMode: 'collector-list',
                    backgroundColor: '#fef3c7',
                    borderColor: '#d97706',
                    color: '#92400e',
                    baseHeight: 64,
                    growthPerSignal: 34
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'geometry-downstream-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Geometry Downstream',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 52
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early body keeps the observer and downstream marker committed before a later publisher finalizes the mature world fact.', 10),
            properties: { sourceId: 'geometry-early-filler-1' }
        },
        {
            type: 'p',
            content: repeatedParagraph('Additional body ensures the later publisher lands after the committed observer checkpoint rather than immediately adjacent to it.', 10),
            properties: { sourceId: 'geometry-early-filler-2' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Geometry Publisher\nWake the observer',
            properties: {
                sourceId: 'geometry-publisher',
                style: {
                    height: 68,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    backgroundColor: '#dcfce7',
                    borderColor: '#16a34a',
                    borderWidth: 2,
                    color: '#166534',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'geometry-entry',
                    signalKey: 'geometry-entry:1',
                    payload: { label: 'Wake the observer' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Late aftermath shows the forward march resumed after the reactive geometry settle completed.', 7),
            properties: { sourceId: 'geometry-late-aftermath' }
        }
    ];

    const pages = engine.simulate(elements);
    const snapshot = engine.getLastPrintPipelineSnapshot();
    const profile = snapshot.report?.profile;
    const observerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const markerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-replay-marker')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const preludeBoxes = markerBoxes.filter(({ text }) => /Geometry Prelude/.test(text));
    const downstreamBoxes = markerBoxes.filter(({ text }) => /Geometry Downstream/.test(text));

    check(
        'geometry observer grows after the later publisher matures',
        'observer renders the late label and claims more vertical space than its dormant baseline',
        () => {
            assert.ok(observerBoxes.length > 0, 'expected geometry observer boxes');
            const observerText = observerBoxes.map(({ text }) => text).join('\n');
            assert.match(observerText, /Geometry Observer/, 'expected observer title');
            assert.match(observerText, /1\.\s+Wake the observer/, 'expected committed label in observer text');
            const firstHeight = Number(observerBoxes[0].box.h || observerBoxes[0].box.height || 0);
            assert.ok(firstHeight > 64, `expected observer height to grow beyond baseline 64, got ${firstHeight}`);
        }
    );

    check(
        'geometry settle preserves upstream actors while replaying downstream actors',
        'prelude marker remains at render count 1 while the downstream marker renders again after one or more resettlement cycles',
        () => {
            assert.ok(preludeBoxes.length > 0, 'expected geometry prelude marker');
            assert.ok(downstreamBoxes.length > 0, 'expected geometry downstream marker');
            const preludeText = preludeBoxes.map(({ text }) => text).join('\n');
            const downstreamText = downstreamBoxes.map(({ text }) => text).join('\n');
            assert.match(preludeText, /Render Count:\s*1/, 'expected upstream marker to remain at render count 1');
            const downstreamRenderCounts = Array.from(
                downstreamText.matchAll(/Render Count:\s*(\d+)/g),
                (match) => Number(match[1])
            );
            assert.ok(downstreamRenderCounts.length > 0, 'expected downstream render count markers');
            assert.ok(
                downstreamRenderCounts.some((count) => count > 1),
                `expected downstream marker to replay after settle, got counts: ${downstreamRenderCounts.join(', ')}`
            );
            assert.ok(preludeBoxes[0].box.y < observerBoxes[0].box.y, 'expected prelude marker above observer');
            const firstObserver = observerBoxes[0];
            const firstDownstream = downstreamBoxes[0];
            assert.ok(
                firstDownstream.pageIndex > firstObserver.pageIndex
                || (firstDownstream.pageIndex === firstObserver.pageIndex && firstDownstream.box.y > firstObserver.box.y),
                `expected downstream marker after observer in document order, got observer p${firstObserver.pageIndex}@${firstObserver.box.y} and downstream p${firstDownstream.pageIndex}@${firstDownstream.box.y}`
            );
        }
    );

    check(
        'geometry wake routes through bounded resettlement rather than redraw-in-place',
        'profile records geometry updates and resettlement cycles while content-only redraw stays unused for this case',
        () => {
            assert.ok(profile, 'expected simulation profile');
            assert.ok(profile.actorActivationSignalWakeCalls > 0, 'expected at least one signal wake');
            assert.ok(profile.actorUpdateGeometryCalls > 0, 'expected at least one geometry update');
            assert.ok(profile.actorUpdateResettlementCycles > 0, 'expected at least one resettlement cycle');
            assert.ok(profile.observerSettleCalls > 0, 'expected at least one settle');
            assert.equal(profile.actorUpdateRedrawCalls, 0, 'expected no content-only redraw for geometry update');
        }
    );
}

async function testReactiveGeometryOscillationFailsDeterministically() {
    logStep('Scenario: unchanged reactive geometry oscillation fails deterministically instead of silently churning');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'oscillation-observer',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'oscillation-entry',
                    title: 'Oscillation Probe',
                    renderMode: 'collector-list',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    baseHeight: 60,
                    growthPerSignal: 0,
                    oscillateHeights: [96, 132]
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'oscillation-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Oscillation Marker',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 52
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('The oscillation proof keeps enough committed downstream flow in place that the reactive actor can keep attempting geometry settles on unchanged facts.', 12),
            properties: { sourceId: 'oscillation-filler-1' }
        },
        {
            type: 'p',
            content: repeatedParagraph('More committed flow keeps the observer frontier meaningful and makes any silent churn immediately suspicious.', 10),
            properties: { sourceId: 'oscillation-filler-2' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Oscillation Publisher\nFrozen fact',
            properties: {
                sourceId: 'oscillation-publisher',
                style: {
                    height: 68,
                    marginBottom: 10,
                    paddingTop: 10,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    backgroundColor: '#ecfccb',
                    borderColor: '#65a30d',
                    borderWidth: 2,
                    color: '#365314',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'oscillation-entry',
                    signalKey: 'oscillation-entry:1',
                    payload: { label: 'Frozen fact' }
                }
            }
        }
    ];

    check(
        'unchanged reactive oscillation is stopped deterministically',
        'simulate() throws a clear oscillation error instead of silently looping',
        () => {
            assert.throws(
                () => engine.simulate(elements),
                /Reactive geometry (oscillation detected|resettlement exceeded the cycle cap)/
            );
        }
    );
}

async function testAnchoredCheckpointAvoidsReplayingLockedPrelude() {
    logStep('Scenario: anchored checkpoint restore avoids replaying a locked prelude actor before the collector frontier');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'locked-prelude-marker',
                style: { marginTop: 6, marginBottom: 8 },
                _testReplayMarker: {
                    title: 'Locked Prelude',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 56
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'locked-prelude-collector',
                style: { marginTop: 8, marginBottom: 8 },
                _actorSignalObserve: {
                    topic: 'locked-prelude-entry',
                    title: 'Precision Collector',
                    renderMode: 'collector-list',
                    backgroundColor: '#f8fafc',
                    borderColor: '#475569',
                    color: '#0f172a',
                    baseHeight: 54,
                    growthPerSignal: 28
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Early aftermath should remain below the collector while the locked prelude stays untouched if restore precision is correct.', 7),
            properties: { sourceId: 'locked-prelude-aftermath-1' }
        },
        {
            type: 'test-signal-publisher',
            content: 'Heading Publisher\nAnchored Entry',
            properties: {
                sourceId: 'locked-prelude-publisher',
                style: {
                    height: 64,
                    marginBottom: 8,
                    paddingTop: 10,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingBottom: 10,
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    borderWidth: 2,
                    color: '#1e3a8a',
                    fontWeight: 700
                },
                _actorSignalPublish: {
                    topic: 'locked-prelude-entry',
                    signalKey: 'locked-prelude-entry:1',
                    payload: { label: 'Anchored Entry' }
                }
            }
        },
        {
            type: 'p',
            content: repeatedParagraph('Late aftermath proves the world resumed after the collector learned the later mature signal.', 5),
            properties: { sourceId: 'locked-prelude-aftermath-2' }
        }
    ];

    const pages = engine.simulate(elements);
    const snapshot = engine.getLastPrintPipelineSnapshot();
    const profile = snapshot.report?.profile;
    const markerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-replay-marker')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const collectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );

    check(
        'locked prelude marker is not replayed when settling from a later frontier',
        'marker should still show a single committed render after the collector settles',
        () => {
            assert.ok(markerBoxes.length > 0, 'expected locked prelude marker');
            const markerText = markerBoxes.map(({ text }) => text).join('\n');
            assert.match(markerText, /Locked Prelude/, 'expected locked prelude title');
            assert.match(markerText, /Render Count:\s*1/, 'expected marker to remain at render count 1');
        }
    );

    check(
        'collector still learns the later mature signal',
        'collector includes the anchored entry while staying after the locked prelude marker',
        () => {
            assert.ok(collectorBoxes.length > 0, 'expected collector boxes');
            const collectorText = collectorBoxes.map(({ text }) => text).join('\n');
            assert.match(collectorText, /1\.\s+Anchored Entry/, 'expected collector to include the later entry');
            assert.ok(markerBoxes[0].box.y < collectorBoxes[0].box.y, 'expected marker above collector');
        }
    );

    check(
        'anchored restore path still performs a settle',
        'profile records at least one observer settle while preserving the locked prelude marker',
        () => {
            assert.ok(profile, 'expected simulation profile');
            assert.ok(profile.observerSettleCalls > 0, 'expected at least one settle');
        }
    );
}

async function testDualInFlowCollectorsResettleFromInterleavedSignals() {
    logStep('Scenario: two in-flow collectors near the front resettle from interleaved later signals');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const collectors = [
        {
            topic: 'inflow-collector-alpha-entry',
            sourceId: 'dual-inflow-collector-alpha',
            title: 'In-Flow Collector Alpha',
            firstLabel: 'Alpha 1: Signal Fire',
            lastLabel: 'Alpha 3: Ridge Walk',
            backgroundColor: '#eff6ff',
            borderColor: '#2563eb',
            color: '#1e3a8a'
        },
        {
            topic: 'inflow-collector-beta-entry',
            sourceId: 'dual-inflow-collector-beta',
            title: 'In-Flow Collector Beta',
            firstLabel: 'Beta 1: Echo Vale',
            lastLabel: 'Beta 3: Quiet Port',
            backgroundColor: '#fefce8',
            borderColor: '#ca8a04',
            color: '#854d0e'
        }
    ];

    const publisherStyle = {
        height: 64,
        marginBottom: 10,
        paddingTop: 10,
        paddingLeft: 10,
        paddingRight: 10,
        paddingBottom: 10,
        borderWidth: 1
    };

    const elements: Element[] = [
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: collectors[0].sourceId,
                style: { marginTop: 8, marginBottom: 10 },
                _actorSignalObserve: {
                    topic: collectors[0].topic,
                    title: collectors[0].title,
                    renderMode: 'collector-list',
                    backgroundColor: collectors[0].backgroundColor,
                    borderColor: collectors[0].borderColor,
                    color: collectors[0].color,
                    baseHeight: 60,
                    growthPerSignal: 22
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: collectors[1].sourceId,
                style: { marginTop: 8, marginBottom: 10 },
                _actorSignalObserve: {
                    topic: collectors[1].topic,
                    title: collectors[1].title,
                    renderMode: 'collector-list',
                    backgroundColor: collectors[1].backgroundColor,
                    borderColor: collectors[1].borderColor,
                    color: collectors[1].color,
                    baseHeight: 60,
                    growthPerSignal: 22
                }
            }
        },
        {
            type: 'p',
            content: longParagraph('Shared early aftermath keeps the first region occupied so both collectors must claim real space when later signals mature.'),
            properties: { sourceId: 'dual-inflow-aftermath-1' }
        },
        {
            type: 'p',
            content: longParagraph('Additional early aftermath extends the downstream region so dual collector settling becomes visible in ordinary flow.'),
            properties: { sourceId: 'dual-inflow-aftermath-2' }
        },
        {
            type: 'p',
            content: longParagraph('Still more early aftermath keeps the front pages meaningfully occupied before later publishers are encountered.'),
            properties: { sourceId: 'dual-inflow-aftermath-3' }
        }
    ];

    const interleavedPublishers = [
        {
            sourceId: 'dual-alpha-1',
            topic: collectors[0].topic,
            signalKey: 'dual-alpha-1',
            label: collectors[0].firstLabel,
            backgroundColor: '#dbeafe',
            borderColor: '#2563eb',
            color: '#1e3a8a'
        },
        {
            sourceId: 'dual-beta-1',
            topic: collectors[1].topic,
            signalKey: 'dual-beta-1',
            label: collectors[1].firstLabel,
            backgroundColor: '#fef3c7',
            borderColor: '#d97706',
            color: '#92400e'
        },
        {
            sourceId: 'dual-alpha-2',
            topic: collectors[0].topic,
            signalKey: 'dual-alpha-2',
            label: 'Alpha 2: Lantern Shore',
            backgroundColor: '#dbeafe',
            borderColor: '#2563eb',
            color: '#1e3a8a'
        },
        {
            sourceId: 'dual-beta-2',
            topic: collectors[1].topic,
            signalKey: 'dual-beta-2',
            label: 'Beta 2: Hollow Drum',
            backgroundColor: '#fef3c7',
            borderColor: '#d97706',
            color: '#92400e'
        },
        {
            sourceId: 'dual-alpha-3',
            topic: collectors[0].topic,
            signalKey: 'dual-alpha-3',
            label: collectors[0].lastLabel,
            backgroundColor: '#dbeafe',
            borderColor: '#2563eb',
            color: '#1e3a8a'
        },
        {
            sourceId: 'dual-beta-3',
            topic: collectors[1].topic,
            signalKey: 'dual-beta-3',
            label: collectors[1].lastLabel,
            backgroundColor: '#fef3c7',
            borderColor: '#d97706',
            color: '#92400e'
        }
    ];

    interleavedPublishers.forEach((publisher, index) => {
        elements.push({
            type: 'test-signal-publisher',
            content: `Heading Publisher\n${publisher.label}`,
            properties: {
                sourceId: publisher.sourceId,
                style: {
                    ...publisherStyle,
                    backgroundColor: publisher.backgroundColor,
                    borderColor: publisher.borderColor,
                    color: publisher.color
                },
                _actorSignalPublish: {
                    topic: publisher.topic,
                    signalKey: publisher.signalKey,
                    payload: { label: publisher.label }
                }
            }
        });
        elements.push({
            type: 'p',
            content: longParagraph(`${publisher.label} filler keeps later publishers interleaved so both collectors receive mature traffic at different moments.`),
            properties: { sourceId: `dual-interleaved-filler-${index + 1}` }
        });
    });

    elements.push({
        type: 'p',
        content: longParagraph('Late aftermath proves both collector invalidations have settled and the forward march resumed normally.'),
        properties: { sourceId: 'dual-inflow-late-aftermath' }
    });

    const pages = engine.simulate(elements);
    const alphaCollectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
            .filter(({ text }) => /Dual Collector Alpha|Alpha 1: Signal Fire|Alpha 2: Lantern Shore|Alpha 3: Ridge Walk/.test(text))
    );
    const betaCollectorBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
            .filter(({ text }) => /Dual Collector Beta|Beta 1: Echo Vale|Beta 2: Hollow Drum|Beta 3: Quiet Port/.test(text))
    );
    const publisherBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-publisher')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
    );
    const lateAftermathBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'p')
            .map((box) => ({ pageIndex, box, text: getBoxText(box) }))
            .filter(({ text }) => /Late aftermath proves both collector invalidations/.test(text))
    );

    check(
        'both collectors near the front eventually reflect later interleaved labels',
        'each collector begins early but renders only the labels from its own topic',
        () => {
            assert.ok(alphaCollectorBoxes.length > 0, 'expected alpha collector boxes');
            assert.ok(betaCollectorBoxes.length > 0, 'expected beta collector boxes');
            const alphaText = alphaCollectorBoxes.map(({ text }) => text).join('\n');
            const betaText = betaCollectorBoxes.map(({ text }) => text).join('\n');
            assert.equal(alphaCollectorBoxes[0].pageIndex, 0, 'expected alpha collector to begin on page 0');
            assert.ok(betaCollectorBoxes[0].pageIndex <= 1, `expected beta collector near the front, got page ${betaCollectorBoxes[0].pageIndex}`);
            assert.match(alphaText, /1\.\s+Alpha 1: Signal Fire/, 'expected first alpha label');
            assert.match(alphaText, /3\.\s+Alpha 3: Ridge Walk/, 'expected last alpha label');
            assert.doesNotMatch(alphaText, /Beta 1: Echo Vale/, 'alpha collector should not ingest beta labels');
            assert.match(betaText, /1\.\s+Beta 1: Echo Vale/, 'expected first beta label');
            assert.match(betaText, /3\.\s+Beta 3: Quiet Port/, 'expected last beta label');
            assert.doesNotMatch(betaText, /Alpha 1: Signal Fire/, 'beta collector should not ingest alpha labels');
        }
    );

    check(
        'later publishers still begin after the early collectors',
        'at least one interleaved publisher starts on a later page than both collector starts',
        () => {
            assert.ok(publisherBoxes.length >= interleavedPublishers.length, 'expected all later publishers');
            const firstPublisherPage = Math.min(...publisherBoxes.map(({ pageIndex }) => pageIndex));
            const earliestCollectorPage = Math.min(alphaCollectorBoxes[0].pageIndex, betaCollectorBoxes[0].pageIndex);
            assert.ok(firstPublisherPage > earliestCollectorPage, `expected first publisher after early collectors, got publisher page ${firstPublisherPage}`);
        }
    );

    check(
        'dual collector settling gives both observers real downstream spatial consequence',
        'late aftermath begins only after the later of the two collectors has finished claiming space',
        () => {
            assert.ok(lateAftermathBoxes.length > 0, 'expected late aftermath');
            const alphaLastPage = alphaCollectorBoxes[alphaCollectorBoxes.length - 1].pageIndex;
            const betaLastPage = betaCollectorBoxes[betaCollectorBoxes.length - 1].pageIndex;
            const lastCollectorPage = Math.max(alphaLastPage, betaLastPage);
            const firstLateAftermath = lateAftermathBoxes[0];
            assert.ok(firstLateAftermath.pageIndex >= lastCollectorPage, `expected late aftermath on or after collector page ${lastCollectorPage}, got ${firstLateAftermath.pageIndex}`);
        }
    );
}

async function testActorBulletinBoardAcrossPages() {
    logStep('Scenario: many publishers route normalized signals into one observer that changes geometry');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const publisherStyle = {
        height: 150,
        marginBottom: 12,
        paddingTop: 12,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 12,
        backgroundColor: '#dbeafe',
        borderColor: '#2563eb',
        borderWidth: 1
    };

    const elements: Element[] = [
        {
            type: 'test-signal-publisher',
            content: 'Publisher Alpha',
            properties: {
                sourceId: 'pub-alpha',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Alpha' }
                }
            }
        },
        {
            type: 'test-signal-publisher',
            content: 'Publisher Beta',
            properties: {
                sourceId: 'pub-beta',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Beta' }
                }
            }
        },
        {
            type: 'test-signal-publisher',
            content: 'Publisher Gamma',
            properties: {
                sourceId: 'pub-gamma',
                style: publisherStyle,
                _actorSignalPublish: {
                    topic: 'probe-heading',
                    payload: { label: 'Gamma' }
                }
            }
        },
        {
            type: 'test-signal-observer',
            content: '',
            properties: {
                sourceId: 'observer-main',
                style: {
                    marginTop: 8,
                    marginBottom: 8
                },
                _actorSignalObserve: {
                    topic: 'probe-heading',
                    title: 'Observed Publishers',
                    backgroundColor: '#fde68a',
                    borderColor: '#b45309',
                    baseHeight: 80,
                    growthPerSignal: 36
                }
            }
        }
    ];

    const pages = engine.simulate(elements);
    const publisherPages = new Set<number>();
    const publisherBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes.filter((box) => box.type === 'test-signal-publisher').map((box) => {
            publisherPages.add(pageIndex);
            return box;
        })
    );
    const observerBoxes = pages.flatMap((page, pageIndex) =>
        page.boxes
            .filter((box) => box.type === 'test-signal-observer')
            .map((box) => ({ pageIndex, box }))
    );

    check(
        'publisher actor spans multiple pages of the world',
        'publisher boxes land on at least two different pages before the observer reads them',
        () => {
            assert.ok(publisherBoxes.length >= 3, 'expected three publisher boxes');
            assert.ok(publisherPages.size >= 2, 'expected publishers to span multiple pages');
        }
    );

    check(
        'observer actor receives committed signals from earlier pages',
        'observer box shows three observed signals and lands on a later page',
        () => {
            assert.ok(observerBoxes.length > 0, 'expected at least one observer box');
            const observer = observerBoxes[0];
            assert.ok(observer.pageIndex >= 2, `expected observer on a later page, got ${observer.pageIndex}`);
            const combinedText = observerBoxes.map(({ box }) => getBoxText(box)).join('\n');
            assert.match(combinedText, /Count:\s*3/, 'observer text should include the observed count');
            assert.match(combinedText, /Pages:\s*1,\s*2,\s*3/, 'observer text should include source page labels');
        }
    );

    check(
        'observer actor changes its own geometry from the aggregate signal count',
        'observer footprint expands into multiple fragments under aggregate signal load',
        () => {
            assert.ok(observerBoxes.length >= 2, 'expected observer to span more than one fragment');
        }
    );
}

async function testActorEventBusRollback() {
    logStep('Scenario: actor bulletin board rolls back speculative signals with discarded timelines');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();
    const session = new LayoutSession({ runtime: engine.getRuntime() });
    session.notifySimulationStart();

    const snapshot = session.captureLocalActorSignalSnapshot();

    session.publishActorSignal({
        topic: 'probe-heading',
        publisherActorId: 'actor:speculative',
        publisherSourceId: 'source:speculative',
        publisherActorKind: 'test-signal-publisher',
        fragmentIndex: 0,
        pageIndex: 4,
        payload: { label: 'Speculative' }
    });

    check(
        'speculative signal exists before rollback',
        'one signal is visible in the current speculative timeline',
        () => {
            assert.equal(session.getActorSignals('probe-heading').length, 1);
        }
    );

    session.restoreLocalActorSignalSnapshot(snapshot);

    check(
        'rollback destroys speculative actor signals',
        'no committed observer can see the discarded branch signal',
        () => {
            assert.equal(session.getActorSignals('probe-heading').length, 0);
        }
    );
}

async function testSimulationClockRollback() {
    logStep('Scenario: speculative branch rollback restores the prior simulation tick exactly');
    const runtime = createEngineRuntime({ fontManager: new (await loadLocalFontManager())() });
    const session = new LayoutSession({ runtime });
    session.notifySimulationStart();

    check(
        'clock starts at tick zero',
        'a fresh session has not advanced simulation time yet',
        () => {
            assert.equal(session.getSimulationTick(), 0);
        }
    );

    session.advanceSimulationTick();

    check(
        'clock can advance before speculation begins',
        'one explicit advancement moves the session to tick 1',
        () => {
            assert.equal(session.getSimulationTick(), 1);
        }
    );

    session.executeSpeculativeBranch({
        reason: 'other',
        pageBoxes: [],
        actorQueue: [],
        currentY: 0,
        lastSpacingAfter: 0,
        currentPageIndex: 0,
        run: () => {
            session.advanceSimulationTick();
            session.advanceSimulationTick();
            assert.equal(session.getSimulationTick(), 3, 'speculative branch should see its own later tick');
            return { accept: false };
        }
    });

    check(
        'rollback restores the prior tick',
        'discarding the speculative branch returns the session to tick 1 instead of keeping tick 3',
        () => {
            assert.equal(session.getSimulationTick(), 1);
        }
    );
}

async function testCommittedSignalsCarryTick() {
    logStep('Scenario: committed signals carry tick and keyed replacements refresh temporal position without changing identity sequence');
    const runtime = createEngineRuntime({ fontManager: new (await loadLocalFontManager())() });
    const session = new LayoutSession({ runtime });
    session.notifySimulationStart();

    session.advanceSimulationTick();
    const first = session.publishActorSignal({
        topic: 'probe-heading',
        publisherActorId: 'actor:first',
        publisherSourceId: 'source:first',
        publisherActorKind: 'test-signal-publisher',
        fragmentIndex: 0,
        pageIndex: 0,
        signalKey: 'probe:stable',
        payload: { label: 'Tick One' }
    });

    check(
        'first committed signal is stamped with the current tick',
        'publishing at simulation tick 1 produces a signal whose tick is also 1',
        () => {
            assert.equal(first.tick, 1);
            assert.equal(first.sequence, 1);
        }
    );

    session.advanceSimulationTick();
    session.advanceSimulationTick();
    const replacement = session.publishActorSignal({
        topic: 'probe-heading',
        publisherActorId: 'actor:first',
        publisherSourceId: 'source:first',
        publisherActorKind: 'test-signal-publisher',
        fragmentIndex: 0,
        pageIndex: 0,
        signalKey: 'probe:stable',
        payload: { label: 'Tick Three' }
    });

    check(
        'keyed replacement keeps sequence identity but refreshes tick',
        'the stable signal keeps sequence 1 while reflecting the newer committed tick 3',
        () => {
            assert.equal(replacement.sequence, 1);
            assert.equal(replacement.tick, 3);
            const signals = session.getActorSignals('probe-heading');
            assert.equal(signals.length, 1);
            assert.equal(signals[0].sequence, 1);
            assert.equal(signals[0].tick, 3);
            assert.deepEqual(signals[0].payload, { label: 'Tick Three' });
        }
    );
}

async function testDeliberateProgressionCookingProof() {
    logStep('Scenario: a synthetic cooking actor advances one deliberate stage per outer simulation tick before final capture');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
    engine.setPackagerFactory(experimentFactory);
    await engine.waitForFonts();

    const elements: Element[] = [
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'cooking-upstream-marker',
                _testReplayMarker: {
                    title: 'Upstream Marker\nMust stay at Render Count: 1',
                    backgroundColor: '#fee2e2',
                    borderColor: '#dc2626',
                    color: '#7f1d1d',
                    height: 60
                }
            }
        },
        {
            type: 'test-clock-cooking',
            content: '',
            properties: {
                sourceId: 'cooking-actor',
                style: {
                    marginTop: 8,
                    marginBottom: 8
                },
                _clockCooking: {
                    title: 'Document Cooker',
                    emptyLabel: 'Waiting for pagination to settle the first time.',
                    backgroundColor: '#ecfccb',
                    borderColor: '#65a30d',
                    color: '#365314',
                    baseHeight: 76,
                    growthPerStage: 26,
                    maxStages: 2
                }
            }
        },
        {
            type: 'test-replay-marker',
            content: '',
            properties: {
                sourceId: 'cooking-downstream-marker',
                _testReplayMarker: {
                    title: 'Downstream Marker\nShould replay while the cooker grows',
                    backgroundColor: '#dbeafe',
                    borderColor: '#2563eb',
                    color: '#1e3a8a',
                    height: 60
                }
            }
        },
        { type: 'p', content: longParagraph('Cooking proof filler one keeps the document long enough for repeated capture-and-resettle cycles.') },
        { type: 'p', content: longParagraph('Cooking proof filler two preserves a real downstream region while the synthetic cooker accumulates visible stages.') },
        { type: 'p', content: longParagraph('Cooking proof filler three ensures pagination finalization remains a meaningful world fact rather than a trivial single-page event.') }
    ];

    const pages = engine.simulate(elements);
    const cookerBoxes = pages.flatMap((page) =>
        page.boxes
            .filter((box) => box.type === 'test-clock-cooking')
            .map((box) => ({ text: getBoxText(box) }))
    );
    const replayBoxes = pages.flatMap((page) =>
        page.boxes
            .filter((box) => box.type === 'test-replay-marker')
            .map((box) => ({ text: getBoxText(box) }))
    );
    const report = engine.getLastSimulationReportReader();

    check(
        'cooking actor accumulates more than one deliberate stage before capture',
        'final rendered text shows a two-stage trail tied to successive committed ticks',
        () => {
            assert.ok(cookerBoxes.length > 0, 'expected a cooking actor box');
            const combinedText = cookerBoxes.map(({ text }) => text).join('\n');
            assert.match(combinedText, /Document Cooker/, 'expected cooker title');
            assert.match(combinedText, /State:\s+settled/, 'expected cooker to finish in settled state');
            assert.match(combinedText, /Stages:\s+2\s*\/\s*2/, 'expected two completed stages');
            assert.match(combinedText, /1\.\s+tick 2/, 'expected first cooking stage at tick 2 after the initial commit pass');
            assert.match(combinedText, /2\.\s+tick 3/, 'expected second cooking stage at tick 3 after the next simulation step');
        }
    );

    check(
        'the final capture reports the later settled world tick',
        'progression finalTick reflects the captured world slice while the profile still records cumulative replay work',
        () => {
            assert.equal(report.progression?.policy, 'until-settled');
            assert.equal(report.progression?.stopReason, 'settled');
            assert.equal(report.progression?.finalTick, 3);
            assert.equal(report.progression?.progressionStopped, true);
            assert.ok(Number(report.profile?.simulationTickCount ?? 0) >= Number(report.progression?.finalTick ?? 0));
        }
    );

    check(
        'geometry cooking has real downstream spatial consequence',
        'upstream replay marker stays at 1 while the downstream marker replays across the cooking stages',
        () => {
            const combinedText = replayBoxes.map(({ text }) => text).join('\n');
            assert.match(combinedText, /Upstream Marker[\s\S]*Render Count:\s*1/, 'expected upstream marker to remain untouched');
            const downstreamMatch = combinedText.match(/Downstream Marker[\s\S]*?Render Count:\s*(\d+)/);
            assert.ok(downstreamMatch, 'expected downstream replay marker text');
            assert.ok(Number(downstreamMatch[1]) >= 3, `expected downstream marker to replay at least three times, got ${downstreamMatch?.[1]}`);
        }
    );
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    await testActorBulletinBoardAcrossPages();
    await testLabeledHeadingPublishersDriveObserverGeometry();
    await testObserverSummaryDrivesFollowerLayout();
    await testSyntheticCollectorListDrivesTrailingFlow();
    await testInFlowCollectorResettlesFromLaterSignals();
    await testContentOnlyObserverWakeAvoidsResettlement();
    await testGeometryObserverWakeTriggersBoundedResettlement();
    await testReactiveGeometryOscillationFailsDeterministically();
    await testSamePageCollectorSettlesAtActorBoundary();
    await testAnchoredCheckpointAvoidsReplayingLockedPrelude();
    await testDualInFlowCollectorsResettleFromInterleavedSignals();
    await testActorEventBusRollback();
    await testSimulationClockRollback();
    await testCommittedSignalsCarryTick();
    await testDeliberateProgressionCookingProof();
    console.log('[actor-communication.spec] OK');
}

run().catch((err) => {
    console.error('[actor-communication.spec] FAILED', err);
    process.exit(1);
});
