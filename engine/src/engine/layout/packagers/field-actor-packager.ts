import { Box, Element, ElementStyle } from '../../types';
import { LayoutProcessor } from '../layout-core';
import { LayoutUtils } from '../layout-utils';
import {
    PackagerContext,
    PackagerPlacementPreference,
    PackagerReshapeResult,
    PackagerReshapeProfile,
    PackagerUnit
} from './packager-types';
import { createElementPackagerIdentity, PackagerIdentity } from './packager-identity';

type LayoutProcessorWithConfig = LayoutProcessor & {
    config?: {
        styles?: Record<string, ElementStyle | undefined>;
    };
};

function resolveFieldActorStyle(processor: LayoutProcessor, element: Element): ElementStyle {
    const typeStyle = ((processor as LayoutProcessorWithConfig).config?.styles?.[element.type] || {}) as ElementStyle;
    const propertyStyle = (element.properties?.style || {}) as ElementStyle;
    return {
        ...typeStyle,
        ...propertyStyle
    };
}

function buildClipProperties(element: Element): Record<string, unknown> {
    const field = element.properties?.spatialField ?? element.properties?.zoneField;
    const placement = element.placement;
    const assembly = field?.exclusionAssembly ?? placement?.exclusionAssembly;
    const shape = field?.shape ?? placement?.shape;
    return {
        ...(assembly?.members
            ? {
                _clipAssembly: assembly.members.map((member) => ({
                    x: Number(member.x ?? 0),
                    y: Number(member.y ?? 0),
                    w: Math.max(0, Number(member.w ?? 0)),
                    h: Math.max(0, Number(member.h ?? 0)),
                    shape: (member.shape ?? 'rect') as 'rect' | 'circle'
                }))
            }
            : {}),
        ...(shape ? { _clipShape: shape } : {})
    };
}

export function isFieldActorElement(element: Element | undefined): boolean {
    return String(element?.type || '').trim().toLowerCase() === 'field-actor';
}

export class FieldActorPackager implements PackagerUnit {
    private readonly style: ElementStyle;
    private readonly width: number;
    private readonly height: number;
    private readonly marginTop: number;
    private readonly marginBottom: number;
    private readonly properties: Record<string, unknown>;

    readonly actorId: string;
    readonly sourceId: string;
    readonly actorKind: string;
    readonly fragmentIndex: number;
    readonly continuationOf?: string;

    constructor(
        private readonly element: Element,
        processor: LayoutProcessor,
        identity?: PackagerIdentity
    ) {
        const resolvedIdentity = identity ?? createElementPackagerIdentity(element, [0]);
        this.style = resolveFieldActorStyle(processor, element);
        this.width = Math.max(0, LayoutUtils.validateUnit(this.style.width ?? 0));
        this.height = Math.max(0, LayoutUtils.validateUnit(this.style.height ?? 0));
        this.marginTop = Math.max(0, LayoutUtils.validateUnit(this.style.marginTop ?? 0));
        this.marginBottom = LayoutUtils.validateUnit(this.style.marginBottom ?? 0);
        this.properties = {
            ...(element.properties || {}),
            ...buildClipProperties(element)
        };
        this.actorId = resolvedIdentity.actorId;
        this.sourceId = resolvedIdentity.sourceId;
        this.actorKind = 'field-actor';
        this.fragmentIndex = resolvedIdentity.fragmentIndex;
        this.continuationOf = resolvedIdentity.continuationOf;
    }

    get pageBreakBefore(): boolean | undefined {
        return Boolean(this.style.pageBreakBefore);
    }

    get keepWithNext(): boolean | undefined {
        return Boolean(this.element.properties?.keepWithNext ?? this.style.keepWithNext);
    }

    prepare(_availableWidth: number, _availableHeight: number, _context: PackagerContext): void {
        // No deferred materialization required for a simple field body actor.
    }

    getPlacementPreference(_fullAvailableWidth: number, _context: PackagerContext): PackagerPlacementPreference | null {
        return { minimumWidth: this.width };
    }

    getReshapeProfile(): PackagerReshapeProfile {
        return {
            capabilities: []
        };
    }

    emitBoxes(_availableWidth: number, _availableHeight: number, _context: PackagerContext): Box[] {
        return [{
            type: 'field-actor',
            x: 0,
            y: 0,
            w: this.width,
            h: this.height,
            style: this.style,
            properties: this.properties,
            lines: [],
            meta: {
                actorId: this.actorId,
                sourceId: this.sourceId,
                engineKey: this.actorId,
                sourceType: this.element.type,
                fragmentIndex: this.fragmentIndex,
                isContinuation: false
            }
        }];
    }

    getRequiredHeight(): number {
        return this.marginTop + this.height + this.marginBottom;
    }

    getZIndex(): number {
        return Number.isFinite(Number(this.style.zIndex)) ? Number(this.style.zIndex) : 0;
    }

    isUnbreakable(_availableHeight: number): boolean {
        return true;
    }

    getLeadingSpacing(): number {
        return this.marginTop;
    }

    getTrailingSpacing(): number {
        return this.marginBottom;
    }

    reshape(_availableHeight: number, _context: PackagerContext): PackagerReshapeResult {
        return { currentFragment: null, continuationFragment: this };
    }
}
