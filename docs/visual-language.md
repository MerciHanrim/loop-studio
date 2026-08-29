# Visual Language (non-frozen — DRAFT)

**Status: draft for review.** A **non-behavioral** visual system for the
canvas: node shape, colour, edge style, badges, state cues, zoom levels,
motion, and light/dark. It says how the graph *looks* and how a visual cue maps
to a model state — it does **not** define what any model state means or how the
engine computes it. Every semantic reference points out to a spec
(`→ SEMANTICS-*.md`, `→ loop-model/1`, `→ loop-expr/1`). Carries no `loop-*/N`
id; revised freely. §VL10–VL11 are the invariants against the GraphDoc /
offline posture; §VL12 the acceptance criteria; §VL13 the decision record;
§VL14 the order this feeds into.

This formalises and extends the **N1 "Vessel"** system already on the canvas
(`src/components/nodes/nodes.tsx`, `src/components/edges/LoopEdge.tsx`,
`src/index.css`). It is written so the later **Canvas Visual Refresh** slice can
bring every existing node/edge onto one grammar in a single pass.

> **Provisional.** Parameter and Register visuals (their silhouettes in §VL2.1,
> the display-grouping note in §VL5.4, and the `invalid` row in §VL3) are marked
> *provisional pending `loop-model/1`*. Their shapes, badges,
> and the `invalid` treatment are sketches to be confirmed once the model spec
> is drafted; nothing here fixes them.

---

## VL0. Principles

1. **Shape carries role; colour classifies; motion says "now".** The outer
   silhouette tells you what a node *is*. Type hue appears only in small
   areas — a chip, a compact dot, a chart mark — **never** as a fill. The
   mineral signal (`--signal-primary`) is reserved for what is *alive this
   step*: flow in transit, a node that acted, a value that just changed.
2. **One cue per meaning.** Selection, focus, "acted this step", "blocked",
   "invalid", and "conflict" are visually distinct and never share a colour or
   a motion. A node can show several at once without ambiguity.
3. **Legible without colour.** Every state that matters is also carried by
   shape, line style, an icon, or a position/label change, so the canvas reads
   under any colour-vision deficiency and in greyscale.
4. **Detail follows zoom.** Zoom out and the canvas sheds *supplementary*
   detail in a fixed order (§VL7) so a large graph stays scannable; it never
   *rearranges*, and it never hides the **required set** — role silhouette,
   edge class + direction, selection/focus, error/conflict/blocked flags,
   run-in-progress, and the accessible name + hit target (§VL7.1).
5. **Same information hierarchy in light and dark.** The two themes differ in
   surface and shadow, not in what is emphasised (§VL8).
6. **Calm by default.** Motion is short, purposeful, and fully suppressible
   (§VL9). Nothing loops or pulses while the simulation is paused.

---

## VL1. Canvas surface

- **Background** `--surface-canvas`; an optional dot/line **grid** at a fixed
  world spacing, drawn in `--line-hairline`, that fades out below §VL7's L2
  zoom. The grid is a visual aid only — it does **not** snap or constrain
  positions (position is authoritative graph data, `→ SEMANTICS-R.md §R4`).
- **Alignment & spacing helpers** (align edges, distribute, match gaps) act on
  the current selection and are undo-tracked like any move. They change
  `position` only; no automatic layout runs behind the user's back.
- **Charts / analysis** (timeline, distribution) sit as **floating cards** over
  the canvas corner, not as a docked region — dismissible, movable, with the
  same surface (`--surface-panel`) and elevation as a dialog. A card names the
  data it shows and the step range.

---

## VL2. Nodes — the Vessel system

### VL2.1 Silhouettes (unchanged from N1)

viewBox `120×64`, `vector-effect: non-scaling-stroke`. The path encodes the
role; it is filled with `--surface-raised` (light) and outlined in
`--line-strong`.

