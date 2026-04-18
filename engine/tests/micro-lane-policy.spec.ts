import assert from 'node:assert/strict';

import {
    resolveDocumentMicroLanePolicy,
    resolveMinUsableLaneWidth
} from '../src/engine/layout/micro-lane-policy';

function run(): void {
    assert.equal(resolveDocumentMicroLanePolicy(undefined), 'balanced', 'default policy should resolve to balanced');
    assert.equal(resolveDocumentMicroLanePolicy({ microLanePolicy: 'allow' } as any), 'allow', 'allow should round-trip');
    assert.equal(resolveDocumentMicroLanePolicy({ microLanePolicy: 'typography' } as any), 'typography', 'typography should round-trip');

    const availableWidth = 120;
    const allowWidth = resolveMinUsableLaneWidth({
        policy: 'allow',
        availableWidth,
        element: { properties: { style: { fontSize: 10 } } } as any
    });
    const balancedWidth = resolveMinUsableLaneWidth({
        policy: 'balanced',
        availableWidth,
        element: { properties: { style: { fontSize: 10 } } } as any
    });
    const typographyWidth = resolveMinUsableLaneWidth({
        policy: 'typography',
        availableWidth,
        element: { properties: { style: { fontSize: 10 } } } as any
    });

    assert.equal(allowWidth, 0, 'allow should preserve all mathematically valid lanes');
    assert.ok(balancedWidth > allowWidth, 'balanced should require a usable minimum lane');
    assert.ok(typographyWidth > balancedWidth, 'typography should be stricter than balanced');
    assert.ok(typographyWidth <= availableWidth, 'thresholds should clamp to available width');

    console.log('OK micro-lane policy');
}

run();
