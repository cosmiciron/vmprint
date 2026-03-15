# Speculative Transactions

This document defines the concrete transaction model for speculative layout in
VMPrint.

It exists to restore a boundary that the engine temporarily lost:

* ordinary forward layout is committed flow
* speculative rollback is an explicit subsystem
* snapshots are taken only when a branch truly needs them

The immediate trigger for this spec was the long-manuscript regression where
safe checkpoints were recorded broadly across routine actor/page boundaries.
That turned a narrow prediction primitive into an ambient insurance policy and
made deterministic layout pay speculative costs continuously.

This document turns the corrected architectural rule into a concrete engine API.

---

## 1. Core Rule

VMPrint should behave like a mature simulation engine:

* forward layout is the default mode
* speculative layout must be entered intentionally
* rollback-capable state is scoped to explicit transactions
* no routine actor progression may record a snapshot "just in case"

So the new law is:

> A snapshot is justified only when the engine is about to perform speculative
> mutation whose correctness cannot be known without trial execution and whose
> failure would require restoration.

If that test is not met, no snapshot should be taken.

---

## 2. Goals

This subsystem must provide:

* explicit transactional entry into speculation
* guaranteed commit-or-rollback resolution
* reason-tagged telemetry for profiling
* narrow branch-local mutation scope
* future freedom to change snapshot internals without rewriting layout logic

This subsystem must prevent:

* ambient session-wide checkpointing
* ad hoc snapshot calls scattered across layout code
* speculative state leaking into committed truth
* dangling or half-resolved rollback state

---

## 3. Design Position In The Four Layers

The transaction model spans two layers.

### Layer 1: Microkernel Primitive

The lower layer owns raw reversible state capture and restoration.

Conceptually:

```ts
type SpeculativeCheckpointToken = {
  id: string;
};

type SpeculativeCheckpointReason =
  | 'accepted-split'
  | 'keep-with-next'
  | 'observer-resettle'
  | 'tail-split-formation'
  | 'other';

type SpeculativeCheckpoint = {
  token: SpeculativeCheckpointToken;
  reason: SpeculativeCheckpointReason;
  frontier?: SpatialFrontier;
};
```

The microkernel primitive is intentionally blunt:

```ts
createSpeculativeCheckpoint(...)
restoreSpeculativeCheckpoint(...)
discardSpeculativeCheckpoint(...)
```

It knows how to preserve and restore state.
It does not know layout policy.

### Layer 2: Engine-System Transaction

The normal engine entry point is a structured session API:

```ts
executeSpeculativeBranch(...)
```

This layer:

* opens the checkpoint
* exposes a branch-scoped capability surface
* records telemetry
* requires explicit resolution
* commits or rolls back before returning to forward layout

Higher layers should request speculation through this transaction boundary, not
through raw checkpoint primitives.

---

## 4. Concrete API Shape

### 4.1 Reason Tags

Every speculative branch must declare why it exists.

```ts
export type SpeculativeBranchReason =
  | 'accepted-split'
  | 'keep-with-next'
  | 'observer-resettle'
  | 'tail-split-formation'
  | 'continuation-queue-preview'
  | 'other';
```

The reason tag is mandatory because it gives us a profiling and auditing key.

### 4.2 Result Contract

Every branch must resolve explicitly:

```ts
export type SpeculativeBranchResolution<T> =
  | { accept: true; value: T }
  | { accept: false; value?: T };
```

This contract is intentional:

* branch code cannot "forget" to resolve
* session code knows whether to commit or restore
* ordinary forward layout never resumes in an indeterminate state

### 4.3 Branch Context

The transaction boundary is mandatory.
An elaborate staging DSL is not.

For the first implementation, the branch may operate on live mutable session
state inside the transaction scope, provided that:

* the engine is still single-threaded and synchronous
* the branch is bounded by `executeSpeculativeBranch(...)`
* rollback restores the full checkpoint before ordinary forward layout resumes

That means the first practical branch context can stay minimal:

