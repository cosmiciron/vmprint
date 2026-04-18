import type { Element, LayoutConfig } from '../types';

export type ResolvedMicroLanePolicy = NonNullable<LayoutConfig['layout']['microLanePolicy']>;

export function resolveDocumentMicroLanePolicy(
    layout: LayoutConfig['layout'] | undefined
): ResolvedMicroLanePolicy {
    return resolveMicroLanePolicyValue(layout?.microLanePolicy);
}

export function resolveMicroLanePolicyValue(
    policy: LayoutConfig['layout']['microLanePolicy'] | undefined
): ResolvedMicroLanePolicy {
    const authored = String(policy || '').trim();
    if (authored === 'allow' || authored === 'typography') return authored;
    return 'balanced';
}

export function resolveMinUsableLaneWidth(options: {
    policy?: LayoutConfig['layout']['microLanePolicy'];
    element?: Element;
    availableWidth: number;
}): number {
    const policy = resolveMicroLanePolicyValue(options.policy);
    if (policy === 'allow') return 0;

    const authoredFontSize = Number((options.element?.properties?.style as { fontSize?: unknown } | undefined)?.fontSize || 0);
    const fontSize = authoredFontSize > 0 ? authoredFontSize : 12;
    const baseThreshold = policy === 'typography'
        ? Math.max(40, fontSize * 5)
        : Math.max(12, fontSize * 1.25);

    return Math.min(Math.max(0, options.availableWidth), baseThreshold);
}
