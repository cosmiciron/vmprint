# Experiment Proof Conventions

This folder holds synthetic proof machinery for architecture work that should be validated independently of production-domain features.

For the kernel actor-activation/update rollout, the preferred first proofs should live here before they are promoted into broader regression coverage.

## Goals

Synthetic proofs in this lane should:

* validate runtime semantics, not document semantics
* be visually diagnosable by eye
* make replay, wake order, redraw, and resettlement obvious
* fail loudly when the runtime shape is wrong

## Visual Style

Prefer proofs that use:

* strongly colored boxes
* explicit actor labels
* render-count labels
* wake-count labels
* clear before/after textual markers
* obvious geometric displacement when settlement occurs

The page itself should communicate what happened before a developer reads logs.

## Naming

For the actor activation/update work, prefer proof names that describe the runtime behavior directly, for example:

* `actor-activation-content-only-visual`
* `actor-activation-geometry-visual`
* `actor-activation-oscillation-visual`

The paired spec names should use the same vocabulary so it is clear which visual proof they exercise.

## Phase 0 Baseline Metrics

The runtime profile already tracks observer and speculative-settlement behavior.

The actor activation/update rollout reserves these additional metrics so proofs can measure cost from the first implementation slice:

* `actorActivationAwakenCalls`
* `actorActivationSignalWakeCalls`
* `actorActivationLifecycleWakeCalls`
* `actorActivationScheduledWakeCalls`
* `actorActivationDormantSkips`
* `actorUpdateCalls`
* `actorUpdateMs`
* `actorUpdateContentOnlyCalls`
* `actorUpdateGeometryCalls`
* `actorUpdateNoopCalls`
* `actorUpdateRedrawCalls`
* `actorUpdateResettlementCycles`

These counters are intentionally generic and should not encode page-counter, footer, or other document-domain semantics.

## Promotion Rule

Synthetic proofs should be promoted into ordinary regression coverage only after:

* the runtime primitive has stabilized
* the visual proof is easy to understand
* the proof has shown value beyond a one-off debugging aid

Until then, experiments remain the correct home for this work.