```ts
export type SpeculativeBranchContext = {
  readonly reason: SpeculativeBranchReason;
  readonly branchId: string;
  readonly frontier?: SpatialFrontier;

  getCurrentY(): number;
  getLastSpacingAfter(): number;
  getCurrentPageIndex(): number;

  captureNote(label: string, payload?: Record<string, unknown>): void;
};
```

In other words:

* the branch closure may mutate live state directly
* `accept: true` keeps that mutation
* `accept: false` restores the checkpoint and erases the speculative mutation

This matches the usual discipline of mature game engines:

* normal update mutates live world state
* prediction/rollback is introduced as a scoped subsystem
* the engine restores prior state only when the speculative path is rejected

So the self-policing part of the design is the transaction boundary itself, not
an all-encompassing `stage...` API on day one.

### 4.3.1 When Explicit Staging Methods Become Justified

If VMPrint later moves away from snapshot-and-restore toward:

* delta logs
* structural sharing
* intercepted mutation recording
* narrower branch-local ownership

then explicit `stage...` methods may become the correct abstraction, because
the engine would need a controlled mutation surface in order to capture or
replay changes precisely.

So the recommended progression is:

* v1: direct live mutation inside `executeSpeculativeBranch(...)`
* later, only if the substrate changes, introduce explicit staging methods

This preserves future flexibility without overengineering the first
implementation.

### 4.4 Session API

The main API should be shaped like this:

```ts
export type ExecuteSpeculativeBranchInput<T> = {
  reason: SpeculativeBranchReason;
  frontier?: SpatialFrontier;
  run: (branch: SpeculativeBranchContext) => SpeculativeBranchResolution<T>;
};

export type ExecuteSpeculativeBranchResult<T> = {
  accepted: boolean;
  value?: T;
};

executeSpeculativeBranch<T>(
  input: ExecuteSpeculativeBranchInput<T>
): ExecuteSpeculativeBranchResult<T>;
```

The session owns the lifecycle:

1. create checkpoint
2. open branch context
3. run speculative code
4. if accepted, commit staged branch state
5. if rejected, restore checkpoint
6. record telemetry
7. return to committed forward layout

---

## 5. Branch Lifecycle

Every speculative transaction should follow the same lifecycle.

### 5.1 Open

`LayoutSession` receives a request to enter speculation with:

* `reason`
* optional `frontier`
* branch closure

At this point:

* a checkpoint is created
* telemetry timing begins
* a branch-local staging area is allocated

### 5.2 Run

The closure performs trial work such as:

* split acceptance preview
* keep-with-next group trial
* continuation queue preview
* observer-triggered resettlement trial

During this phase:

* actor signals remain speculative
* queue changes remain speculative
* staged fragments are not yet committed truth

### 5.3 Resolve

The closure returns one of:

* `{ accept: true, value }`
* `{ accept: false, value? }`

No third state is allowed.

### 5.4 Commit

If accepted:

* staged branch state is promoted into committed session truth
* speculative signals are committed
* the checkpoint is discarded

### 5.5 Rollback

If rejected:

* staged branch state is discarded
* speculative signals are destroyed
* the checkpoint is restored

### 5.6 Close

Telemetry is finalized and committed forward layout resumes.

---

## 6. Telemetry Contract

Reason-tagged transactions are a first-class profiling surface.

Conceptually the session profile should expose:

```ts
type SpeculativeBranchProfile = {
  totalCalls: number;
  totalMs: number;
  acceptedCalls: number;
  rolledBackCalls: number;
  byReason: Record<string, {
    calls: number;
    totalMs: number;
    acceptedCalls: number;
    rolledBackCalls: number;
  }>;
};
```

At minimum we want:

* branch count
* total speculative time
* accepted count
* rollback count
* cost by reason

Nice-to-have fields:

* average checkpoint size
* average actor queue delta
* average signal count staged
* restored frontier distribution

This is important because it lets profiling answer:

* who is opening speculation?
* how often?
* how expensive is it?
* how often does it actually roll back?

---

## 7. What Truly Requires Speculation

The engine should be strict.

### Requires speculative transactions

* Accepted split previews where success/failure is only knowable after trying
  the split and queue effects.
* Keep-with-next grouping trials that mutate queue or placement state before
  the decision is known.
* Tail split formation branches.
* Observer-driven resettlement when committed truth can invalidate earlier
  geometry and trial replay is needed.

### Usually does not require speculative transactions

* Ordinary paragraph placement.
* Routine page advance.
* Plain actor measurement that can be treated as a query.
* Observer checks that do not invalidate geometry.
* Recording checkpoints merely because a later rollback might be useful.

### Borderline cases

These should be pushed toward pure queries whenever possible:

* split measurement
* keep-plan preparation
* reservation/exclusion negotiation
* continuation queue inspection

The rule is:

> prefer measurement over mutation, and prefer staged local mutation over
> session-wide snapshotting.

---

## 8. Relationship To Safe Checkpoints

There are two different rollback-shaped tools in the engine and they should not
be conflated.

### Speculative transactions

These are short-lived branch scopes used for prediction or trial execution.

Examples:

* accepted split preview
* keep-with-next trial
* tail split formation branch

### Safe checkpoints for invalidatable flow

These are restore points used by committed observer-driven resettlement.

Examples:

* dirty-frontier replay after mature bulletin-board signals change earlier
  geometry

The important connection is:

* both are rollback-capable tools
* neither should be ambient
* both must be activated by real uncertainty or invalidation

So this spec does not abolish safe checkpoints.
It narrows them and aligns them with explicit transaction boundaries.

---

## 9. Migration Plan

We should migrate high-value call sites first.

### Phase 1: local branch sites already shaped like transactions

These are the safest first moves because they already behave like temporary
branch scopes:

* accepted split preview in `TransitionsRuntime`
* generic accepted split handling
* tail split formation branch
* continuation queue preview paths

These should be rewritten to use `executeSpeculativeBranch(...)` rather than
manual local snapshot capture and rollback choreography.

### Phase 2: keep-with-next speculative lane

Move keep-with-next trial execution behind the same transaction API and give it
its own reason tag.

### Phase 3: observer-driven resettlement

Unify safe-checkpoint restore work with explicit transaction entry so the
session can distinguish:

* committed forward layout
* speculative prediction branch
* committed dirty-frontier replay

The exact implementation may use a sibling API if needed, but the model should
remain explicit and reason-tagged.

### Phase 4: internals optimization

Only after the transaction boundary is enforced should we optimize the internals
behind it:

* lighter checkpoint tokens
* structural sharing
* delta logs
* actor-local rollback buffers

This order matters.
First restore architectural control, then optimize the substrate.

---

## 10. Guardrails

The engine should enforce these rules:

* Only `LayoutSession` may open speculative execution.
* Raw checkpoint primitives are not for general packager use.
* Every branch must declare a reason tag.
* Every branch must resolve with accept or rollback.
* Ordinary forward layout must not call ambient checkpoint recording.
* Speculative signals must never leak into committed actor-bus truth.

If a caller needs ad hoc rollback behavior outside this model, that is a design
smell and should trigger architecture review.

---

## 11. Non-Goals

This spec does not require:

* immediate replacement of every existing rollback primitive
* a final checkpoint storage optimization up front
* whole-session transactionalization of layout
* turning routine layout march into a continuously speculative engine

The goal is narrower and stronger:

* make speculation explicit
* make it structured
* make it measurable
* keep committed flow cheap

---

## 12. Success Criteria

This spec is successful when:

* long deterministic manuscripts no longer pay ambient snapshot costs
* speculative work appears in telemetry by reason tag
* branch call sites become easier to audit and reason about
* rollback semantics become uniform across the engine
* snapshot internals can later evolve without rewriting layout behavior

In short:

> prediction becomes a named transaction, not a background habit.
