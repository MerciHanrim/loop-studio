# Large-Graph Readability (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending.** rev 1. This doc fixes the
**behaviour contract** for reading and navigating a large model *before* any
implementation. It is a **non-frozen** design doc — no `loop-*/N` id, no
`Frozen` marker — and merges as *settled design, implementation pending*, like
[`docs/localization.md`](localization.md), [`docs/guided-tour.md`](guided-tour.md),
and [`docs/edge-routing.md`](edge-routing.md).

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
2. **Slice 1** — focus view + de-emphasis + pointer rules (render / UI-only);
3. **Slice 2** — transient filters;
4. **Slice 3** — the run distinction (`evaluated` vs `effective`);
5. **Slice 4** — auto group frames + transient (session) frames;
6. **Slice 5** — *saved* group frames, **only** behind a Frozen
   `loop-revision/N` cosmetic `frames` contract; deferred, revisited on demand.

Slices 1–4 carry no wire change and no engine change. Slice 5 does not start
until its contract is Frozen.

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

- a **focus view** — selection isolates a node and its direct connections
  (§LGR2);
- **de-emphasis + transient filters** — dim the out-of-focus remainder; hide by
  edge class / resource type / node kind (§LGR3);
- **pointer rules** — a de-emphasised or filtered element never intercepts a
  pointer event meant for a node (§LGR4);
- a **run distinction** — `evaluated` (the engine looked at this) vs `effective`
  (a non-zero transfer / change happened), as two weights on the existing
  playback cue vocabulary (§LGR5);
- a **past-step cue policy** — each step clears the previous; an opt-in activity
  overlay is the only accumulation (§LGR6-cues);
- **group frames** — the transient / auto / saved decision and the wire
  boundary; auto + transient ship now, saved is deferred behind a Frozen
  cosmetic contract (§LGR6);
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
**default off**, its state kept in `localStorage` per `projectId` (§LGR8-INV-4),
never serialized. When **on**, selecting one or more nodes puts everything
outside the *focus set* into the de-emphasis tier (§LGR3). Deselecting, pressing
`Esc`, or clicking empty canvas restores the full-strength canvas. Hover never
drives focus.

### LGR2.2 The focus set

Given the selected node(s), the focus set is:

- the selected node(s) themselves;
- every node reachable in **one edge hop** (resource, state, or dependency-hint
  edge), in either direction;
- the edges connecting them.

Depth is a fixed **1 hop** in v1; a 1–2 hop control is a Slice-1 tuning
parameter (`LGR-D2`). Whether an expression `depends-on` link (a Register
reading a Parameter with no drawn edge) counts as a hop-1 connection is
**open** — leaning **yes**, drawn with the dotted dependency-hint styling
(§VL6) — resolved in review (`LGR-D3`).

### LGR2.3 What "outside the focus set" keeps

De-emphasis dims; it never hides the [`docs/visual-language.md`](visual-language.md)
§VL7.1 **required set**. On a still-present, dimmed element these render at
**full strength**:

- selection & keyboard-focus rings;
- `invalid` / `▲!` conflict / `⃠` blocked flags;
- the run-in-progress cue (§LGR5).

You must still be able to see an error on a node you are not focused on.

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
nodes visible; hiding a node also hides its incident edges. Filters are
**transient view state** — not serialized, not in the undo stack, **reset on
reload** (`LGR-D4`); the panel's open/closed state is a `localStorage`
convenience.

### LGR3.3 Composition

Filter applies first (removes), then focus dims the remainder. Both are off by
default; either works without the other.

---

## LGR4. Pointer rules

- A **de-emphasised edge** and an **out-of-focus badge** are `pointer-events:
  none` — they never intercept a click meant for a node beneath or beside them.
- A **filtered-out** element is not in the DOM hit path at all.
- A **de-emphasised node is still clickable.** Selecting it recomputes the focus
  set around it — this is the core navigation gesture: you "walk" a large graph
  by clicking dimmed neighbours. The node hit target is never shrunk below its
  L2 footprint (§VL7.1).
- **Empty-canvas click** clears selection, which clears focus.
- **Keyboard:** Tab order is unchanged — reading order (§VL8); focus is a
  *visual* isolation, not a tab-scope change. v1 adds only: a shortcut to toggle
  Focus, and *select next / previous connected node* to step the selection along
  edges. Deeper keyboard graph-nav is a Slice-1 follow-up (`LGR-D5`).

