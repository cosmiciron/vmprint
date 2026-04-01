# Stage 2 Runtime Ownership Change Log

## Purpose

This note records the late-Stage-2 cleanup that moved simulation, progression,
capture, checkpoint, and report ownership away from `LayoutSession` session glue
and into the runtime/world layer.

It also records the smaller adjacent changes that are part of the same commit,
so the history stays honest about the full worktree contents.

## Summary

This change set finishes the main Stage 2 ownership cleanup.

The important result is:

- `LayoutSession` now behaves much more like an execution shell
- `SessionWorldRuntime` now owns substantially more simulation truth
- report/capture/progression assembly reads directly from runtime-owned state
- safe-checkpoint and branch restore flows preserve progression through the
  runtime layer instead of ad hoc session juggling

This does **not** introduce the Stage 3 persistent `World` runtime yet.
Instead, it deliberately prepares that pivot by tightening the existing
runtime/world boundary first.

## Core Architectural Changes

### 1. `SessionWorldRuntime` now owns simulation run policy and summaries

Moved into
`engine/src/engine/layout/session-world-runtime.ts`.

What it owns now:

- simulation progression policy
- simulation capture policy
- fixed-tick capture horizon
- simulation stop reason
- world summary
- progression summary
- capture summary

Why this matters:

- simulation-world truth no longer needs to be reconstructed by session/report
  glue
- the runtime layer now exposes a coherent summary surface that later Stage 3
  `World` work can build on directly

### 2. Runtime-owned run lifecycle entrypoints were added

`SessionWorldRuntime` now owns explicit run-facing methods such as:

- `configureSimulationRun(...)`
- `beginSimulationRun(...)`
- `startSimulationRun(...)`
- `stopSimulationProgression(...)`
- `resumeSimulationProgression()`
- `shouldContinueAfterPaginationFinalized(...)`
- `resolveSimulationStopReason(...)`

Why this matters:

- `execute-simulation-march.ts` is less policy-aware
- the simulation march increasingly asks the runtime world what to do, instead
  of interpreting progression/capture policy itself

### 3. Branch and checkpoint progression state moved behind the world runtime

`SessionWorldRuntime` now owns:

- progression state snapshot capture/restore
- session branch state snapshot composition/restore
- preservation of the current progression state around safe-checkpoint restore

This replaces older session-side assembly where `LayoutSession` mixed:

- kernel branch snapshot state
- simulation clock snapshot state
- checkpoint restore protection

Why this matters:

- checkpoint restore now reads as one runtime concern rather than
  `kernel + clock sidecar`
- this is one of the most important Stage 2 cleanups because it prepares the
  engine for a persistent world substrate instead of a one-off session march

### 4. Public simulation time now resolves through the world runtime

`LayoutSession` now keeps:

- the raw clock host hooks

`SessionWorldRuntime` now owns:

- the public simulation tick view

That raw/public split prevents recursion while clarifying ownership:

- raw clock mechanics remain in the execution shell
- public simulation time belongs to the runtime/world layer

### 5. Simulation report assembly now consumes runtime-owned summaries directly

`SimulationReportBridge` was simplified so it no longer reconstructs:

- progression summary
- capture summary
- runtime-facing world state

Instead it consumes:

- `SimulationWorldSummary`
- `SimulationProgressionSummary`
- `SimulationCaptureSummary`

directly from the world runtime host surface.

This also introduced `world` as an explicit top-level field in the simulation
report contract.

Why this matters:

- report assembly is now more observational and less definitional
- runtime truth is defined where it lives, not reassembled downstream

### 6. Capture and world-facing report coverage were tightened

Regression checks now verify that the report exposes:

- `world`
- `progression`
- `capture`

consistently, including fixed-tick cooking-board cases.

This makes the Stage 2 boundary executable and test-backed rather than only
documented.

## Execution-Shell Simplification

The broad direction in `engine/src/engine/layout/layout-session.ts` was:

- remove session-owned simulation policy state
- delegate public runtime/progression queries to `SessionWorldRuntime`
- keep only raw host hooks and execution-shell responsibilities locally

What still intentionally remains in `LayoutSession`:

- the raw simulation clock object
- profile counters
- orchestration/execution wiring
- host callbacks used by runtime submodules

Interpretation:

- this is the intended end state for Stage 2
- any further cleanup here should now be judged carefully to avoid wrapper churn
  instead of meaningful architectural progress

## Simulation March Changes

`engine/src/engine/layout/packagers/execute-simulation-march.ts` was updated so
the march loop now:

- starts runs through `beginSimulationRun(...)`
- asks the runtime whether pagination finalization should continue
- asks the runtime to resolve stop reasons

This reduces direct coupling between the march loop and progression policy.

## Adjacent Changes Included In This Commit

### 1. Text script segmentation base-family preference fix

In `engine/src/engine/layout/text-script-segmentation.ts`:

- locale fallback family ordering was refined so a requested base family keeps
  precedence when it already supports the glyph
- a helper was introduced to preserve the base family while reordering fallback
  candidates

Why this matters:

- this prevents locale-preferred CJK fallback ordering from incorrectly
  displacing an authored base family that is already valid

Coverage:

- `engine/tests/module-extractions.spec.ts` now includes a direct test proving
  that a CJK-capable base family remains selected when it already supports the
  cluster

### 2. Perf watchlist expansion

`engine/tests/performance-benchmark.ts` now includes:

- `10-packager-split-scenarios.json`
- `22-story-nested-table-continuation.json`

in the watch preset.

Why this matters:

- those fixtures are architecturally relevant to the current refactor path
- they improve signal when checking for regressions after each boundary cleanup

## Tests And Verification

Verified repeatedly during the Stage 2 cleanup with:

- `npm run test:engine`
- `npm run test:perf-watch`

Performance notes:

- no broad systemic regression was introduced by this Stage 2 ownership pass
- watchlist movement remained localized
- key architecture-watch fixtures such as
  `10-packager-split-scenarios.json` and
  `22-story-nested-table-continuation.json`
  stayed usable as regression sentinels

## Big-Picture Assessment

This change set marks the effective end of Stage 2.

What is now true:

- host honesty rescue is behind us
- runtime/world/capture ownership is substantially clarified
- `LayoutSession` is much closer to an execution shell
- the next meaningful move is no longer more Stage 2 wrapper shaving

What comes next:

- the deliberate Stage 3 pivot
- introduce the first-class persistent `World` runtime/host
- make print/capture consumers of that world instead of treating session march
  as the deepest runtime identity