| Kind | Reading of the shape |
|---|---|
| **pool** | a tank — flat-ish top, tapered sides (holds a quantity) |
| **source** | a wedge pointing **out** (produces) |
| **drain** | a wedge pointing **in** (consumes) |
| **gate** | a diamond (routes / decides) |
| **converter** | a bow-tie (in one side, out the other) |
| **end** | a rounded capsule (terminal) |
| **parameter** *(provisional)* | a small rounded tag with a notched left edge (a knob you set) |
| **register** *(provisional)* | a narrow lozenge with a `=` mark (a readout, not a container) |

Parameter and Register are visually **lighter** than the flow nodes — smaller,
thinner stroke, no handles on the resource ports — to read as *annotations on*
the model rather than *stages in* the flow.

### VL2.2 Inside the node

Top to bottom, shown/hidden per §VL7:

1. **Title** — the label. One line, ellipsized. `--text-primary`.
2. **Primary value** — the number the node is "about" while a run is live:
   pool count, source/drain amount this step, gate split, register result.
   Large, tabular figures. Absent when no run is live (`→ SEMANTICS.md`).
3. **Capacity / bound** — `n / cap` when a pool has a finite capacity; a thin
   fill bar under the value tracks `value ÷ cap`. Uncapped pools show the value
   alone.
4. **Key expression** — for nodes that carry one (register always; provisional
   for gate/source/converter once `loop-expr/1` is adopted there), a single
   monospace line of the expression **as written**, ellipsized, in
   `--text-tertiary`. It is display text, not evaluated here.
5. **Type chip** — a 10–12 px pill in the node's hue with the resource-type
   name (§VL5). One chip per node.

### VL2.3 Handles

Resource ports are the side circles (`out` right, `in` left); state ports are
the top/bottom `state-*` handles. Handle affordance (size, hit area, hover
halo) is unchanged from today; this doc does not touch connection behaviour.

---

## VL3. Node states

Each is an **additive** layer over the resting node. Colours are from
`--state-*`; every state also has a non-colour tell.

| State | Colour cue | Non-colour tell | Motion |
|---|---|---|---|
| **resting** | — | — | none |
| **hover** | `--line-strong` → slightly darker | 1 px outline grows | none |
| **selected** | `--state-selected` ring | 2 px ring, offset 2 px | none |
| **focus** (keyboard) | `--state-focus` ring | dashed ring **inside** the selected ring | none |
| **acted this step** ("fired") | `--state-fired` edge glow | a corner tick mark appears for the step | one 320 ms fade-in, then hold until the next step |
| **value changed** | `--state-fired` on the number | ▲ / ▼ glyph beside the value | number slides up/down ~320 ms (`→` §VL9) |
| **arrival** (a pool just received) | `--state-arrival` fill pulse at the `in` port | a small inbound chevron | one 320 ms pulse |
| **blocked** (acted-but-nothing-happened, e.g. a gated-closed passive) | `--state-warning` outline | a hollow ⃠ badge, top-right | none — steady until state clears |
| **conflict** (Review: this element differs base vs proposed vs yours) | `--warning` hatched outline | a ▲! badge; the Review panel lists it | none |
| **invalid** *(provisional — register cycle / bad expression, `→ loop-model/1` / `loop-expr/1`)* | `--warning` solid outline | a struck-through `=` on the node; value shows `—`; a diagnostic in the Inspector | none |

Stacking: rings (focus inside selected) < step cues (fired glow, value slide) <
persistent flags (blocked, conflict, invalid badges, always top-right, stacked
downward in that order).

**Run controls do not restyle nodes.** `running` vs `paused` vs `ended` is
shown by the run bar and the timeline head, not by the nodes.

---

## VL4. Badges

Small, fixed-size chips attached to a node corner or an edge midpoint. At most
**one badge per corner**; overflow collapses to a `•••` chip that expands in
the Inspector.