---

## LGR5. The run distinction — `evaluated` vs `effective`

Today a resource edge carrying flow shows a travelling bead and an acting node
shows a "fired" glow (§VL6, [`docs/simulation-playback.md`](simulation-playback.md)).
On a large graph a step lights up too much at once. This pass splits the run cue
into **two weights**:

| Weight | Meaning | Cue |
|---|---|---|
| **`evaluated`** | the engine considered this element this step — an edge's flow expression was computed, a gate branch was weighed, a converter recipe was checked — but the result was **zero / no change** | a faint outline tick / low-opacity pulse; **no** travelling bead |
| **`effective`** | a **non-zero** transfer or state change happened here — resources moved, a pool value changed, a state event fired | the full "fired" glow + the bead / arrival cue (unchanged from PB) |

- A resource edge whose flow evaluated to `0` → `evaluated` only. A gate that
  sent all flow down one branch → the taken branch `effective`, the zero
  branch `evaluated`, an untouched branch neither.
- **Display only.** The distinction is derived from the **committed engine step
  result** plus the playback event stream (PB1: *the engine decides everything,
  the animation decides nothing*). It adds **no engine output**. Where
  "evaluated but zero" cannot be derived from the committed result alone, the
  gap is closed by a **display-only annotation on the playback event builder** —
  never an engine field, never a semantic-digest input (`LGR-D6`).
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

The **only** accumulation is an **opt-in activity overlay** (toolbar,
transient, **off by default**): while on, each element carries a low-opacity
tint proportional to how often it was `effective` over the last *K* steps,
decaying (`LGR-D7`, decay model tuned in Slice 4). It is a labelled readability
aid, not the run cue; view-only, never serialized; cleared on Reset, advanced
one step by Step.

### LGR6.1 Group frames — the three models

| Model | What it is | Persistence |
|---|---|---|
| **auto** | the app infers clusters (connected component, then a coarse deterministic spatial clustering) and draws labelled frames with generated names | **derived, never stored** — recomputed from the layout every time, like the orthogonal route map (§ER3.9) |
| **transient** | the user draws a rectangle around some nodes and labels it *for the session* | `localStorage` per `projectId`; **never** GraphDoc / digest / Share / revision; cleared by "reset view" |
| **saved** | the user creates / labels / resizes frames that survive reload, Share, and a Project revision | serialized — requires a wire contract (§LGR6.3) |

### LGR6.2 Decision

**Ship `auto` + `transient` in Slice 4. Defer `saved` to Slice 5, gated on a
Frozen contract.** Auto + transient deliver the scanning aid with **zero**
format risk. Saved frames are a real feature but not worth a wire amendment
until there is demand.

### LGR6.3 If `saved` is taken up — the wire boundary

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

### LGR6.4 What a frame is *not*

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
| **focus set** | the selected node(s) + their 1-hop neighbours + connecting edges (§LGR2.2) |
| **de-emphasis tier** | out-of-focus elements at `--deemphasis-opacity`, badges hidden, required set exempt (§LGR3.1) |
| **filter** | a transient hide by edge class / resource type / node kind (§LGR3.2) |
| **`evaluated` / `effective`** | the two run-cue weights (§LGR5) |
| **auto / transient / saved frame** | the three group-frame persistence models (§LGR6.1) |
| **activity overlay** | the opt-in cross-step `effective`-frequency tint (§LGR6-cues) |

---

## LGR8. Invariants (LGR-INV)

1. **View-only.** Focus, de-emphasis, filters, the activity overlay, and auto +
   transient frames produce **zero** change to the serialized GraphDoc, the
   `loop-revision/*` digest, `canUndo` / the undo stack, the engine step
   result, `R(t)`, state events, and the Monte-Carlo digest. Load every
   `examples/**`, toggle every control, run to the end — all byte-identical to
   before.
2. **Viewport untouched.** Selecting a node, toggling Focus, applying a filter,
   or drawing a frame never changes pan / zoom. Only an explicit "fit / frame
   selection" moves the viewport, unchanged from today.
3. **Workspace clean.** `loop-workspace/1` restore carries nothing about focus /
   filters / frames / activity. A stepped Workspace round-trips identically.
