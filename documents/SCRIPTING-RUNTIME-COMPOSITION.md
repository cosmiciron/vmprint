# Script Runtime Composition Gap

## Why This Document Exists

VMPrint scripting now has a much cleaner public language:

- document and element handlers
- messages
- receiver-oriented helpers
- implicit scope

That surface is moving in the right direction.

However, one important architectural gap has now become visible:

- some scripting operations look actor-local to the user
- but are still implemented by rewriting the shared authored element structure

This document exists to define that gap clearly before it hardens into accidental architecture.

## The Problem

Operations such as:

- `replace(...)`
- `append(...)`
- `prepend(...)`
- `replaceElement(...)`

can currently cross an important boundary.

From the user's point of view, these may feel like:

- change this element
- replace this participant
- add content around this participant

But in some runtime paths, they are still implemented by mutating the shared nested element structure that the document simulation was originally built from.

That means the engine can end up treating an actor-like change as a document-structure change.

In practice, that can lead to:

- document replay
- broad resettlement
- rebuilding of packagers from shared structure
- semantics that feel too close to source surgery

This is exactly the kind of mismatch a good game engine tries to avoid.

## Why This Matters

A good modern game engine may still have:

- a scene graph
- an entity hierarchy
- a prefab tree
- a UI tree

But local actor changes do not normally imply rewriting that entire structural substrate and refreshing the whole world.

Instead, engines typically separate:

- authored structure
- instantiated runtime participants
- local actor state
- scoped invalidation

VMPrint already has much of the update machinery needed for this:

- `none`
- `content-only`
- `geometry`

What is still too thin is the layer between:

- authored/nested document structure
- live runtime actor composition

## Current Symptom

The current `04-replace-showcase` scripting fixture is a good diagnostic.

It proves that the scripting API can express:

- replacement of a placeholder with new runtime content
- follow-up change to one of the newly introduced elements

But it also reveals that document-level structural changes still route through replay-oriented behavior.

That is useful as a warning signal.

The issue is not that the API is wrong.
The issue is that the implementation path is still too close to the document skeleton.

## Important Distinction

The authored nested element structure is not itself a flaw.

Most engines have an equivalent structural substrate.

The real problem is when that substrate is forced to play two roles at once:

- the stable authored skeleton
- the primary live runtime topology for local scripted change

That dual use is what makes actor-like scripting operations feel too much like bone surgery.

## Architectural Hypothesis

VMPrint likely needs a thicker runtime composition layer between:

- authored elements
- live actor packagers / runtime participants

This layer should mediate local structural operations so they do not default to broad document mutation semantics.

It does not need to replace the authored skeleton.

It needs to shield it.

## Refined Hypothesis

An important refinement has emerged:

VMPrint may not need a large new DOM-like runtime tree or a heavy mirrored registry as the first answer.

Why:

- the engine already has live packagers
- those packagers already know how to disassemble and reassemble themselves into layout boxes
- the session already has an active queue and bounded settlement behavior
- downstream actors already know how to respond when the spatial situation changes

In other words, VMPrint may already have the beginnings of a live composition layer.

The stronger hypothesis now is:

- the active session queue of live participants may already be the real runtime composition layer
- but scripting helpers are still targeting the authored/shared element structure too directly

That means the missing link may not be "invent a second world model."

It may be:

- redirect script structural helpers away from the authored blueprint
- and toward the active live participants already inside the session

## Better Analogy

The authored AST is the instruction manual.

The active packagers are the Lego characters on the board.

Those live participants already:

- break themselves into pieces
- reassemble into boxes
- split, continue, and reform
- respond to spatial pressure and bounded relayout

So if a script says:

- replace Batman with Superman

the correct runtime meaning is probably not:

- scribble out the instruction manual
- rebuild the whole board from scratch

The better meaning is:

1. remove the live Batman participant from the board
2. instantiate live Superman participant(s) from the replacement AST
3. splice them into the active queue where Batman was
4. let the normal settlement physics continue from the affected frontier

That is much closer to what the engine already knows how to do.

## Expanded Lego Movie Model

The Lego analogy is useful because it maps very closely to how VMPrint actually behaves.

### The Instruction Manual

The authored AST is the printed Lego instruction manual.

It describes:

- what participants should exist
- how they are composed
- what authored defaults they begin with

It should remain stable.

Scripts should not normally scribble over this manual in order to make runtime changes.

### The Lego Characters On The Board

When the document session starts, VMPrint does not merely "read text."

It instantiates live layout participants:

- packagers
- continuations
- split fragments
- actor-like runtime units that know how to measure, emit, split, continue, and resettle

These are the Lego Batman, Lego Guy, Lego Superman participants already standing on the board.

### Disassembly And Reassembly Are Already Native

VMPrint's engine already allows these live participants to:

- break themselves into smaller layout pieces
- reassemble into visible boxes
- split across pages
- continue in later regions
- re-form under spatial pressure

So the engine already behaves more like a physics-driven Lego animation than a one-shot document compiler.

This is important because it means the "live participant layer" already exists in practice.

### What `replaceElement(...)` Should Mean In That World

If a script says:

- replace Batman with Superman

the correct meaning is not:

- erase Batman from the instruction manual
- redraw Superman into the manual
- restart the whole movie from page one

The correct meaning is:

1. remove the live Batman participant from the board
2. instantiate live Superman participant(s) from the replacement snippet
3. splice those participant(s) into the active session where Batman stood
4. let downstream participants naturally react to the new spatial situation

If Lego Guy was standing after Batman, and Superman takes up more room, Lego Guy may need to:

- pick up his pieces
- move down the board
- reassemble in a new place

That is not an error.
That is the intended layout physics.

### Why This Matters

This model preserves a critical separation:

- the blueprint remains stable
- the movie remains live

That separation is the architectural principle we want the patent writer to understand.

VMPrint is not merely:

- scripting a static AST

It is:

- applying script-driven structural changes to live, instantiated layout participants
- while preserving the authored document as the stable source definition
- and using bounded frontier settlement rather than whole-document reconstruction

That is the heart of the runtime-composition idea.

## Blueprint Versus Live Participant

For patent-writing purposes, it helps to state the distinction plainly.

### Blueprint

The authored document definition is the blueprint.

It may be:

- JSON AST
- normalized IR
- a source-authored structural description

Its role is to define what should be instantiated.

### Live Participant

A live participant is the instantiated runtime layout actor derived from the blueprint.

It owns or participates in:

- measurement
- box emission
- splitting
- continuation
- message handling
- geometry-sensitive resettlement

Scripts should target the live participant whenever the user intent is local structural change.

### Consequence

Under this model, script operations such as:

- `replaceElement(...)`
- `append(...)`
- `prepend(...)`

are best understood as:

- live participant composition operations

not:

- source blueprint rewrite operations

## Why This Approach Is Important

This approach protects the engine in three ways.

### 1. It Avoids Source Surgery As The Default

The authored structure stays authoritative as source, but it is not treated as the object that every runtime mutation rewrites.

### 2. It Lets Existing Physics Do The Work

Downstream participants already know how to react when upstream geometry changes.

That means the runtime can:

- swap participants
- splice participants
- mark the affected frontier
- and let the normal settlement pipeline propagate the consequences

### 3. It Scales Better Than Broad Replay

Even if current fixtures are small, the architectural implication is much larger.

For large documents, a local scripted change should not imply:

- rebuilding the entire participant world
- re-reading the whole authored structure
- replaying pages that were not affected

The more the system behaves like a live board of actors and less like a rewritten manuscript, the more scalable and honest it becomes.

## Claim-Oriented Summary

The claim-worthy idea is not just "scripts can modify layout."

The stronger concept is:

- an immutable authored document blueprint is kept separate from live instantiated layout participants
- script-driven structural operations target those live participants in the active runtime composition
- replacement or insertion is performed by removing and/or splicing live participants in the active session
- downstream layout is resumed from a bounded affected frontier
- the engine avoids default whole-document rebuild or source mutation semantics for local participant changes

In shorter terms:

- immutable blueprint
- mutable live participant composition
- bounded frontier resettlement

That is the distinctive architecture this note is trying to preserve.

## What We Intend To Do

We intend to move toward a model where actor-like scripting operations are mediated by a stronger runtime layer.

The intended direction is:

1. The authored element structure remains the stable substrate.
2. Runtime participants are instantiated from that substrate.
3. Scripted structural changes are expressed as managed runtime operations.
4. Those operations are classified natively as:
   - `none`
   - `content-only`
   - `geometry`
5. Invalidation begins from the affected frontier, not from a broad document replay by default.

In other words:

- actor replacement should behave like actor replacement
- not like rewriting the whole document map

## Revised Direction

The first design direction to test is now:

1. treat the authored AST as the stable instruction manual
2. treat the active session queue as the live composition surface
3. make structural script helpers operate on live participants rather than the authored/shared element structure
4. reuse the engine's existing bounded settlement and frontier invalidation behavior wherever possible

This is intentionally different from building a heavyweight mirrored DOM.

The goal is to let the existing layout physics do the work, rather than bypassing it.

## Near-Term Principle

For scripting Series 1, we should treat the public API as correct in intent and improve the runtime beneath it rather than shrinking the user-facing surface to accommodate weak internals.

That means:

- do not casually expose bone surgery
- do not normalize document-wide replay as the default consequence of local actor-like change
- strengthen the runtime mediation layer instead

And in light of the refined hypothesis:

- prefer thickening the live session/packager composition layer before inventing a separate mirrored runtime tree

## Questions To Refine