| Badge | Where | Shows | Style |
|---|---|---|---|
| **value / capacity** | in-node (§VL2.2) | `n` or `n / cap` + fill bar | not a chip — part of the node body |
| **expression** | in-node, or edge midpoint for edge exprs | the source text, ellipsized | monospace, `--text-tertiary`, no border |
| **flow** | resource edge midpoint | the flow amount as written (`2`, `1-3`, `2D6`) | solid chip, `--edge-resource` text on `--surface-canvas` |
| **probability / condition** | state edge midpoint | `✳` trigger, `≥…` activator, `±…` label — the expr as written | dashed-border chip |
| **warning** | node top-right | `⃠` blocked · `▲!` conflict · struck `=` invalid | see §VL3 |
| **resource-type mismatch** | edge midpoint | a small ⚠ + the two type names on hover | advisory only — the edge is **not** dimmed or blocked. *When* a pairing counts as a mismatch is `loop-model/1`'s call, not this doc's (§VL5.3) |

Badges never overlap the silhouette outline; they sit just outside it.

---

## VL5. Resource Type — advisory

`→ loop-model/1` will define resource types — the field structure, how a
**mismatch** is judged, and whether/how a type is carried in the canonical
projection (`→ loop-revision/2`). This doc fixes **none** of that. Here, *given*
that a resource type exists on an element, the visual rules are:

- it drives **colour, icon, legend, and Inspector warnings**;
- it **does not** change any number, delete a connection, or block a run;
- it is **advisory** in v0.6.0 (VL-D3).

### VL5.1 The set (initial)

| Type | Hue token | Icon (line, 12 px) |
|---|---|---|
| Gold / currency | warm amber | coin |
| Energy / stamina | teal-green | bolt |
| XP / progress | violet | upward chevrons |
| Player / population | blue | person |
| Item / stock | neutral brown | box |
| *(untyped)* | `--line-structure` | — |

Hues are low-chroma, chosen for ≥3:1 against `--surface-canvas` and mutual
distinctness under deuteranopia/protanopia; the **icon** is the primary carrier
so the set works in greyscale. The exact palette is tuned in the Refresh slice
against the accessibility checks in §VL8.

### VL5.2 Where the type shows

- **Node type chip** (§VL2.2) — hue fill + name.
- **Resource edge** — a 2 px inner stroke in the type hue alongside the
  `--edge-resource` line; the arrowhead takes the hue. Untyped edges are
  unchanged.
- **Legend card** — a floating card listing the types present in the graph
  with counts; toggled from the toolbar.
- **Chart series** — a pool's series takes its type hue where unambiguous.

### VL5.3 Mismatch — display only

**What counts as a mismatch is defined in `loop-model/1`, not here.** When the
model reports one for an element, the canvas shows the **resource-type
mismatch** badge (§VL4) at that edge and the Inspector lists it; nothing else
changes — the line keeps its normal weight, the run proceeds. The Inspector's
mismatch list is presented in a **stable order** so its rendering is
deterministic (§VL10); the ordering key is a UI choice, not a wire rule.

### VL5.4 Parameter / Register *(provisional)*

Parameter and Register nodes may carry a type for display grouping only; they
never sit on a resource edge, so §VL5.3 does not apply to them.

---

## VL6. Edges

| Class | Line | Arrowhead | Selected | Label |
|---|---|---|---|---|
| **resource** | solid, `--edge-resource`, 1.5 px (+ type inner-stroke, §VL5.2) | filled triangle | `--edge-selected`, 2 px | flow chip (§VL4) |
| **state** | **dashed**, `--edge-state`, 1.25 px | small open triangle | `--edge-selected`, dashed 2 px | `✳` / `≥…` / `±…` chip |
| **dependency hint** (Review: "removing this node also removes/retargets this edge", `→ SEMANTICS-R.md §R7A.3`) | dotted, `--warning` | none | — | — |

- **Live flow** — while a resource edge carries flow this step, a bead travels
  source→target along the path in `--flow-strength`, leaving a fading
  `--flow-trail`. `prefers-reduced-motion` (§VL9): the bead is replaced by a
  static highlighted segment near the target end and the amount chip.
