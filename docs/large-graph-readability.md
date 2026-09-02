# Large-Graph Readability (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending.** rev 2. rev 1 fixed the
direction; **rev 2** closes the four review blockers — a **global hit-test
rule** that fixes selection *before* Focus is on (§LGR4), the internally
consistent Focus definition + closed hop decisions for Slice 1 (§LGR2), a
per-item **persistence table** across every lifecycle event (§LGR3.4), and the
tightened `evaluated` contract (derived-only, no execution-path instrumentation,
§LGR5) — and explicitly holds the **auto-frame** clustering + naming design for
Slice 4b (§LGR6). This doc fixes the **behaviour contract** for reading and
navigating a large model *before* any implementation. It is a **non-frozen**
design doc — no `loop-*/N` id, no `Frozen` marker — and merges as *settled
design, implementation pending*, like [`docs/localization.md`](localization.md),
[`docs/guided-tour.md`](guided-tour.md), and [`docs/edge-routing.md`](edge-routing.md).

This is the first design pass of the **Productization track** (README roadmap),
chosen ahead of the small module / template system because the read / select
problem is **already reproducible in the shipped _Early MMO progression_
example** and this pass improves that example's usability immediately, at a
smaller scope and lower serialization risk. Its focus / filter substrate is also
a dependency of the later assembly screen ([`docs/product-direction.md`](product-direction.md)
§PD8-B).

A **render / UI layer**, with **one** staged exception (§LGR6): everything here
is view state that changes nothing the engine computes, nothing that is
serialized, and no wire contract — *except* a future **saved group frame**,
which is deferred behind its own Frozen `loop-revision/N` **cosmetic** amendment
and is **not** part of the first implementation. §LGR11 is the decision record,
§LGR10 the acceptance / E2E set, §LGR12 the slices, §LGR13 the scope boundary.

**Build order (settled with Lumi):**
1. this design doc → review → settle;
2. **Slice 1** — global hit-test rule + focus view + de-emphasis (render /
   UI-only);
3. **Slice 2** — transient filters;
4. **Slice 3** — the run distinction (`evaluated` vs `effective`),
   derived-only;
5. **Slice 4a** — transient (session) group frames + the opt-in activity
   overlay — fully specified here;
6. **Slice 4b** — *auto* group frames — clustering algorithm + label
   generation are **their own detailed design pass**, held here (§LGR6.3);
7. **Slice 5** — *saved* group frames, **only** behind a Frozen
   `loop-revision/N` cosmetic `frames` contract; deferred, revisited on demand.

Slices 1–4a carry no wire change and no engine change. Slice 4b needs its own
design pass before build. Slice 5 does not start until its contract is Frozen.

---

## LGR0. Why

The *Early MMO progression* example (97 nodes / 144 edges) reproduced the
problem the Productization track exists to fix: on a graph past a handful of
nodes, Bézier edges cross, overlap, and pass behind nodes; "what connects to
what" is untraceable; a click often lands on the wrong element; and a running
step lights up so much of the canvas at once that the motion stops meaning
anything.

This pass does not restructure the model or move any node. It makes a large
model **readable where it is**:

- you can isolate one node and see only what it touches;
- you can mute the classes of connection you are not currently reasoning about;
- a click reliably hits the node under the cursor;
- a run step distinguishes *the engine considered this* from *something
  actually moved here*;
- optional labelled regions give the graph a coarse structure to scan by.

It is deliberately the smaller, lower-risk pass: focus and filters are pure view
state; only a *saved* group frame would touch serialized bytes, and that is
staged behind a Frozen contract (§LGR6). Being able to read a large model is
also a precondition for reviewing the advanced graph that sits *outside* a
template's surfaced inputs and result Summary (§PD5).

---

## LGR1. Scope

**In**

- a **global hit-test rule** — over a node's body the node always outranks any
  edge or badge; edge selection is possible only outside every node body. This
  holds **with Focus off**, and is the fix for the "click lands on the wrong
  element" defect (§LGR4);
- a **focus view** — selection isolates a node and its 1-hop connections
  (§LGR2);
- **de-emphasis + transient filters** — dim everything outside the focus set;
  hide by edge class / resource type / node kind (§LGR3);
