/**
 * VMPrint does not provide the browser canvas renderer bootstrap that exists in
 * VMCanvas. This file remains only so the engine tree shape can stay familiar
 * during reconciliation work.
 *
 * New code should not import a canvas renderer from VMPrint's neutral engine
 * tree. Browser-facing rendering belongs to VMCanvas.
 */
export {};