- **State effect** — a trigger fire / activator flip / label apply pulses the
  edge once (`--state-guide`), matching the node's step cue.
- **Routing** — the Refresh slice adds light orthogonal-ish routing with
  rounded corners and small offsets so parallel edges between the same pair
  fan out instead of overlapping. Routing is a render concern; it never edits
  `source` / `target` / handles.

---

## VL7. Zoom levels — information elision

The canvas has three detail levels, switched at fixed world-zoom thresholds
(today: one threshold at `0.6` for both node compaction and edge labels; the
Refresh slice splits it into two). Elision **only hides supplementary detail**.
At **every** level a node keeps its position, its size, and its silhouette, and
an edge keeps its class and endpoints — a zoom change is a pure fade of hidden
elements, never a resize or a re-route (§VL12.5).

### VL7.1 The required set — never hidden at any zoom

- **role** — the kind-distinguishing silhouette;
- **edge class + direction** — solid vs dashed, and the arrowhead's direction
  (its *decoration* may simplify, its orientation may not);
- **selection & keyboard focus** — the rings (§VL3);
- **error / conflict / blocked** — the `invalid` / `▲!` / `⃠` flags (§VL3);
- **run-in-progress** — the step "fired" glow and the flow bead;
- **accessible name & hit target** — the node's name is on the element for AT
  and its clickable area does not shrink below the L2 footprint.

### VL7.2 What each level *adds* on top of the required set

| Level | Zoom (approx) | Nodes also show | Edges also show |
|---|---|---|---|
| **L2 — detail** | ≥ 0.8 | title, value, capacity bar, key expression, type chip, all badges | flow / condition chip, type inner-stroke |
| **L1 — compact** | 0.45–0.8 | title + value; type as a dot | type inner-stroke |
| **L0 — map** | < 0.45 | type dot only (no text) | type inner-stroke only |

Grid fades out entering L1.

---

## VL8. Light / Dark & accessibility

- **Tokens only.** Every colour on the canvas is a `--*` token defined for
  `:root` (light) and redefined under the dark blocks — no literal colours in
  component styles. The Refresh slice audits this.
- **What changes between themes:** surface (`--surface-*`), line weights'
  apparent contrast, and elevation (light uses a faint drop shadow; dark drops
  it and leans on surface contrast). **What does not change:** which element is
  emphasised, the hue *identities* (a Gold edge is recognisably the same hue in
  both), and the state→cue mapping.
- **Contrast** is held to the numeric floors in §VL11.2 and checked
  automatically (§VL12.10).
- **Non-colour redundancy** is mandatory for: resource vs state edge (solid vs
  dashed), every §VL3 state (each has a shape/icon/motion tell), and resource
  type (icon + chip text, not hue alone).
- **Focus** is always a visible ring distinct from selection; tab order follows
  reading order.
- **`forced-colors` / high contrast:** when the UA overrides colours, the §VL7.1
  required set stays distinguishable (shape, dash, icon, ring); the app does not
  fight the override.

---

## VL9. Motion

- **Durations:** step cues ~320 ms; hover/selection transitions ~120 ms; the
  flow bead's travel scales with the run speed slider. Nothing animates while
  `status === 'paused' | 'idle'` except a direct user action (select, hover,
  drag).
- **`prefers-reduced-motion: reduce`** (already honoured for edges): no
  travelling bead (static segment instead), no number slide (instant swap with
  the ▲/▼ glyph kept), no pulse (instant colour change held for one step),
  no card slide-in. All *information* is preserved; only the animation is
  dropped.
- Motion never conveys information that isn't also in a static frame.

---

## VL10. The Refresh does not touch the GraphDoc

Re-rendering an existing file in the new visual system is a **pure view
change**. Opening or scrolling a graph must never make a revision `dirty` or
mint a migration.