4. **Storage.** Every toggle state and every transient frame lives only in
   `localStorage`, keyed by `projectId`. A cleared `localStorage` loses exactly
   those and nothing else.
5. **Saved frames (Slice 5).** Touch only their own `loop-revision/N` cosmetic
   `frames` block: a graph that has never had a frame serialises and digests
   exactly as today. Cosmetic ⇒ never `engineAffecting`, never feeds `nConf`.
6. **Required set survives dimming.** De-emphasis / filter never removes the
   §VL7.1 required set from a still-present element — selection / focus rings,
   `invalid` / conflict / blocked flags, and the run cue stay full-strength on
   a dimmed node.
7. **Determinism.** The focus set and the auto-frame set are a pure function of
   (selection, graph, layout): identical across two fresh loads, after hover /
   select / zoom / pan / theme toggle / a sim step, and with the node array
   and edge array reversed on input (mirrors ER-INV-3).

---

## LGR9. Viewing conditions

- **Desktop** — toolbar controls for Focus, Filters, Auto-groups, Activity
  overlay.
- **Mobile (view / run)** — Focus-on-selection and Filters are in the More
  sheet and work; **frame *drawing* is desktop-only** (like editing); auto
  frames render; no horizontal document scroll.
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

1. **Invariance.** Load `mmo-progression.json`; snapshot serialized GraphDoc +
   `loop-revision/*` digest + `canUndo`. Toggle Focus, every Filter,
   Auto-groups, the Activity overlay; draw and delete a transient frame.
   Re-snapshot → byte-identical. Run to **end** with every control on — pool
   series / `R(t)` / state events / MC digest unchanged. (LGR-INV-1.)
2. **Focus set.** With Focus on, select a **mid**-lane combat node: exactly its
   1-hop neighbours + connecting edges are full-strength; all else
   de-emphasised; an `invalid` / blocked node elsewhere and a running cue stay
   visible. (LGR-INV-6.)
3. **Pointer.** With Focus on, clicking a de-emphasised neighbour selects it and
   recomputes the focus set; a de-emphasised edge and an out-of-focus badge do
   **not** intercept the click; empty-canvas click clears focus. (§LGR4.)
4. **Filter.** Hide `state` edges → every dashed edge and its `✳` / `≥…` / `±…`
   chips are gone; resource edges and node bodies intact. Hide resource-type
   *Gold* → only gold-typed pools / edges removed. Reload → all filters reset.
   (LGR-D4.)
5. **Run distinction.** At a step where a gate routes all flow to one branch,
   the taken branch shows `effective` + bead, the zero branch `evaluated` only
   (no bead), an untouched converter neither. (§LGR5.)
6. **Past-step.** Single-step from **mid**: step *N* cues are absent at *N+1*
   (no accumulation). Enable the Activity overlay; step 10× — tint builds on
   the busy hunt / loot edges, decays on idle ones; Reset clears it.
   (§LGR6-cues.)
7. **Auto frames.** On `mmo-progression.json` the three zone lanes surface as
   ≥ 3 frames with **stable labels** across two loads, a theme toggle, and a
   sim step; **no frame moves or resizes any node**. (LGR-INV-7, §LGR6.4.)
8. **Transient frame.** Draw a frame around the gold-economy nodes and label
   it; it survives an in-session reload of the graph view (`localStorage`); the
   serialized GraphDoc is unchanged; "reset view" clears it. (LGR-INV-1 / -4.)
9. **Mobile.** `mmo-progression.json` on the view / run layout — Focus +
   Filters work from the More sheet, there is no frame-draw affordance, no
   horizontal scroll, dimming is visible. (§LGR9.)
10. **`forced-colors` + `reduced-motion`.** Under `forced-colors: active`
    de-emphasis uses a non-opacity tell; under `prefers-reduced-motion: reduce`
    no animated transitions; `evaluated` vs `effective` still distinguishable.
    (§LGR9.)
11. **Readability proxy.** At start / mid / end, with Focus on and a combat node
    selected, the count of full-strength edges within the viewport is ≤ a
    documented per-phase threshold (a proxy for "traceable"). Thresholds are
    recorded in the slice, not asserted blind here.

---

## LGR11. Decisions (LGR-D)

