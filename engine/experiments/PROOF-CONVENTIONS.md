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

## Clock Terminology

For the kernel simulation clock rollout, use these terms consistently:

* `tick`: one discrete advancement of kernel-owned simulation time
* `progression`: the act of advancing the world
* `stop`: pause progression at a deterministic point
* `snapshot`: capture resumable progression state
* `resume`: continue progression from a prior stopped/snapshotted state
* `capture`: take a world slice for layout/render output

These terms are intentionally broader than any one subsystem. In particular:

* do not define a tick in proof names as "just an observer sweep"
* do not use wall-clock language for deterministic proof behavior
* do not conflate speculative rollback snapshots with eventual ordinary pause/resume state

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

For the clock/progression rollout, reserve these additional metrics:

* `simulationTickCount`
* `progressionStopCalls`
* `progressionResumeCalls`
* `progressionSnapshotCalls`

Phase 0 only reserves these names. Their behavior will be implemented in later slices.

## Promotion Rule

Synthetic proofs should be promoted into ordinary regression coverage only after:

* the runtime primitive has stabilized
* the visual proof is easy to understand
* the proof has shown value beyond a one-off debugging aid

Until then, experiments remain the correct home for this work.