- **VL-INV-1** — no stored field is auto-changed by rendering: node `position`,
  `label`, and any size/measurement field are left exactly as saved.
- **VL-INV-2** — the new silhouettes do **not** re-fit or nudge saved
  `position`s; a node drawn with a different outline keeps its coordinate.
- **VL-INV-3** — opening a document creates **no** auto-migration commit and
  **no** undo entry.
- **VL-INV-4** — for any pre-Refresh file, the GraphDoc bytes and the
  `loop-revision/1` `fullContentDigest` are **identical** before and after the
  Refresh ships.
- **VL-INV-5** — no automatic `fitView` and no viewport re-save on open (the
  one exception already specified is mobile rotation, `→ docs/mobile.md`).
- **VL-INV-6** — a content change happens **only** when the user actually adds
  or edits a Parameter / Register / Resource Type, and only then under the new
  model version (`→ loop-model/1` / `loop-revision/2`).

---

## VL11. Assets, offline & deterministic snapshots

The visual system must not break the local / offline / deterministic posture.

### VL11.1 Assets

- Icons and fonts are **bundled** or served from `public/` — **no runtime CDN
  request**, ever (same rule as the rest of the app; `→ docs/pwa.md`).
- Every visual asset is inside the Production **precache closure**
  (`check:pwa-closure`) and inside the **portable** single-file build.
- Icons ship as inline SVG or a bundled sprite, not as separate network fetches
  at render time.

### VL11.2 Deterministic snapshots

- Tests freeze the animation phase or disable motion; a screenshot for a fixed
  **graph × sim state × theme × zoom** is byte-deterministic (modulo the
  approved pixel tolerance).
- **Snapshot matrix:** {light, dark} × {desktop, mobile} × {L2, L1, L0} over a
  fixed fixture, plus the per-state and per-edge-class frames from §VL12.
- Verified environments: `prefers-reduced-motion: reduce`, keyboard-focus
  visible, and `forced-colors` / high-contrast (the required set of §VL7.1 must
  still be distinguishable when the UA overrides colours).
- **Contrast is numeric, not eyeballed:** node outline & body text ≥ 4.5:1 on
  their surface; edge lines & state-indicator strokes ≥ 3:1 on
  `--surface-canvas`; type hues ≥ 3:1 and mutually ≥ some ΔE floor under
  simulated deuteranopia / protanopia / tritanopia. The exact numbers are
  pinned in §VL12 and checked.

---

## VL12. Acceptance criteria

Machine-checkable, for the Refresh slice's E2E (`e2e/visual.spec.ts` +
snapshots):

1. **Snapshot set** — one committed screenshot per: each node kind at L2 resting
   (light + dark); each §VL3 state on a pool at L2; a resource edge and a state
   edge at L2 with labels; the three zoom levels of a fixed 6-node fixture;
   reduced-motion vs normal on a mid-run frame. Full **matrix** per §VL11.2.
   Tolerance and platform pinning as for the existing Distribution snapshots.
2. **No off-canvas UI** — at every supported width (desktop + the mobile
   View/Run widths, `→ docs/mobile.md`), every floating card, legend, and badge
   has its bounding box fully within the viewport; the document never scrolls
   sideways.
3. **Token purity** — a check (script, like `check:mobile-query`) asserts no
   literal `#rgb` / `rgb()` colour in `src/components/nodes/**`,
   `src/components/edges/**` — only `var(--*)`.
4. **Colour-blind & forced-colors redundancy** — for a fixture containing every
   node state and both edge classes, each is distinguishable with hue stripped
   **and** under `forced-colors: active` (class name / shape / dash presence /
   icon in the DOM/SVG carries the non-colour tell).
5. **Zoom keeps the required set, and the canvas does not jump** — going
   L2 → L1 → L0: the §VL7.1 required-set elements stay present at every level;
   only *supplementary* text/badge elements disappear; and node bounding boxes,
   silhouette paths, positions, and edge endpoint coordinates are
   **byte-identical** across the three levels (no resize, no re-route at a
   threshold).