- a **run distinction** — `evaluated` (derivable "the engine computed this to
  zero / no change") vs `effective` (a non-zero transfer / change happened), as
  two weights on the existing playback cue vocabulary — **derived from the
  committed step result only** (§LGR5);
- a **past-step cue policy** — each step clears the previous; an opt-in activity
  overlay is the only accumulation (§LGR6-cues);
- **group frames** — the transient / auto / saved decision and the wire
  boundary; **transient** frames ship in Slice 4a, **auto** frames' algorithm +
  naming are held for a Slice-4b design pass, **saved** is deferred behind a
  Frozen cosmetic contract (§LGR6);
- a **per-item persistence table** — what each toggle / selection / frame does
  across doc switch, graph reopen, browser refresh, sim Reset, Reset view, and
  `localStorage` clear (§LGR3.4);
- **viewing conditions** — desktop / mobile / keyboard / `forced-colors` /
  `prefers-reduced-motion` (§LGR9);
- **invariants** (§LGR8) and an **acceptance set** anchored on
  `examples/mmo-progression.json` at start / mid / end run phases (§LGR10).

**Out**

- **Any node re-layout.** No readability control moves, resizes, or reorders a
  node (§LGR13). "Auto-layout of a selected region" is the module-system pass
  (§PD8-B).
- **Collapsible composite nodes / sub-graphs.** Folding structure into one node
  touches the wire contract; it is `docs/product-direction.md` §PD4 *long term*,
  not this pass.
- **The small module / template system (B).** Example / Template / Building
  block packaging, surfaced inputs + result Summary, the connection helper, the
  staged build flow, the localization overlay — all §PD8-B.
- **Re-opening the Canvas Visual Refresh (VL) or Simulation Playback (PB).**
  This composes with them; the run distinction is a new *weight* on the
  existing PB cue, not a new choreography.
- **Scenario Compare.**

---

## LGR2. Focus view

### LGR2.1 Trigger

A toolbar toggle **Focus selection** (desktop) / a More-sheet toggle (mobile),
**default off**. It is a **global UI preference** (one `localStorage` key, like
theme and locale — *not* per graph), never serialized (§LGR3.4). When **on**,
selecting one or more nodes puts everything outside the *focus set* into the
de-emphasis tier (§LGR3). Deselecting, pressing `Esc`, or clicking empty canvas
restores the full-strength canvas. Hover never drives focus.

### LGR2.2 The focus set — closed for v1

Given the selected node(s), the focus set is **exactly**:

- the selected node(s) themselves;
- every node joined to a selected node by **one drawn edge** (resource or state)
  in either direction;
- the drawn edges that join them.

**Closed decisions (do not treat as tuning):**

- **Depth is a fixed 1 hop** in v1. A hop-count control (1–2) is an **explicit
  later follow-up**, *not* a Slice-1 parameter (`LGR-D2`).
- **Expression `depends-on` links are NOT in the focus set** in v1 — a Register
  reading a Parameter with no drawn edge does not pull that Parameter into the
  set. The traversal is over the **drawn edge graph only**, so Slice 1 stays a
  pure view-state layer with no expression parsing. Parameter / Register nodes
  have no ports, are never a drawn-edge hop, and stay **visible but dimmed**
  when a dependent is focused; the user selects them directly. An
  "include expression dependencies" option is a later follow-up, shared with
  the module system's connection helper (`LGR-D3`).
- The **dependency-hint** dotted edge (§VL6) appears only during revision
  Review, not in normal editing; when present it counts as a drawn edge for
  the traversal.

### LGR2.3 What "outside the focus set" keeps

De-emphasis dims; it never hides the [`docs/visual-language.md`](visual-language.md)
§VL7.1 **required set**. On a still-present, dimmed element these render at
**full strength**:

- selection & keyboard-focus rings;
- `invalid` / `▲!` conflict / `⃠` blocked flags;
- the run-in-progress cue (§LGR5).

You must still be able to see an error on a node you are not focused on. The
selected node(s) and their 1-hop neighbours are **full-strength** (they are *in*
the focus set); only nodes and edges **outside** the set are dimmed — so the
"walk the graph" gesture (§LGR4) acts on a dimmed node **outside** the current
set, never on a full-strength neighbour.

### LGR2.4 Focus is view-only

Focus changes no GraphDoc byte, no digest, no undo entry, no `SimState`
(§LGR8). It **never moves the viewport** — selecting a node does not pan or
zoom. "Fit / frame selection" stays a separate, explicit user action, unchanged
from today.

---

## LGR3. De-emphasis and transient filters

### LGR3.1 De-emphasis tier (focus)

Out-of-focus elements drop to `--deemphasis-opacity` (a token, ≈ 0.25–0.35,
tuned against §LGR9 contrast). Their **badges** (flow chip, condition chip,
expression, type dot) are **hidden** while dimmed — they are the noise focus is
removing; the in-node value / capacity bar stays. §LGR2.3's required set is
exempt and stays full-strength.

### LGR3.2 Transient filters

A filter panel (toolbar / More sheet) toggles visibility by:

- **edge class** — resource / state / dependency-hint;
- **resource type** — the §VL5.1 set (Gold, Energy, XP, Player, Item, untyped);
- **node kind** — source / pool / gate / converter / drain / parameter /
  register / drain, etc.

Filters **hide** (not dim): a filtered element is removed from the canvas
(`hidden`, not painted, not hit-testable). Hiding an edge leaves its endpoint
nodes visible; hiding a node also hides its incident edges. The **filter
selections** are **ephemeral exploration state** — in memory only, not
serialized, not in the undo stack, and **cleared on every graph (re)load**
(doc switch, reopen, browser refresh) and by **Reset view** (`LGR-D4`, §LGR3.4).
The filter **panel's open/closed** state is a separate global UI preference.

### LGR3.3 Composition

Filter applies first (removes), then focus dims the remainder. Both are off by
default; either works without the other.

### LGR3.4 Persistence — the per-item contract

Two classes of state, and nothing in between (persistent-but-not-in-file is
**not** offered — that is what a *saved* frame, §LGR6.3, is for):

- **UI preferences** — sticky, global, one `localStorage` blob
  (`loop-studio:readability`), never per graph, never serialized;
- **Ephemeral exploration state** — in memory only, tied to the open graph +
  session.

| item | switch doc / open another graph | reopen same graph | browser refresh | sim **Reset** | **Reset view** | `localStorage` cleared |
|---|---|---|---|---|---|---|
| **Focus toggle** (on/off) | kept | kept | kept | unaffected | unaffected | → default **off** |
| **Auto-frames toggle** | kept | kept | kept | unaffected | unaffected | → default **off** |
| **Activity-overlay toggle** | kept | kept | kept | unaffected | unaffected | → default **off** |
| **Filter panel** open/closed | kept | kept | kept | unaffected | unaffected | → default **closed** |
| **Filter selections** (which classes/types hidden) | **cleared** | **cleared** | **cleared** | unaffected | **cleared** | n/a (not stored) |
| **Focus selection** (which nodes) | cleared | cleared | cleared | unaffected | cleared | n/a |
| **Transient frames** (drawn rects + labels) | cleared | cleared | **cleared** | unaffected | kept *(only an explicit **Clear frames** removes them)* | n/a |
| **Activity-overlay tint** (accumulated) | cleared | cleared | cleared | **cleared** | cleared | n/a |

- **Transient frames are session-only** — in memory, gone on a full browser
  refresh (§LGR6.1). "Transient" contrasts with a *saved* frame in the file,
  not with "survives a reload".
- **Reset view** = reset pan/zoom + clear the *exploration lens* (focus
  selection, filter selections). It does **not** touch the sticky preference
  toggles and does **not** delete transient frames.
- **sim Reset** touches only the activity-overlay accumulation (a function of
  the run); every other readability state is left alone.

---

## LGR4. Hit-test rules

### LGR4.1 The global rule — applies with Focus **off**

The "a click lands on the wrong element" defect happens **before** Focus is ever
switched on: a Bézier edge or a badge drawn over a node's body swallows the
click. Slice 1 fixes it with a **priority independent of Focus and of zoom
level**:

1. **Inside a node's body** (its §VL7.1 L2 footprint), the **node is the top hit
   target.** Any edge segment or badge that visually overlaps that rectangle
   does **not** receive the pointer there — the node does. A node's own hit
   target is never shrunk below the L2 footprint.
2. **Outside every node body**, an **edge** is selectable via its fat
   interaction path (unchanged from today).
3. **Badges** are `pointer-events: none` by default (none are interactive today;
   the resource-type-mismatch hover text is delivered without taking the
   pointer). A badge never blocks the node or edge beneath or beside it, and a
   badge that sits just outside node X's silhouette never extends X's
   interception into a neighbouring node.
4. **Overlapping node bodies** (a dense layout): the topmost in paint order
   wins, as today — this rule does not re-stack nodes, only settles node-vs-edge
   and node-vs-badge.

This is a pure hit-test change: no node moves, no z-order of nodes changes, the
GraphDoc is untouched.

### LGR4.2 With Focus **on** — additions

- A **de-emphasised edge** (outside the focus set) is `pointer-events: none`
  entirely — it is not selectable while dimmed.
- A **filtered-out** element is not in the DOM hit path at all (§LGR3.2).
- A **dimmed node outside the focus set is still clickable.** Selecting it
  recomputes the focus set around it — the "walk the graph" gesture. (A
  full-strength 1-hop neighbour is already *in* the set; clicking it just moves
  the selection there.)
- **Empty-canvas click** clears selection, which clears focus.

### LGR4.3 Keyboard

Tab order is unchanged — reading order (§VL8); Focus is a *visual* isolation,
not a tab-scope change. v1 adds only: a shortcut to toggle Focus, and *select
next / previous connected node* to step the selection along drawn edges. Deeper
keyboard graph-nav is a later follow-up (`LGR-D5`).

---

## LGR5. The run distinction — `evaluated` vs `effective`

Today a resource edge carrying flow shows a travelling bead and an acting node
shows a "fired" glow (§VL6, [`docs/simulation-playback.md`](simulation-playback.md)).
On a large graph a step lights up too much at once. This pass splits the run cue
into **two weights**:

| Weight | Meaning | Cue |
|---|---|---|
| **`effective`** | a **non-zero** transfer or change happened here this step — resources moved, a pool value changed, a state event fired | the full "fired" glow + the bead / arrival cue (unchanged from PB) |
| **`evaluated`** | the committed step result shows this element **was computed and its contribution was zero / no change** — e.g. a resource edge whose `flow` resolved to `0`, a gate branch the committed split gave `0`, a converter that did not fire | a faint outline tick / low-opacity pulse; **no** travelling bead |
| *(no cue)* | the element cannot be shown to have been computed this step from the committed result | nothing — it is not marked |

### LGR5.1 Derived-only — the closed contract

**The distinction is a pure read of the committed engine step result plus the
already-emitted playback event stream (PB1). Slice 3 adds no field to the engine
and no field to the playback event builder, and does not instrument the
execution path.**

- Where the committed result distinguishes "computed to zero" from "not
  visited" — resource-edge `flow` values, the committed gate split, converter
  fire/no-fire, pool deltas, state events — the element gets `evaluated` or
  `effective` accordingly.
- Where it does **not** (e.g. a branch the engine short-circuited before
  weighing), the element gets **no cue**. `evaluated` is a bonus shown where it
  is derivable; `effective` is the signal that always holds. Recording "the
  engine looked here but produced nothing" would be execution-path
  instrumentation, not a derivation — **out of scope** (`LGR-D6`).
- A resource edge whose committed `flow` is `0` → `evaluated`. A gate whose
  committed split sent everything down one branch → taken branch `effective`,
  the branch with committed `0` → `evaluated`, a branch absent from the split →
  no cue.
- **Display only** — nothing here changes the engine, `R(t)`, state semantics,
  the semantic digest, or Monte-Carlo.
- **`prefers-reduced-motion`:** both become static — `evaluated` a faint static
  tick, `effective` the static highlighted end-segment from §VL9.
- **`forced-colors`:** `evaluated` vs `effective` are told apart by **glyph /
  line-style**, not opacity or hue alone.

---

## LGR6. Group frames, and the past-step cue policy

### LGR6-cues. Past-step accumulation

**Decision: each step clears the previous step's run cues. No accumulation by
default.** Playback already owns per-step choreography and a within-step fading
trail (§VL6 `--flow-trail`); accumulating across steps would fight it and make
a *paused* frame ambiguous.

The **only** accumulation is an **opt-in activity overlay** (toolbar, **off by
default**): while on, each element carries a low-opacity tint proportional to
how often it was `effective` over a trailing window, decaying. It is a labelled
readability aid, not the run cue; view-only, never serialized (§LGR3.4); the
accumulated tint clears on sim Reset, on seek, and on graph reload; Step
advances it one step. The **window length and decay curve are a Slice-4a
tuning detail** — the contract here is only *what* it shows and *that* it never
persists (`LGR-D7`).

### LGR6.1 Group frames — the three models

| Model | What it is | Persistence | Ships |
|---|---|---|---|
| **transient** | the user draws a rectangle around some nodes and labels it *for the current session* | **in memory only** — gone on a full browser refresh (§LGR3.4); never GraphDoc / digest / Share / revision | **Slice 4a**, fully specified here |
| **auto** | the app infers clusters and draws labelled frames with generated names | **derived, never stored** — recomputed from the layout, like the orthogonal route map (§ER3.9) | **Slice 4b** — algorithm + naming are their own design pass (§LGR6.3) |
| **saved** | the user creates / labels / resizes frames that survive reload, Share, and a Project revision | serialized — needs a wire contract (§LGR6.4) | **Slice 5** — deferred behind a Frozen contract |

### LGR6.2 Decision

- **Transient frames ship in Slice 4a** — a session-only labelled rectangle
  with zero format risk. Contract: draw a rect, type a label; it groups no
  behaviour; it is not undoable; it survives sim Reset and Reset view; an
  explicit **Clear frames** removes it; a full reload drops it (§LGR3.4). It
  **never moves or resizes a node** (§LGR6.5).
- **Auto frames are held for Slice 4b.** "Connected component + coarse spatial
  clustering → the MMO's three zone lanes + stable labels" is a *goal*, not a
  settled algorithm: the clustering method, the tie-breaks, the determinism
  proof, and the label-generation rules need their own detailed design before
  build. This doc fixes only the **boundary** they must honour (§LGR6.3); it
  does **not** claim the algorithm is settled.
- **Saved frames are deferred to Slice 5**, gated on a Frozen wire contract
  (§LGR6.4). Not worth a wire amendment until there is demand.

### LGR6.3 Auto frames — the boundary the Slice-4b design must honour

Whatever clustering + naming Slice 4b lands:

- **derived, never stored** — recomputed from (graph, layout); no bytes in the
  GraphDoc, the digest, Share, `SimState`, or `localStorage`;
- **deterministic** — identical frames + labels for identical (graph, layout)
  across reloads, hover, theme toggle, a sim step, and input array order
  reversed (LGR-INV-7);
- **never moves, resizes, or reorders a node** (§LGR6.5);
- **atomic recompute** — a layout change recomputes the whole frame set in one
  pass, like the route map (§ER3.9); a render never mixes stale and fresh
  frames;
- toggled off by default; purely an overlay.

### LGR6.4 If `saved` is taken up — the wire boundary

A saved frame gets a **`loop-revision/N` cosmetic** amendment modelled exactly
on `route` / `waypoints` (§ER6):

- a `frames?: { id, label, rect: {x,y,w,h}, members: nodeId[] }[]` block,
  **stored on the graph, user intent only**, tagged **cosmetic** — projected,
  diffed, dirty-tracked, **never** `engineAffecting`, never feeds `nConf`;
- a **conservative-extension golden** — a graph with no `frames` is byte- and
  digest-identical under the amended projection;
- a **defensive reader** — a malformed frame is dropped, the graph is kept;
  `members` entries pointing at absent node ids are dropped on read;
- **`loop-workspace` unchanged** — a frame adds nothing to `SimState` or the
  restore contract;
- **Frozen before Slice 5 starts.**

### LGR6.5 What a frame is *not*

A frame is a labelled rectangle. It is **not** semantic nesting: it never
changes what a node connects to, never scopes an expression, never affects the
engine, the semantic digest content, undo of graph edits, or `SimState`. It
**never moves or resizes a node** (§LGR13) — "move the whole group" is a layout
feature for a later pass. Dragging a frame in v1 moves the frame only, not its
members.

---

## LGR7. Terms

| Term | Meaning |
|---|---|
| **focus set** | the selected node(s) + their **1-hop drawn-edge** neighbours + the joining edges (§LGR2.2); everything in it is full-strength |
| **de-emphasis tier** | elements **outside** the focus set, at `--deemphasis-opacity`, badges hidden, §VL7.1 required set exempt (§LGR3.1) |
| **global hit-test rule** | node-over-edge / node-over-badge priority that holds with Focus off (§LGR4.1) |
| **filter** | an **ephemeral** (in-memory, cleared on reload / Reset view) hide by edge class / resource type / node kind (§LGR3.2 / §LGR3.4) |
| **`evaluated` / `effective`** | the two run-cue weights, derived from the committed step result only (§LGR5) |
| **transient / auto / saved frame** | session-only / derived / file-saved group-frame models (§LGR6.1) |
| **activity overlay** | the opt-in, never-persisted cross-step `effective`-frequency tint (§LGR6-cues) |

---

## LGR8. Invariants (LGR-INV)

1. **View-only.** The global hit-test rule, Focus, de-emphasis, filters, the
   activity overlay, and transient + auto frames produce **zero** change to the
   serialized GraphDoc, the `loop-revision/*` digest, `canUndo` / the undo
   stack, node z-order, the engine step result, `R(t)`, state events, and the
   Monte-Carlo digest. Load every `examples/**`, toggle every control, run to
   the end — all byte-identical to before.
2. **Viewport untouched.** Selecting a node, toggling Focus, applying a filter,
   or drawing a frame never changes pan / zoom. Only an explicit "fit / frame
   selection" moves the viewport, unchanged from today.
3. **Workspace clean.** `loop-workspace/1` restore carries nothing about focus /
   filters / frames / activity. A stepped Workspace round-trips identically.
4. **Storage — per §LGR3.4.** The sticky preference toggles live in **one
   global `localStorage` blob**, never per graph; filter selections, focus
   selection, transient frames, and the activity tint are **in memory only**.
   A cleared `localStorage` resets exactly the toggles (to their defaults) and
   nothing else; it never touches a graph or its lineage record.
5. **Saved frames (Slice 5).** Touch only their own `loop-revision/N` cosmetic
   `frames` block: a graph that has never had a frame serialises and digests
   exactly as today. Cosmetic ⇒ never `engineAffecting`, never feeds `nConf`.
6. **Required set survives dimming.** De-emphasis / filter never removes the
   §VL7.1 required set from a still-present element — selection / focus rings,
   `invalid` / conflict / blocked flags, and the run cue stay full-strength on
   a dimmed node.
7. **Determinism.** The focus set (and, once Slice 4b lands, the auto-frame set)
   is a pure function of (selection, graph, layout): identical across two fresh
   loads, after hover / select / zoom / pan / theme toggle / a sim step, and
   with the node array and edge array reversed on input (mirrors ER-INV-3).
8. **Hit-test priority.** With Focus **off**, a pointer-down anywhere inside a
   node's L2 footprint targets that node, never an edge or badge drawn across
   it; outside every node body an edge is still selectable (§LGR4.1).

---

## LGR9. Viewing conditions

- **Desktop** — toolbar controls for Focus, Filters, Activity overlay, and
  (once Slice 4b lands) Auto-groups.
- **Mobile (view / run)** — the global hit-test rule (§LGR4.1) applies;
  Focus-on-selection and Filters are in the More sheet and work; **frame
  *drawing* is desktop-only** (like editing); auto frames render when Slice 4b
  ships; no horizontal document scroll.
- **Keyboard** — Focus toggle has a shortcut; *select next / previous connected
  node*; Tab order unchanged (reading order); every toggle is reachable with an
  accessible name + pressed state.
- **`forced-colors: active`** — de-emphasis switches from opacity to a
  **dashed / low-priority outline** treatment (opacity alone is not reliable
  under a UA colour override); filtered elements stay hidden; `evaluated` vs
  `effective` use glyph / line-style. The app does not fight the override
  (§VL8).
- **`prefers-reduced-motion: reduce`** — no animated dim transition (instant);
  the activity overlay steps between static states, its decay is not animated;
  run cues are static (§LGR5).

---

## LGR10. Acceptance / E2E

Machine-checkable, mirroring [`docs/edge-routing.md`](edge-routing.md) §ER12 and
§VL12. The reference large graph is **`examples/mmo-progression.json`**,
exercised at three run phases: **start** (step 0–2), **mid** (≈ step 40), **end**
(Level 15 reached, ≈ step 88).

*Per-slice: each slice ships the subset of these it introduces.*

1. **Invariance.** Load `mmo-progression.json`; snapshot serialized GraphDoc +
   `loop-revision/*` digest + `canUndo` + node z-order. Toggle Focus, every
   Filter, the Activity overlay (and Auto-groups once Slice 4b lands); draw and
   delete a transient frame. Re-snapshot → byte-identical. Run to **end** with
   every control on — pool series / `R(t)` / state events / MC digest
   unchanged. (LGR-INV-1.)
2. **Global hit-test — Focus OFF** (Slice 1). On a dense region of
   `mmo-progression.json`, `pointer-down` at a coordinate that is inside a
   node's L2 footprint **and** on top of an edge path drawn across it selects
   the **node**; `pointer-down` on the same edge *outside* every node body
   selects the **edge**; a badge never takes the pointer. (LGR-INV-8.)
3. **Focus set.** With Focus on, select a **mid**-lane combat node: exactly its
   1-hop drawn-edge neighbours + the joining edges are full-strength; every
   node/edge **outside** that set is de-emphasised; an `invalid` / blocked node
   elsewhere and a running cue stay visible; a Parameter/Register that only
   feeds the node via an expression is **dimmed, not in the set** (LGR-D3).
   (LGR-INV-6.)
4. **Walk the graph.** With Focus on, clicking a **dimmed node outside the
   focus set** selects it and recomputes the set around it; a de-emphasised
   edge and an out-of-focus badge do **not** intercept that click;
   empty-canvas click clears focus. (§LGR4.2.)
5. **Filter.** Hide `state` edges → every dashed edge and its `✳` / `≥…` / `±…`
   chips are gone; resource edges and node bodies intact. Hide resource-type
   *Gold* → only gold-typed pools / edges removed. **Browser-refresh the same
   graph → all filter selections are gone** (start unfiltered); the Focus /
   Auto-groups / Activity toggles are unchanged. (LGR-D4, §LGR3.4.)
6. **Run distinction.** At a step where the committed gate split sends all flow
   to one branch, the taken branch shows `effective` + bead, the branch whose
   committed value is `0` shows `evaluated` only (no bead); a converter with no
   committed activity shows **no cue** (not `evaluated`). Nothing about the cue
   changes the engine result / digest / MC. (§LGR5.1.)
7. **Past-step.** Single-step from **mid**: step *N* cues are absent at *N+1*
   (no accumulation). Enable the Activity overlay; step 10× — tint builds on
   the busy hunt / loot edges, decays on idle ones; **sim Reset clears the
   tint but leaves the toggle on**; a graph reload clears it. (§LGR6-cues,
   §LGR3.4.)
8. **Transient frame** (Slice 4a). Draw a frame around the gold-economy nodes
   and label it; the serialized GraphDoc + digest are **unchanged**; sim Reset
   and **Reset view** leave it in place; **Clear frames** removes it; a full
   browser refresh drops it. It never moves a node. (§LGR6.2, §LGR6.5,
   §LGR3.4.)
9. **Auto frames** (Slice 4b — asserted only once that slice's design lands).
   For identical (graph, layout): the frame set + labels are byte-identical
   across two fresh loads, a theme toggle, a sim step, and input arrays
   reversed; no frame moves / resizes / reorders a node. The *content* of the
   clustering is judged against the Slice-4b design, not asserted here.
   (LGR-INV-7, §LGR6.3.)
10. **Mobile.** `mmo-progression.json` on the view / run layout — the global
    hit-test rule holds; Focus + Filters work from the More sheet; there is no
    frame-draw affordance; no horizontal scroll; dimming is visible. (§LGR9.)
11. **`forced-colors` + `reduced-motion`.** Under `forced-colors: active`
    de-emphasis uses a non-opacity tell and the hit-test rule is unaffected;
    under `prefers-reduced-motion: reduce` no animated transitions; `evaluated`
    vs `effective` still distinguishable. (§LGR9.)
12. **Readability proxy.** At start / mid / end, with Focus on and a combat node
    selected, the count of full-strength edges within the viewport is ≤ a
    per-phase threshold recorded in the Slice-1 work (a proxy for "traceable"),
    not asserted blind here.

---

## LGR11. Decisions (LGR-D)

| id | question | decision |
|---|---|---|
| **LGR-D0** | the "click hits the wrong element" defect | **A global hit-test rule (§LGR4.1), independent of Focus and zoom:** inside a node's L2 footprint the node outranks any overlapping edge / badge; outside every node body an edge is selectable; badges are `pointer-events: none`. Ships in Slice 1. No node z-order change. |
| **LGR-D1** | what triggers focus? | **Selection**, gated by a **toolbar toggle, default off**. The toggle is a **global UI preference** (one `localStorage` key, like theme / locale), **not** per graph. Hover never triggers it. |
| **LGR-D2** | focus depth | **Fixed 1 hop in v1 — closed, not a tuning parameter.** A 1–2 hop control is an **explicit later follow-up**, not part of Slice 1. |
| **LGR-D3** | do expression `depends-on` links count as a hop? | **No, in v1 — closed.** The focus traversal is over the **drawn edge graph only** (no expression parsing). Parameter / Register nodes stay visible-but-dimmed and are selected directly. "Include expression dependencies" is a later follow-up shared with the module system's connection helper. |
| **LGR-D4** | filters — dim or hide? persisted? | **Hide** (removed from paint + hit path). Filter **selections** are **ephemeral** — in memory, cleared on every graph (re)load and by Reset view, not serialized, not undoable. The filter **panel** open/closed state is a global UI pref. |
| **LGR-D5** | keyboard graph-nav | v1: toggle shortcut + *select next / previous connected node*. Tab order unchanged. Deeper nav is a follow-up. |
| **LGR-D6** | run distinction — where does `evaluated` come from? | **Derived from the committed step result only** (+ the already-emitted playback stream). **No engine field, no new playback-builder field, no execution-path instrumentation.** Where "computed to zero" is not derivable, the element gets **no cue** (§LGR5.1). |
| **LGR-D7** | past-step cues | **Cleared each step.** The only accumulation is an **opt-in Activity overlay**, off by default, **never persisted**; window length + decay curve are a Slice-4a tuning detail. |
| **LGR-D8** | group frames — which models ship, when? | **Transient (session-only, in memory) in Slice 4a — fully specified here.** **Auto** frames in **Slice 4b** — the clustering algorithm + label generation are **their own detailed design pass**; this doc fixes only their boundary (§LGR6.3), not the algorithm. **Saved** frames in **Slice 5**, behind a **Frozen `loop-revision/N` cosmetic `frames` contract** (§LGR6.4). |
| **LGR-D9** | can a frame move its members? | **No** in v1 — a frame drags as a rectangle only. "Move the group" is a later layout feature. |
| **LGR-D10** | does anything here move / resize / reorder a node? | **Never** — including node z-order. (§LGR13.) |
| **LGR-D11** | does selecting / focusing / filtering move the viewport? | **Never.** Only an explicit "fit / frame selection" does, unchanged. |
| **LGR-D12** | mobile extent | Global hit-test rule **yes**; Focus + Filters **yes** (More sheet); frame **drawing** no; auto frames render once Slice 4b ships. |
| **LGR-D13** | where does view state live? | Sticky toggles: **one global `localStorage` blob**. Everything else (filter selections, focus selection, transient frames, activity tint): **in memory only**. Never GraphDoc / digest / Share / revision / `SimState`. Full table in §LGR3.4. |

Open (none block Slice 1): the 1–2 hop control and its default (follow-up); the
Activity-overlay window + decay constants (Slice 4a); per-phase readability
thresholds (§LGR10.12, recorded in Slice 1); whether a `transient` frame can be
renamed after creation (leaning: yes). The **entire auto-frame clustering +
naming design** is deferred to the Slice-4b pass, not listed here as a loose
end.

---

## LGR12. Implementation slices

1. **Global hit-test rule + focus + de-emphasis** — the node-over-edge /
   node-over-badge priority that holds with Focus **off** (§LGR4.1); then the
   selection-driven focus set (fixed 1-hop drawn-edge, `depends-on` excluded),
   the dim tier with badges hidden and the §VL7.1 required set exempt, the
   "dimmed node outside the set still clickable" walk gesture, the toggle +
   shortcut. Render / UI-only; no wire, no engine, no z-order change.
2. **Transient filters** — the edge-class / resource-type / node-kind panel,
   hide semantics, ephemeral selections (cleared on reload / Reset view), the
   panel's global open/closed pref.
3. **Run distinction** — the `evaluated` / `effective` two-weight cue, a pure
   read of the committed step result + the existing playback stream; the
   reduced-motion and forced-colors variants. **No engine or playback-builder
   field.**
4a. **Transient frames + activity overlay** — draw / label a session-only
   rectangle (in memory, no wire); **Clear frames**; the opt-in Activity
   overlay with its window + decay.
4b. **Auto group frames** — *needs its own detailed design pass first*
   (clustering algorithm, tie-breaks, determinism proof, label generation),
   inside the boundary of §LGR6.3. Not built from this doc alone.
5. **Saved group frames** — *only on demand*. A Frozen `loop-revision/N`
   cosmetic `frames` contract first (conservative-extension golden, defensive
   reader, `loop-workspace` unchanged), then the create / label / resize UI.
   **Not part of the first implementation PR.**

Each of Slices 1–4a is its own PR with its own §LGR10-shaped acceptance subset.

---

## LGR13. Scope boundary

- **No node re-layout.** A readability control never moves, resizes, or
  reorders a node. (Same line as §ER13.) Auto-layout of a selected region is
  the module-system pass (§PD8-B).
- **Not collapsible composite nodes / sub-graphs.** Those fold structure into
  one node and touch the wire contract — `docs/product-direction.md` §PD4 long
  term, not here.
- **Not the module / template system (B).** All of §PD8-B — packaging,
  surfaced inputs + Summary, the connection helper, the staged build flow, the
  localization overlay — is a separate pass.
- **Does not re-open** the Canvas Visual Refresh (§VL) or Simulation Playback
  (§PB). This composes with them; the run distinction is a new *weight* on the
  existing PB cue vocabulary, not a new choreography.
- **The engine decides everything.** The run distinction is a **pure read** of
  the committed step result + the already-emitted playback stream (§LGR5.1). It
  adds **no** engine field, **no** playback-event-builder field, and does **not
  instrument** the execution path. Where "computed to zero" is not derivable,
  the element simply gets no cue.
- **Auto-frame clustering** is out of scope for *this* doc — Slice 4b is its
  own design pass (§LGR6.3). This doc fixes only the boundary auto frames must
  honour.
- **Scenario Compare** is untouched.

---

## LGR14. Order this feeds into

Merges as *settled design, implementation pending*. Slice 1 starts after the
merge — render / UI-only, no `src/` wire change, no engine change. The small
module / template system (§PD8-B) is the **next** design pass after this one;
the focus / filter substrate from Slices 1–2 is a dependency of its assembly
screen. `Contextual inline help` (README, Onboarding part 2) comes after the
Productization track's structure is in place.
