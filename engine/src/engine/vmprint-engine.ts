import type { Context, FontManager, OverlayProvider } from '../contracts';
import { LayoutEngine } from './layout-engine';
import { ContextRenderer } from './context-renderer';
import { toLayoutConfig } from './document';
import { createPrintEngineRuntime } from '../font-management/runtime';
import { LayoutUtils } from './layout/layout-utils';
import type { AnnotatedLayoutStream, DocumentIR, LayoutConfig, Page } from './types';
import type { EngineRuntime } from './runtime-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EngineInfo {
    /** Page dimensions in points. Available immediately after construction. */
    readonly pageSize: { width: number; height: number };
    /** Content area margins in points. Available immediately after construction. */
    readonly margins: { top: number; right: number; bottom: number; left: number };
    /** Base font family declared in the document. */
    readonly fontFamily: string;
    /** Base font size in points. */
    readonly fontSize: number;
    /** Line height multiplier. */
    readonly lineHeight: number;
    /** Number of pages produced by the last layout() call. 0 until layout runs. */
    readonly pageCount: number;
}

export interface SimulateOptions {
    /** Advance the layout kernel by this many ticks instead of running to settle. */
    ticks?: number;
    /** Run this many settle passes instead of the default single-pass-to-settle. */
    passes?: number;
}

export interface RenderOptions {
    /** Draw layout debug regions on the output. */
    debug?: boolean;
    /** Overlay provider for drawing before/after page content. */
    overlay?: OverlayProvider;
}

// ---------------------------------------------------------------------------
// VMPrintEngine
// ---------------------------------------------------------------------------

/**
 * The VMPrint layout engine.
 *
 * Takes a parsed document and a font manager. Flows text, paginates, positions
 * every element, then renders the result to any Context implementation.
 *
 * Basic usage:
 *
 *   const engine = new VMPrintEngine(document, new LocalFontManager());
 *   await engine.render(context);
 *
 * To inspect the layout before rendering:
 *
 *   const pages = await engine.layout();
 *   await engine.render(context);
 */
export class VMPrintEngine {
    private readonly _config: LayoutConfig;
    private readonly _runtime: EngineRuntime;
    private readonly _inner: LayoutEngine;
    private readonly _elements: DocumentIR['elements'];
    private _pages: Page[] | null = null;

    constructor(document: DocumentIR, fontManager: FontManager) {
        this._config = toLayoutConfig(document, false);
        this._runtime = createPrintEngineRuntime({ fontManager });
        this._inner = new LayoutEngine(this._config, this._runtime);
        this._elements = document.elements;
    }

    // -------------------------------------------------------------------------
    // Info
    // -------------------------------------------------------------------------

    /**
     * The resolved layout configuration derived from the document.
     * Useful for tools that need to inspect or serialize the engine's internal
     * config (e.g. emitting an AnnotatedLayoutStream for --emit-layout).
     */
    get config(): Omit<LayoutConfig, 'debug'> {
        const { debug: _debug, ...rest } = this._config;
        return rest;
    }

    /**
     * Document-level properties. pageCount is 0 until layout() has run.
     */
    get info(): EngineInfo {
        const { width, height } = LayoutUtils.getPageDimensions(this._config);
        return {
            pageSize: { width, height },
            margins: this._config.layout.margins,
            fontFamily: this._config.layout.fontFamily,
            fontSize: this._config.layout.fontSize,
            lineHeight: this._config.layout.lineHeight,
            pageCount: this._pages?.length ?? 0
        };
    }

    // -------------------------------------------------------------------------
    // Layout
    // -------------------------------------------------------------------------

    /**
     * Run a full layout pass: flow text, break pages, position all elements.
     *
     * Returns the resulting pages. The result is also cached internally —
     * a subsequent render() call will use these pages without re-running layout.
     *
     * For most use cases you do not need to call this directly. render() calls
     * it automatically if layout has not been run yet.
     */
    async layout(): Promise<Page[]> {
        await this._inner.waitForFonts();
        this._pages = this._inner.simulate(this._elements);
        return this._pages;
    }

    /**
     * Advanced simulation control for callers who need fine-grained engine access.
     *
     * - No options: equivalent to layout() — single pass to settle.
     * - passes: run N settle passes.
     * - ticks: advance the layout kernel by N ticks (for reactive/streaming use).
     *
     * For the vast majority of documents, layout() is all you need.
     */
    async simulate(options?: SimulateOptions): Promise<Page[]> {
        if (!options?.ticks && !options?.passes) {
            return this.layout();
        }
        await this._inner.waitForFonts();
        // Multi-pass: re-run simulate the requested number of times.
        // Each pass feeds back into the engine's settled state.
        const passes = options.passes ?? 1;
        let pages: Page[] = [];
        for (let i = 0; i < passes; i++) {
            pages = this._inner.simulate(this._elements);
        }
        this._pages = pages;
        return this._pages;
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    /**
     * Render the document to a Context.
     *
     * Runs layout automatically if it has not been called yet. If you need to
     * inspect pages before rendering, call layout() first — render() will reuse
     * the result.
     */
    async render(context: Context, options?: RenderOptions): Promise<void> {
        if (!this._pages) {
            await this.layout();
        }

        const config: LayoutConfig = options?.debug
            ? { ...this._config, debug: true }
            : this._config;

        const renderer = new ContextRenderer(
            config,
            options?.debug ?? false,
            this._runtime,
            options?.overlay
        );

        await renderer.render(this._pages!, context);
    }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/**
 * Render a previously emitted AnnotatedLayoutStream directly to a Context,
 * bypassing the layout engine entirely.
 *
 * Useful for tools that separate the layout and rendering steps — for example,
 * a CLI that saves layout output with --emit-layout and re-renders it with
 * --render-from-layout to iterate quickly on rendering without re-running layout.
 */
export async function renderLayout(
    stream: AnnotatedLayoutStream,
    fontManager: FontManager,
    context: Context,
    options?: RenderOptions
): Promise<void> {
    const config: LayoutConfig = {
        ...stream.config,
        debug: options?.debug ?? false
    };
    const runtime = createPrintEngineRuntime({ fontManager });
    const renderer = new ContextRenderer(
        config,
        options?.debug ?? false,
        runtime,
        options?.overlay
    );
    await renderer.render(stream.pages, context);
}
