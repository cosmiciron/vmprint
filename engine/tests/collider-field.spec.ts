import assert from 'node:assert/strict';
import { ColliderField } from '../src/engine/layout/collider-field';
import { SpatialMap } from '../src/engine/layout/packagers/spatial-map';

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

    const rectSpatialMap = new SpatialMap();
    rectSpatialMap.register({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'rect'
    });
    assert.deepEqual(
        rectSpatialMap.getAvailableIntervals(20, 10, 100),
        [
            { x: 0, w: 10 },
            { x: 40, w: 60 }
        ],
        'rect obstacles should now resolve correctly through the resistance-field substrate'
    );

    const exactCircle = new ColliderField();
    exactCircle.registerObstacle({
        x: 10,
        y: 10,
        w: 40,
        h: 40,
        wrap: 'around',
        gap: 0,
        shape: 'circle'
    });

    const compiledCircle = new SpatialMap();
    compiledCircle.register({
        x: 10,
        y: 10,
        w: 40,
        h: 40,
        wrap: 'around',
        gap: 0,
        shape: 'circle'
    });

    for (const sampleY of [10, 15, 20, 25, 30, 35, 40, 45]) {
        const exact = exactCircle.getAvailableIntervals(sampleY, 6, 100);
        const compiled = compiledCircle.getAvailableIntervals(sampleY, 6, 100);
        assert.equal(compiled.length, exact.length, `compiled circle should preserve interval count at y=${sampleY}`);
        for (let index = 0; index < exact.length; index += 1) {
            assert.ok(
                Math.abs(compiled[index]!.x - exact[index]!.x) <= 1.25,
                `compiled circle left edge should stay close to exact circle at y=${sampleY}, interval=${index}`
            );
            assert.ok(
                Math.abs(compiled[index]!.w - exact[index]!.w) <= 2.5,
                `compiled circle width should stay close to exact circle at y=${sampleY}, interval=${index}`
            );
        }
    }

    const exactEllipse = new ColliderField();
    exactEllipse.registerObstacle({
        x: 10,
        y: 10,
        w: 50,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'ellipse'
    });

    const compiledEllipse = new SpatialMap();
    compiledEllipse.register({
        x: 10,
        y: 10,
        w: 50,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'ellipse'
    });

    for (const sampleY of [10, 14, 18, 22, 26, 30, 34, 38]) {
        const exact = exactEllipse.getAvailableIntervals(sampleY, 6, 100);
        const compiled = compiledEllipse.getAvailableIntervals(sampleY, 6, 100);
        assert.equal(compiled.length, exact.length, `compiled ellipse should preserve interval count at y=${sampleY}`);
        for (let index = 0; index < exact.length; index += 1) {
            assert.ok(
                Math.abs(compiled[index]!.x - exact[index]!.x) <= 1.5,
                `compiled ellipse left edge should stay close to exact ellipse at y=${sampleY}, interval=${index}`
            );
            assert.ok(
                Math.abs(compiled[index]!.w - exact[index]!.w) <= 3,
                `compiled ellipse width should stay close to exact ellipse at y=${sampleY}, interval=${index}`
            );
        }
    }

    const exactPolygon = new ColliderField();
    exactPolygon.registerObstacle({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'polygon',
        path: 'M0,0 L30,0 L30,30 L0,30 Z'
    });

    const compiledPolygon = new SpatialMap();
    compiledPolygon.register({
        x: 10,
        y: 10,
        w: 30,
        h: 30,
        wrap: 'around',
        gap: 0,
        shape: 'polygon',
        path: 'M0,0 L30,0 L30,30 L0,30 Z'
    });

    assert.deepEqual(
        compiledPolygon.getAvailableIntervals(20, 10, 100),
        exactPolygon.getAvailableIntervals(20, 10, 100),
        'compiled polygon field should preserve the same wrap carve as the live polygon collider for simple shapes'
    );
}

run();
