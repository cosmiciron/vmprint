import assert from 'node:assert/strict';
import { ColliderField } from '../src/engine/layout/collider-field';

function expectAroundIntervals(
    field: ColliderField,
    message: string
): void {
    const intervals = field.getAvailableIntervals(20, 10, 100);
    assert.deepEqual(
        intervals,
        [
            { x: 0, w: 10 },
            { x: 40, w: 60 }
        ],
        message
    );
}

function run(): void {
    const validPolygon = new ColliderField();
    validPolygon.registerObstacle({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'polygon',
        path: 'M0,0 L30,0 L30,30 L0,30 Z'
    });
    expectAroundIntervals(validPolygon, 'valid polygon obstacle should carve the expected band');

    const missingPathPolygon = new ColliderField();
    missingPathPolygon.registerObstacle({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'polygon'
    });
    expectAroundIntervals(missingPathPolygon, 'polygon obstacle without a path should downgrade to rect carving instead of crashing');

    const malformedPathPolygon = new ColliderField();
    malformedPathPolygon.registerObstacle({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'polygon',
        path: 'M0,0 L30,0 nope'
    });
    expectAroundIntervals(malformedPathPolygon, 'malformed polygon path should downgrade to rect carving instead of crashing');

    const topBottomPolygon = new ColliderField();
    topBottomPolygon.registerObstacle({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'top-bottom',
        gap: 0,
        shape: 'polygon',
        path: ''
    });
    assert.deepEqual(
        topBottomPolygon.getAvailableIntervals(20, 10, 100),
        [],
        'downgraded top-bottom polygon should continue to block the whole line band'
    );
}

run();
