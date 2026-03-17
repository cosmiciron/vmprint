# Layout Zones Runtime Plan

This document translates the updated Layout Zones philosophy into a concrete
runtime refactor plan.

It is intentionally implementation-facing. The goal is to identify the minimum
changes required to evolve `zone-map` from:

- independent spatial regions with move-whole block behavior

into:

- independent spatial regions instantiated per page frame with continuation

The intended model is now explicit:

- a page is a local map
- all pages together are the world map
- zones are regions across that world map
- margins, headers, footers, reservations, and exclusions are non-playable
  terrain on the current local map

See also:

- [LAYOUT-ZONES.md](c:\Users\cosmic\Projects\vmprint\documents\LAYOUT-ZONES.md)
- [AST-SPATIAL-ALIGNMENT.md](c:\Users\cosmic\Projects\vmprint\documents\AST-SPATIAL-ALIGNMENT.md)
- [newsletter-layout-robust.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout-robust.json)

---

## 1. Current Runtime Shape

The current implementation lives primarily in:

- [zone-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\zone-packager.ts)
- [normalized-zone-strip.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\normalized-zone-strip.ts)
- [create-packagers.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\create-packagers.ts)

Current behavior:

1. Normalize the authored `zone-map` into `NormalizedIndependentZoneStrip`.
2. Resolve widths and `x` offsets.
3. For each zone, build packagers and lay them out against `availableHeight = Infinity`.
4. Compute total zone-map height as the tallest zone result.
5. Report `isUnbreakable() = true`.
6. If the settled height does not fit, the whole zone-map moves.

That is spatial partitioning, but not page-framed continuation.

---

## 2. Concrete Drift In Code

The code currently bakes V1 move-whole behavior in several places.

### 2.1 Infinite sub-sessions

In [zone-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\zone-packager.ts),
`materializeZoneStrip()` creates a zone session with:

- `pageHeight: Infinity`
- `placePackagersInZone(..., availableHeight = Infinity, ...)`

This guarantees each zone is poured to completion before pagination has any say.

That is equivalent to simulating the region without respecting the current map
chunk. It ignores the fact that the current page frame has finite traversable
space after terrain is applied.

### 2.2 Hard unbreakability

`ZonePackager.isUnbreakable()` currently always returns `true`.

That means the page loop has no choice but to treat the entire zone-map as one
atomic block.

### 2.3 No continuation state

`NormalizedIndependentZoneStrip` currently contains only:

- zone geometry
- zone elements
- strip margins / gap / styles

There is no room yet for:

- per-zone continuation cursor
- zone-local carry-over state
- per-zone split result

### 2.4 No explicit authored lifecycle mode

The AST currently distinguishes only the structure of the zone-map, not whether
it should:

- move whole
- continue across frames

That distinction must become explicit before runtime behavior changes.

---

## 3. The Minimum New Runtime Model

The next slice should add **paged zone fields** without deleting V1 behavior.

The minimum model is:

### 3.1 Two zone-map modes

- `move-whole`
  Current V1 semantics.

- `continue`
  Page-framed zone field semantics.

The exact authored field name can remain undecided for a short while, but the
runtime should be planned around this explicit distinction.

That lifecycle switch is only the first axis. It does not yet answer the
deeper authored-world question of what kind of region the field represents.

The runtime should now be planned with three authored behavior categories in
mind:

- `fixed`
- `spanning`
- `expandable`

Those are world rules, not pagination heuristics.

### 3.2 Frame-bounded zone sessions

In `continue` mode, each zone should be laid out against:

- `availableHeight = current frame height`

not infinity.

Each zone session should produce:

- current-frame boxes
- whether overflow remains
- continuation state for the next page

And that bounded session must respect the current frame's terrain:

- margins
- header/footer occupation
- page reservations
- exclusions

Those are not part of any zone. They are the local-map constraints within which
zone actors must live.

Important: respecting local terrain is not the same thing as choosing authored
overflow policy. A region may be:

- visible only in the current frame
- spanning across separated playable slices of the world map
- allowed to expand procedurally into neighboring map chunks

The runtime must eventually distinguish those cases explicitly instead of
turning them into automatic defer/clip behavior.

### 3.3 Zone-field continuation

The next page should instantiate the same zone geometry in the next frame and
resume each zone independently from its continuation state.

The minimum first version can require:

- all zones in a paged field advance together

That keeps orchestration simpler.

But even that first version should be read through authored world policy:

- `fixed` fields should not silently invent further region topology
- `spanning` fields may continue through later page slices of the same region
- `expandable` fields may eventually generate more region only when authored
  rules explicitly permit it

The first concrete runtime slice is now live:

- only `spanning` fields receive true page-to-page regional continuation
- `fixed` fields remain conservative even if `frameOverflow: "continue"` is
  authored
- `expandable` remains declared but behaviorless until its authored rules are
  designed

Later versions can allow:

- per-zone clip / continue / link policies
- authored expandable region behavior where the world model explicitly allows
  procedural extension

That distinction is now a requirement, not merely a future nicety. Without it,
the runtime cannot know whether an apparently overcrowded local room should:

- remain overcrowded / unresolved
- continue through another slice of the same world region
- or procedurally expand into more authored world space

That last point is intentionally philosophical as well as technical. Even
before the engine supports it, the runtime should be designed with the idea
that some future zone fields may be:

- fixed field systems
- procedurally extendable field systems

The engine should never freeload as a co-author, but it may eventually be
allowed to generate additional world structure when the authored zone model
declares that such extension is part of the simulation rule.

---

## 4. Borrow From `StoryPackager`, Not From Old Zone V1

