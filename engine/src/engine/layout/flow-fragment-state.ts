import { BoxMeta, ElementStyle } from '../types';
import { FlowBox } from './layout-core-types';

export function freezeFlowFragment(base: FlowBox, overrides: Partial<FlowBox>): FlowBox {
    return {
        ...base,
        ...overrides,
        _materializationMode: 'frozen',
        _materializationContextKey: undefined,
        _unresolvedElement: undefined
    };
}

export function createLeadingFragmentMeta(meta: BoxMeta): BoxMeta {
    return {
        ...meta,
        isContinuation: meta.isContinuation || meta.fragmentIndex > 0,
        pageIndex: undefined
    };
}

export function createContinuationFragmentMeta(meta: BoxMeta, fragmentIndex: number): BoxMeta {
    return {
        ...meta,
        fragmentIndex,
        isContinuation: true,
        pageIndex: undefined
    };
}

export function createClonedBoxMeta(meta: BoxMeta, clonedFromSourceId: string): BoxMeta {
    return {
        ...meta,
        generated: true,
        originSourceId: meta.originSourceId || clonedFromSourceId,
        transformKind: 'clone',
        clonedFromSourceId
    };
}

export function createLeadingFragmentStyle(style: ElementStyle): ElementStyle {
    return {
        ...style,
        borderBottomWidth: 0,
        paddingBottom: 0,
        marginBottom: 0
    };
}

export function createContinuationFragmentStyle(style: ElementStyle): ElementStyle {
    return {
        ...style,
        borderTopWidth: 0,
        paddingTop: 0,
        marginTop: 0,
        textIndent: 0
    };
}
