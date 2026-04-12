import type { Page } from '../../../types';

export function clonePage(page: Page): Page {
    return {
        ...page,
        boxes: page.boxes.map((box) => ({
            ...box,
            properties: box.properties ? { ...box.properties } : undefined,
            ...(box.style ? { style: { ...box.style } } : {}),
            ...(box.meta ? { meta: { ...box.meta } } : {})
        })),
        ...(page.debugRegions
            ? { debugRegions: page.debugRegions.map((region) => ({ ...region })) }
            : {})
    };
}