This document is intentionally a living note.

Open questions include:

- What should be considered a true actor-local replacement?
- Which current helpers are genuinely safe runtime operations, and which still leak structural mutation?
- Can runtime-created replacement elements be hosted as local actor composition by splicing live participants into the active queue?
- What existing layer should be thickened:
  - packager layer
  - active session queue / composition surface
  - actor registry / composition layer
  - session runtime
  - or some combination of these
- How should runtime-generated participants preserve identity and messaging semantics?

## Working Standard

We should consider this problem solved only when a scripting operation that conceptually targets one participant can be handled as:

- a managed runtime composition/update operation
- with scoped invalidation
- without defaulting to whole-document refresh semantics

That is the standard we should refine toward.

## Concrete Direction: `replaceElement(...)`

The first concrete operation to redesign is:

- `replaceElement(...)`

Why this operation first:

- it is expressive
- it is easy for users to understand
- it exposes the current structural weakness immediately
- it gives us a clear test case through `04-replace-showcase`

### Intended Runtime Meaning

The public meaning of:

- `replaceElement("placeholder", newAst)`

should be:

- find the live participant currently representing `placeholder`
- remove that live participant from the active session composition
- compile `newAst` into live replacement participant(s)
- splice those replacement participant(s) into the same active queue position
- continue settlement from that affected frontier

The public meaning should **not** be:

- rewrite the authored/shared element structure
- rebuild the whole packager world from the top

### Proposed Execution Path

The runtime path we want to test is:

1. Resolve the target against the live session queue.
2. Capture the target's queue position and spatial frontier.
3. Despawn the target participant from the active queue.
4. Normalize the replacement AST snippet.
5. Compile that snippet into replacement packager(s).
6. Splice the new packager(s) into the queue at the removed participant's position.
7. Mark the affected frontier dirty.
8. Let existing bounded settlement and downstream actor physics continue from there.

This uses the engine the way it already wants to behave:

- live participants change
- downstream participants react
- settlement resumes from the impacted frontier

### Why This Is Attractive

This direction does not require a heavyweight mirrored DOM.

Instead, it leverages things VMPrint already has:

- an active queue of live participants
- packager construction from AST
- frontier-aware settlement
- actor update classification
- downstream relayout behavior

That makes the active queue itself a plausible live composition layer.

## Proposed `replaceElement(...)` Flow

The working implementation sketch is:

1. Script calls `replaceElement(target, snippet)`.
2. Runtime resolves `target` to a live participant in the session.
3. Runtime records:
   - queue index
   - actor id
   - source id / public name
   - current spatial frontier
4. Runtime removes that participant from the queue and unregisters its live observer/signal hooks.
5. Runtime normalizes `snippet` into element(s).
6. Runtime builds packager(s) for those element(s) using the same shaping/packager factory path used at load time.
7. Runtime inserts those new packager(s) into the queue at the original index.
8. Runtime marks the earliest affected frontier as the removed participant's frontier.
9. Runtime continues settlement from there.

### Important Consequence

Under this model:

- actors above the frontier do not need to know anything happened
- actors below the frontier naturally re-measure/reflow if the spatial situation changed

That is exactly the behavior we want from a layout physics engine.

## Required Supporting Behavior

For this path to work cleanly, the runtime needs to support at least:

- resolving a script target to a live participant
- removing a participant from the session queue safely
- instantiating replacement packager(s) from a normalized AST snippet
- splicing those packager(s) into the queue
- updating actor registration/subscription state
- resuming from a precise dirty frontier rather than broad replay

This may require thickening:

- the packager factory path
- the active queue/session composition API
- actor registration bookkeeping

But it should not require mutating the authored AST as the primary path.

## Identity Questions

The replacement flow must answer:

- What identity do replacement participants receive?
- If a replacement element has `name`, how does that map to runtime identity?
- How are generated participants distinguished from authored ones?
- How are message subscriptions rebound when a participant is removed and replaced?

The likely rule is:

- authored names remain the user-facing identity where present
- generated replacement participants receive stable runtime identities at instantiation time
- the runtime, not the authored AST, owns those live identities

## Relationship To `04-replace-showcase`

`04-replace-showcase` is the benchmark fixture for this path.

Under the current implementation, it still exposes replay-oriented document mutation behavior.

Under the intended implementation, it should instead prove:

- replacement of one live participant with new live participant(s)
- downstream relayout from the affected frontier
- no default whole-document refresh semantics

That makes `04` the right fixture to keep revisiting while this work is refined.

## First Implementation Milestone

A good first milestone is:

- support queue-spliced live replacement for one simple flow participant

This is enough to answer the core architectural question before extending the pattern to more compound participants.

Only after that should we broaden the design toward:

- append/prepend as local composition operations
- richer generated participant groups
- compound replacement cases such as tables, stories, and other grouped actors