The closest runtime analogue is
[story-packager.ts](c:\Users\cosmic\Projects\vmprint\engine\src\engine\layout\packagers\story-packager.ts).

Why:

- it already knows how to operate against bounded height
- it already produces continuation fragments
- it already carries state across page boundaries

The difference is:

- `story` = one linked content stream across lanes
- paged `zone-map` = many independent content streams across repeated frames

So the next design should reuse the *continuation pattern*, not the linked-flow
semantics.

The newly surfaced bug in the robust continued newsletter sits exactly here:

- zone continuation now exists
- but a nested `story` inside a continued zone can still over-occupy the local
  frame instead of being stopped cleanly and resumed in the next one

That bug should not be "fixed" by a zone-local heuristic such as:

- "if a fragment looks too large, defer it to the next page"

That would make the zone runtime an implicit co-author.

So the next runtime work is no longer just "make nested actor systems obey the
local-map occupancy rules inside a paged zone field."
It is:

- "define which occupancy / continuation outcomes are authored world rules,
  and only then make nested actor systems obey them"

Concretely, the runtime now needs an authored-policy layer that can eventually
answer:

- is this zone field fixed?
- is it spanning?
- is it expandable?

Only after that exists should nested actor systems like `story` be taught what
to do when the local room looks overcrowded.

---

## 5. Proposed Internal Shape

The minimum new internal model could look like this conceptually:

```ts
interface NormalizedIndependentZoneStrip {
  kind: 'zone-strip';
  overflow: 'independent';
  sourceKind: 'zone-map';
  frameOverflow: 'move-whole' | 'continue';
  worldBehavior?: 'fixed' | 'spanning' | 'expandable';
  marginTop: number;
  marginBottom: number;
  gap: number;
  blockStyle?: ElementStyle;
  zones: NormalizedIndependentZone[];
}

interface ZoneContinuationState {
  zoneId?: string;
  nextActorIndex: number;
  carry?: unknown;
}

interface ZoneFrameContinuation {
  zoneStates: ZoneContinuationState[];
  consumedFrameHeight: number;
}
```

This is intentionally conservative:

- do not redesign the whole IR
- add only what paged continuation actually needs

---

## 6. Refactor Phases

### Phase 1: Make lifecycle explicit without changing behavior

Targets:

- extend AST / normalization to carry an explicit zone lifecycle mode
- extend AST / normalization to carry an explicit authored world-behavior mode
- default it to `move-whole`
- default world behavior conservatively
- thread it into `NormalizedIndependentZoneStrip`
- keep current runtime behavior unchanged

Success condition:

- no layout change
- fixtures stay green
- runtime and docs stop pretending all zone-maps are inherently move-whole
- runtime and docs stop treating occupancy outcome as an implicit engine choice

### Phase 2: Split `ZonePackager` into orchestration and per-zone session logic

Right now `ZonePackager` does everything at once:

- normalize
- run infinite zone sessions
- materialize boxes
- report height

This should be separated into:

- zone geometry resolution
- per-zone session runner
- strip/frame orchestrator

Success condition:

- no behavior change yet
- code structure is ready for bounded sessions

### Phase 3: Introduce bounded zone session results

Add a bounded session path that can return:

- frame-local boxes
- consumed height
- continuation state

This can initially live behind a private helper without any authored AST switch
turned on yet.

Success condition:

- one zone can be run against a bounded frame and return a continuation

### Phase 4: Add paged `continue` mode for `zone-map`

Only now should authored behavior change.

In `continue` mode:

- `isUnbreakable()` must stop returning `true`
- `split()` must emit current-frame fragment + continuation fragment
- each page must instantiate the zone field and resume per-zone states

Success condition:

- a robust zone-map specimen can begin in the remaining frame on page 1 and
  continue on page 2 without moving wholesale

### Phase 5: Validate with the robust newsletter specimen

Primary pressure test:

- [newsletter-layout-robust.json](c:\Users\cosmic\Projects\vmprint\documents\readme-assets\newsletter-layout-robust.json)

The purpose is not just "make it fit somehow."

The purpose is to prove:

- the authored structure remains honest
- the page behaves like a spatial field
- the old move-whole compromise is no longer required for this class of page

This phase has now produced a very useful intermediate result:

- `frameOverflow: "continue" + worldBehavior: "spanning"` does start the zone
  field in page 1
- the sidebar region continues independently
- `frameOverflow: "continue" + worldBehavior: "fixed"` remains conservative
- the main-zone nested `story` still needs stricter local-frame occupancy

So the specimen should continue to be treated as a truth-revealing probe, not
as a demo to be cosmetically patched.

---

## 7. What Not To Do

To stay disciplined, avoid these traps:

### 7.1 Do not silently change all `zone-map` behavior

Existing `zone-map` documents may rely on move-whole semantics.

The new paged behavior must be explicit.

### 7.2 Do not force explicit `(x, y)` yet

That is the long-term endgame, but not needed for the next slice.

The immediate problem is lifecycle, not authored geometry syntax.

### 7.3 Do not collapse `zone-map` into `story`

They may converge internally, but the authored intent remains different.

### 7.4 Do not patch the newsletter by trimming content

The robust newsletter specimen is valuable precisely because it reveals the
current limitation honestly.

---

## 8. Recommended Immediate Next Step

The next implementation move should be **Phase 1 only**:

- make the zone lifecycle mode explicit in AST + normalization
- thread it into the normalized zone-strip shape
- keep runtime behavior unchanged

That is the safest first code slice because it:

- changes semantics in name only, not behavior
- prepares the code for the later continuation work
- gives the next slices a clear branch point

Once that is in place, the second slice can focus entirely on runtime
orchestration instead of mixing authored-surface changes with engine behavior.
