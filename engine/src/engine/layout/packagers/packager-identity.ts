import { Element } from '../../types';
import { FlowBox } from '../layout-core-types';
import { LayoutUtils } from '../layout-utils';

export type PackagerIdentity = {
    actorId: string;
    sourceId: string;
    actorKind: string;
    fragmentIndex: number;
    continuationOf?: string;
};

function normalizePath(path: number[]): number[] {
    if (!Array.isArray(path) || path.length === 0) return [0];
    return path.map((value) => Math.max(0, Math.floor(Number(value) || 0)));
}

function buildAutoSourceId(path: number[], actorKind: string): string {
    return `auto:e/${normalizePath(path).join('/')}:${actorKind}`;
}

function buildActorId(sourceId: string, actorKind: string, fragmentIndex: number): string {
    return `actor:${sourceId}:${actorKind}:${fragmentIndex}`;
}

export function createElementPackagerIdentity(element: Element, path: number[]): PackagerIdentity {
    const actorKind = String(element.type || 'node').trim() || 'node';
    const sourceId =
        LayoutUtils.normalizeAuthorSourceId(element.properties?.sourceId) ||
        buildAutoSourceId(path, actorKind);
    return {
        actorId: buildActorId(sourceId, actorKind, 0),
        sourceId,
        actorKind,
        fragmentIndex: 0
    };
}

export function createFlowBoxPackagerIdentity(
    flowBox: FlowBox,
    overrides?: Partial<PackagerIdentity>
): PackagerIdentity {
    const actorKind = overrides?.actorKind || String(flowBox.type || 'node').trim() || 'node';
    const sourceId =
        overrides?.sourceId ||
        LayoutUtils.normalizeAuthorSourceId(flowBox.meta?.sourceId) ||
        buildAutoSourceId([0], actorKind);
    const fragmentIndex = Math.max(
        0,
        Math.floor(Number(overrides?.fragmentIndex ?? flowBox.meta?.fragmentIndex ?? 0))
    );
    return {
        actorId: overrides?.actorId || buildActorId(sourceId, actorKind, fragmentIndex),
        sourceId,
        actorKind,
        fragmentIndex,
        continuationOf: overrides?.continuationOf
    };
}

export function createContinuationIdentity(identity: PackagerIdentity, fragmentIndex?: number): PackagerIdentity {
    const nextFragmentIndex = Math.max(
        identity.fragmentIndex + 1,
        Math.floor(Number(fragmentIndex ?? (identity.fragmentIndex + 1)))
    );
    return {
        actorId: buildActorId(identity.sourceId, identity.actorKind, nextFragmentIndex),
        sourceId: identity.sourceId,
        actorKind: identity.actorKind,
        fragmentIndex: nextFragmentIndex,
        continuationOf: identity.actorId
    };
}