6. **Reduced-motion parity** — with `prefers-reduced-motion`, a mid-run DOM
   snapshot contains the same information nodes/edges (values, ▲/▼ glyphs,
   amount chips, state badges, required-set flags) as the normal frame; only
   animation properties/classes differ.
7. **Light/Dark parity** — the set of emphasised elements (rings, badges,
   fired glow targets) is identical between themes for the same graph state.
8. **GraphDoc untouched** — load each `examples/**` graph, render it, pan and
   zoom, and assert the serialized GraphDoc and its `loop-revision/1` digest are
   byte-identical to before; `canUndo` is unchanged; no autosave write fired
   (VL-INV-1…6).
9. **Assets are offline-safe** — `check:pwa-closure` still passes with the new
   assets; the portable build contains them; a test with the network blocked
   renders every node kind, both edge classes, and every icon from cache.
10. **Contrast thresholds** — an automated check computes the §VL11.2 contrast
    ratios for the token pairs actually used and fails below the floor.
11. **Provisional isolation** — nothing in Parameter/Register rendering is
    referenced by the acceptance snapshots until `loop-model/1` is frozen;
    their nodes render behind a dev flag in this milestone.

---

## VL13. Decisions & scope

- **VL-D1 — non-behavioral.** This doc fixes appearance and the visual↔state
  map only. Any statement about *when* a state occurs, what an expression
  evaluates to, or what a resource type permits lives in a spec, not here.
- **VL-D2 — extend N1, don't restart.** The Vessel silhouettes, the hue-in-
  small-areas rule, and the mineral-signal-for-"now" rule are kept. The Refresh
  slice migrates existing nodes/edges onto the full grammar; it does not
  redesign the shapes.
- **VL-D3 — Resource Type is advisory in v0.6.0, and this doc fixes only its
  *look*.** Colour / icon / legend / Inspector warning; computation-neutral,
  validation-assist. The field structure, the mismatch rule, and any canonical
  / digest inclusion are `loop-model/1` + `loop-revision/2` decisions, not this
  doc's. Hard type validation is a later, separate spec.
- **VL-D4 — Parameter / Register visuals are provisional.** Shapes, the `=`
  readout, and the `invalid` treatment are sketches pending `loop-model/1`;
  they render behind a dev flag and are excluded from acceptance snapshots
  until that spec freezes.
- **VL-D5 — charts float, they don't dock.** The timeline/distribution move
  from a docked region to dismissible floating cards as part of the Refresh.
- **VL-D6 — routing is render-only.** Any edge routing / label placement added
  never mutates graph data (`source` / `target` / handles / `position`).
- **VL-D7 — desktop and mobile share this grammar.** The mobile View/Run layout
  (`→ docs/mobile.md`) applies the same node/edge/state visuals; only the
  chrome around the canvas differs.
- **VL-D8 — the Refresh is a view change, not a data migration** (§VL10). No
  existing GraphDoc / `loop-revision/1` digest moves because of it.
- **VL-D9 — every visual asset is offline-safe** (§VL11.1): bundled or
  `public/`, in the precache closure and the portable build, no runtime CDN.
- **VL-D10 — zoom never hides the required set** (§VL7.1) and never resizes /
  re-routes at a threshold (§VL12.5).

## VL14. Order this feeds into

1. **This doc — Visual Language draft** (here).
2. `loop-model/1` + `loop-expr/1` drafts — Parameter / Register semantics,
   expression grammar & evaluation.
3. `loop-revision/2` (and a check on `loop-workspace/2`) — new node kinds and
   expression fields in the canonical projection / semantic digest.
4. Freeze the specs; merge the docs PR.
5. `chore/open-0.6.0-dev`.
6. Implementation slices: model language → **Canvas Visual Refresh** (this doc
   made real) → Scenario Compare.