| id | question | decision |
|---|---|---|
| **LGR-D1** | what triggers focus? | **Selection**, gated by a **toolbar toggle, default off**, state in `localStorage` per `projectId`. Hover never triggers it. |
| **LGR-D2** | focus depth | **1 hop** in v1; a 1–2 hop control is a Slice-1 tuning parameter. |
| **LGR-D3** | do expression `depends-on` links count as hop-1? | **Open — leaning yes**, drawn with the dotted dependency-hint styling. Resolved in review. |
| **LGR-D4** | filters — dim or hide? persisted? | **Hide** (removed from paint + hit path). **Transient**: not serialized, not undoable, reset on reload. |
| **LGR-D5** | keyboard graph-nav | v1: toggle shortcut + *select next / previous connected node*. Tab order unchanged. Deeper nav is a follow-up. |
| **LGR-D6** | run distinction — where does `evaluated` come from? | **Derived from the committed step result + playback event stream.** Where it can't be, a **display-only annotation on the playback event builder** — never an engine field, never a digest input. |
| **LGR-D7** | past-step cues | **Cleared each step.** The only accumulation is an **opt-in Activity overlay**, off by default, transient; decay model tuned in Slice 4. |
| **LGR-D8** | group frames — which models ship? | **`auto` + `transient` in Slice 4** (derived / `localStorage`, no wire). **`saved` deferred to Slice 5**, behind a **Frozen `loop-revision/N` cosmetic `frames` contract** (§LGR6.3). |
| **LGR-D9** | can a frame move its members? | **No** in v1 — a frame drags as a rectangle only. "Move the group" is a later layout feature. |
| **LGR-D10** | does anything here move / resize / reorder a node? | **Never.** (§LGR13.) |
| **LGR-D11** | does selecting / focusing / filtering move the viewport? | **Never.** Only an explicit "fit / frame selection" does, unchanged. |
| **LGR-D12** | mobile extent | Focus + Filters **yes** (More sheet); frame **drawing** no; auto frames render. |
| **LGR-D13** | where does view state live? | `localStorage` keyed by `projectId`; never GraphDoc / digest / Share / revision / `SimState`. |

Open (not blocking Slice 1): LGR-D3 (depends-on hops); the 1–2 hop control
default; the Activity-overlay decay constants; per-phase readability thresholds
(§LGR10.11); whether `auto` frame labels can be renamed in-session (leaning:
yes, as a transient frame override).

---

## LGR12. Implementation slices

1. **Focus + de-emphasis + pointer rules** — selection-driven focus set, the
   dim tier with badges hidden and the required set exempt, the
   `pointer-events` discipline, the "dimmed node still clickable" navigation
   gesture, the toggle + shortcut. Render / UI-only; no wire, no engine.
2. **Transient filters** — the edge-class / resource-type / node-kind panel,
   hide semantics, reset-on-reload, `localStorage` panel state.
3. **Run distinction** — the `evaluated` / `effective` two-weight cue from the
   committed step result + playback stream; the reduced-motion and
   forced-colors variants; the display-only playback-event annotation if
   derivation needs it.
4. **Auto + transient group frames** — deterministic clustering + generated
   labels (recomputed, never stored); user-drawn session frames in
   `localStorage`; the opt-in Activity overlay (here or a sub-slice).
5. **Saved group frames** — *only on demand*. A Frozen `loop-revision/N`
   cosmetic `frames` contract first (conservative-extension golden, defensive
   reader, `loop-workspace` unchanged), then the create / label / resize UI.
   **Not part of the first implementation PR.**

Each of Slices 1–4 is its own PR with its own §LGR10-shaped acceptance subset.

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
- **The engine decides everything.** The run distinction is derived from the
  committed step result; any hint it needs is a display-only field on the
  playback event stream, never an engine output or a semantic-digest input
  (§PB1).
- **Scenario Compare** is untouched.

---

## LGR14. Order this feeds into

Merges as *settled design, implementation pending*. Slice 1 starts after the
merge — render / UI-only, no `src/` wire change, no engine change. The small
module / template system (§PD8-B) is the **next** design pass after this one;
the focus / filter substrate from Slices 1–2 is a dependency of its assembly
screen. `Contextual inline help` (README, Onboarding part 2) comes after the
Productization track's structure is in place.
