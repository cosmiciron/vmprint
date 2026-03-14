import assert from 'node:assert/strict';
import { LayoutEngine } from '../src/engine/layout-engine';
import { LayoutSession } from '../src/engine/layout/layout-session';
import { Element, LayoutConfig } from '../src/engine/types';
import { createEngineRuntime, setDefaultEngineRuntime } from '../src/engine/runtime';
import { loadLocalFontManager } from './harness/engine-harness';

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

    const pages = engine.paginate(elements);
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

    const pages = engine.paginate(elements);
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

async function testActorBulletinBoardAcrossPages() {
    logStep('Scenario: many publishers route normalized signals into one observer that changes geometry');
    const config = buildConfig();
    const engine = new LayoutEngine(config);
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

    const pages = engine.paginate(elements);
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
    await engine.waitForFonts();
    const session = new LayoutSession({ runtime: engine.getRuntime() });
    session.notifySimulationStart();

    const pageBoxes: any[] = [];
    const actorQueue: any[] = [];
    const snapshot = session.captureLocalBranchSnapshot(pageBoxes, actorQueue, 0, 0);

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

    session.restoreLocalBranchSnapshot(pageBoxes, actorQueue, snapshot);

    check(
        'rollback destroys speculative actor signals',
        'no committed observer can see the discarded branch signal',
        () => {
            assert.equal(session.getActorSignals('probe-heading').length, 0);
        }
    );
}

async function run() {
    const LocalFontManager = await loadLocalFontManager();
    setDefaultEngineRuntime(createEngineRuntime({ fontManager: new LocalFontManager() }));

    await testActorBulletinBoardAcrossPages();
    await testLabeledHeadingPublishersDriveObserverGeometry();
    await testObserverSummaryDrivesFollowerLayout();
    await testActorEventBusRollback();
    console.log('[actor-communication.spec] OK');
}

run().catch((err) => {
    console.error('[actor-communication.spec] FAILED', err);
    process.exit(1);
});
