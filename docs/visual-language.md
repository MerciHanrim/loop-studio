# Visual Language (non-frozen — living doc)

**Status: shipped in v0.6.0; kept as the living reference.** A
**non-behavioral** visual system for the canvas: node shape, colour, edge
style, badges, state cues, zoom levels, motion, and light/dark. It says how the
graph *looks* and how a visual cue maps to a model state — it does **not**
define what any model state means or how the engine computes it.

The Canvas Visual Refresh landed in three PRs — chrome / silhouettes / states,
then **edge class / direction / cues + motion**, then **zoom LOD + the
acceptance matrix**. The v0.6.0 scope is the *look* of edges and the *elision*
of detail, **not edge geometry**: edge paths stay on React Flow's Bézier route
(`getBezierPath`) and orthogonal routing is deferred (§VL6 "Routing"). The
sections below describe the shipped behaviour; anything still deferred is marked
so inline. Every semantic reference points out to a spec
(`→ SEMANTICS-*.md`, `→ loop-model/1`, `→ loop-expr/1`). Carries no `loop-*/N`
id; revised freely. §VL10–VL11 are the invariants against the GraphDoc /
offline posture; §VL12 the acceptance criteria; §VL13 the decision record;
§VL14 the order this feeds into.

This formalises and extends the **N1 "Vessel"** system already on the canvas
(`src/components/nodes/nodes.tsx`, `src/components/edges/LoopEdge.tsx`,
`src/index.css`). It is written so the later **Canvas Visual Refresh** slice can
bring every existing node/edge onto one grammar in a single pass.

> **Parameter / Register visuals are live.** `loop-expr/1` and `loop-model/1`
> are **Frozen** (`SEMANTICS-X.md`, `SEMANTICS-M.md`) and the model-language
> implementation has shipped, so the **appearance and state representation** of
> Parameter and Register nodes — their silhouettes (§VL2.1), the in-node layout
> (§VL2.4), the `invalid` treatment (§VL3), the display-grouping note (§VL5.4) —
> are **normative** and rendered on the real canvas. They are **first-class in
> the acceptance matrix** (§VL11.2 / §VL12), no dev flag. Rendering a Parameter
> or Register — like any other node — changes **no** GraphDoc byte,
> `loop-revision/*` digest, undo entry, or viewport (§VL10).

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
| **parameter** | a small rounded **tag with a notched left edge** — a knob you set. Non-colour tell vs register: the notch + a short stub "handle" on the notch side, and **no `=`**; the value sits in a slot, not after an equals sign |
| **register** | a narrow **lozenge with a leading `=` glyph** — a readout, not a container. Non-colour tell vs parameter: the `=` is always drawn (struck through when `invalid`, §VL3), the outline is a single unbroken lozenge with no notch and no stub |

Parameter and Register are visually **lighter** than the flow nodes — smaller,
thinner stroke, no resource/state handles (§M1.3 / §M2: they have no ports and
are never edge endpoints) — to read as *annotations on* the model rather than
*stages in* the flow. The two are told apart **without colour**: the parameter's
notch-and-stub silhouette vs the register's plain lozenge, and the register's
persistent `=` glyph vs the parameter's slotted value. Neither shares a
silhouette with any flow kind.

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
   name (§VL5). One chip per node. A node with a flow colour (issue #325,
   `docs/flow-colour-and-compact-nodes.md` FC-4.1) shows that colour on the
   chip, the faint hue wash and the L0 dot instead of the kind hue; the
   silhouette still carries the kind.

### VL2.3 Handles

Resource ports are the side circles (`out` right, `in` left); state ports are
the top/bottom `state-*` handles. Handle affordance (size, hit area, hover
halo) is unchanged from today; this doc does not touch connection behaviour.

**Parameter and Register have no handles at all** — no resource port, no state
port, no drag-to-connect affordance on any edge — because the model gives them
no ports and forbids them as edge endpoints (`→ SEMANTICS-M.md §M1.3`, `§M2`).
They participate only by being **referenced** from an expression.

### VL2.4 Parameter and Register — in-node layout

Fixed against the frozen model spec. Both use the §VL2.2 top-to-bottom order,
but only the rows below ever apply to them.

**Parameter** (`→ SEMANTICS-M.md §M1`):

1. **Title** — `data.label`. One line, ellipsized.
2. **Value** — `data.value`, the single semantic field: a finite number, large
   tabular figures, shown **whether or not a run is live** (it is a constant,
   not a per-step reading — §M1.1). A read-time-filled default reads `0` with the
   Inspector's `PARAM_VALUE_FIXED` notice; the node itself shows no error cue —
   **a Parameter is never `invalid`** (§M1.1), so it carries no struck-`=`, no
   `—`, no warning outline for its own state.
3. **Unit** — `data.unit` (already trim/NFC/≤24-byte normalised by the model,
   §M1.2), a short suffix in `--text-tertiary` next to the value (`4.5 gold`).
   Absent unit → value alone.
4. **Advisory-range tell** — when `min`/`max`/`step` are present and coherent,
   the value slot gets a thin **tick scale** underlay (min→max) with the current
   value marked; this is decoration of an advisory hint, never a clamp. When the
   stored `value` is outside `[min, max]` the mark sits at the clamped end of
   the scale **and** a small `▲!`-style advisory dot appears on the value (the
   Inspector shows `PARAM_VALUE_OUT_OF_RANGE`); the number itself is still shown
   **as stored, unclamped** (§M1.2). A hint the model dropped at read time
   (`PARAM_STEP_INVALID`, `PARAM_RANGE_INVALID`, `PARAM_UNIT_TOO_LONG` after
   truncation) produces **no** canvas cue — only the Inspector notice.
5. **Type chip** — §VL5.4 (display grouping only).

No capacity bar, no expression row, no primary-value-from-run row.

**Register** (`→ SEMANTICS-M.md §M2`, `§M3`):

1. **Title** — `data.label`.
2. **Computed value** — `R(currentStepIndex)` (§M3.5): the evaluation of the
   Register against the current committed snapshot. Large tabular figures,
   rendered through `data.format` (`int` rounds for display, `float` as-is,
   `percent` shows `value × 100 %`) — display only; the digested value is the
   raw number. Absent when no run is live, exactly like a pool's primary value.
3. **Invalid state** — when the model reports the Register `invalid` (§M3.4):
   the value area shows the neutral placeholder **`—`**, the leading `=` glyph
   is **struck through** (the §VL3 `invalid` layer), and the outline takes the
   `--warning` solid treatment. **No number is shown** — never `0`, never the
   last valid value (§M6.2). The Inspector carries the enumerated model **code**
   (`M_REG_PARSE` · `M_REG_EVAL` · `M_REG_UNKNOWN_REF` · `M_REG_WRONG_KIND` ·
   `M_REG_INVALID_ID` · `M_REG_CYCLE` · `M_REG_DEPENDS_ON_INVALID`) plus a
   message; the canvas shows only the placeholder + struck `=` (no code text on
   the node).
4. **Expression** — `data.expr` in `loop-expr/1` §X8 canonical form, one
   monospace line in `--text-tertiary`, ellipsized, **as written** (never
   evaluated or rewritten for display; a dangling `@id` after a delete stays
   visible — §M5). This is the §VL2.2 "key expression" row; for a Register it is
   **always** present (default `"0"`).
5. **Unit** — `data.unit`, same placement as Parameter.
6. **Type chip** — §VL5.4.

**Timeline** — a step index where the Register is `invalid` is a **gap**: no
series point, not a `0` and not an interpolated segment (§M6.2). When the
Register recovers, the series resumes at the next index with no bridge across
the gap. The timeline card marks the gap span with the same struck-`=` glyph in
its legend row so the gap is not misread as missing data.

**No content change from rendering.** Drawing either node — resting, invalid,
mid-run, at any zoom — mutates no GraphDoc field and moves no digest, undo
entry, or viewport (§VL10, VL-INV-1…6). A content change happens **only** when
the user actually adds or edits a Parameter / Register (VL-INV-6).

Each is an **additive** layer over the resting node. Colours are from
`--state-*`; every state also has a non-colour tell.

| State | Colour cue | Non-colour tell | Motion |
|---|---|---|---|
| **resting** | — | — | none |
| **hover** | `--line-strong` → slightly darker | 1 px outline grows | none |
| **selected** | `--state-selected` ring | 2 px ring, offset 2 px — drawn 2.5–4.5 px outside the silhouette, never a recolour of the outline (`docs/flow-colour-and-compact-nodes.md` FC-4.1) | none |
| **focus** (keyboard) | `--state-focus` ring | dashed ring, the **innermost** layer: 4.5–6 px inside the silhouette, inside the selected ring and inside a flow-colour band | none |
| **acted this step** ("fired") | `--state-fired` edge glow | a corner tick mark appears for the step | one 320 ms fade-in, then hold until the next step |
| **value changed** | `--state-fired` on the number | ▲ / ▼ glyph beside the value | number slides up/down ~320 ms (`→` §VL9) |
| **arrival** (a pool just received) | `--state-arrival` fill pulse at the `in` port | a small inbound chevron | one 320 ms pulse |
| **blocked** (acted-but-nothing-happened, e.g. a gated-closed passive) | `--state-warning` outline | a hollow ⃠ badge, top-right | none — steady until state clears |
| **conflict** (Review: this element differs base vs proposed vs yours) | `--warning` hatched outline | a ▲! badge; the Review panel lists it | none |
| **invalid** (a **Register** the model reports as `invalid` — parse / evaluate / unknown or wrong-kind / unreferenceable-id / cycle / depends-on-invalid, `→ SEMANTICS-M.md §M3.4`, `SEMANTICS-X.md §X7`) | `--warning` solid outline | the leading `=` glyph struck through; value shows `—` (**no number** — never `0`, never the last valid value, §M6.2); the enumerated `M_REG_*` code + message in the Inspector; a Timeline **gap** at every invalid step index | none — steady until the model clears it |

Stacking: rings (focus inside selected) < step cues (fired glow, value slide) <
persistent flags (blocked, conflict, invalid badges, always top-right, stacked
downward in that order).

Spatial order of the rings (issue #325, `docs/flow-colour-and-compact-nodes.md`
FC-4.1), from the inside out: the dashed focus ring, the flow-colour band (only
when the node has a flow colour), the neutral structure line on the silhouette,
the selection ring, and the dashed `invalid` ring outermost. Each is cut from
the silhouette at a fixed pixel distance, so all of them show at once and none
paints over another.

The **`invalid`** state applies **only to Register** nodes (`→ SEMANTICS-M.md
§M3`). A **Parameter is never `invalid`** (§M1.1): a bad `value` is read-time
filled to `0`, and a bad advisory hint (`min`/`max`/`step`/`unit`) is dropped
with an Inspector notice only — neither puts any error cue on the node.
`selected` / `focus` / `conflict` (Review) still apply to both kinds normally.

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

### VL5.4 Parameter / Register

Parameter and Register nodes may carry a type **for display grouping only** —
the type chip's hue + name (§VL5.1), nothing more. They have no ports and never
sit on a resource edge, so §VL5.3 mismatch does not apply to them and the model
emits no finding for them (`→ SEMANTICS-M.md §M4.1`: `resourceType` lives only
on a pool's `data` and a `resource` edge's `data`). If a build stores a type on
one of these nodes it is rendered as the chip and otherwise ignored.

---

## VL6. Edges

| Class | Line | Arrowhead | Selected | Label |
|---|---|---|---|---|
| **resource** | solid, `--edge-resource` or its flow colour, 1.5 px (+ type inner-stroke, §VL5.2) | filled triangle | keeps its colour, 2 px, over a translucent `--state-selected` underlay | flow chip (§VL4) |
| **state** | **dashed**, `--edge-state` or its flow colour, 1.25 px | small open triangle | keeps its colour, dashed 2 px, over the same underlay | `✳` / `≥…` / `±…` chip |

A flow colour (issue #325, `docs/flow-colour-and-compact-nodes.md` FC-4.2) is
the edge's rest colour on its line, its arrowhead and a 1 px border on its
label. Selection is the underlay, never a recolour; a satisfied activator keeps
its `--signal-primary` stroke over the colour, a route-invalid edge keeps its
`--warning` dash and flag, and run tokens keep their own colours.
| **dependency hint** (Review: "removing this node also removes/retargets this edge", `→ SEMANTICS-R.md §R7A.3`) | dotted, `--warning` | none | — | — |

- **Live flow** — while a resource edge carries flow this step, a bead travels
  source→target along the path in `--flow-strength`, leaving a fading
  `--flow-trail`. `prefers-reduced-motion` (§VL9): the bead is replaced by a
  static highlighted segment near the target end and the amount chip.
- **State effect** — a trigger fire / activator flip / label apply pulses the
  edge once (`--state-guide`), matching the node's step cue.
- **Routing** — *not in v0.6.0.* Edges stay on React Flow's bézier path
  (`getBezierPath`). Orthogonal routing (right-angle segments that step around
  nodes, rounded corners, parallel-edge fan-out, optional manual waypoints) is
  its own spec-first project — see [`docs/edge-routing.md`](edge-routing.md)
  (DRAFT). It is a pure render concern and must never edit `source` / `target`
  / handles.

---

## VL7. Zoom levels — information elision

The canvas has three detail levels, switched at fixed world-zoom thresholds —
`0.8` (L2 ↔ L1) and `0.45` (L1 ↔ L0). Elision **only hides supplementary
detail**. At **every** level a node keeps its position, its size, and its
silhouette, and an edge keeps its class and endpoints — a zoom change is a pure
fade of hidden elements, never a resize or a re-route (§VL12.5). The switch is a
pure function of zoom: a threshold round-trip restores the prior state exactly
(no hysteresis).

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

**Parameter / Register at each level.** Same rule as every other kind — the
§VL7.1 required set never drops:

| Level | Parameter also shows | Register also shows |
|---|---|---|
| **L2** | title, value + unit, advisory tick scale, type chip | title, computed value, `expr` line, unit, type chip; struck `=` + `—` when `invalid` |
| **L1** | title + value | title + computed value (or `—`); struck `=` kept when `invalid` |
| **L0** | silhouette only (notch + stub), type dot | silhouette only (lozenge + `=`), type dot; the `=` stays **struck** when `invalid` |

At **L0** both keep: the **role** silhouette (parameter's notch-and-stub vs
register's plain lozenge — the non-colour tell survives), the **`invalid`**
struck-`=` / `--warning` outline on a Register, the **selection / focus** rings,
and any **run-in-progress** cue. Only text — the number, the unit, the `expr`
line, the Inspector code — is elided. Neither node resizes or re-routes at a
threshold (they have no edges to route); their footprint and hit target are
byte-identical across L2/L1/L0 (§VL12.5).

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
  dashed), every §VL3 state (each has a shape/icon/motion tell), resource type
  (icon + chip text, not hue alone), and **parameter vs register** (notch-and-
  stub silhouette vs plain lozenge; the register's persistent `=` glyph, struck
  when `invalid`) — distinguishable in greyscale, under simulated
  deuteranopia / protanopia / tritanopia, and under `forced-colors: active`
  (the shape, the dash-free outline, and the `=` / struck-`=` all survive a UA
  colour override).
- **Focus** is always a visible indicator distinct from selection; tab order
  follows reading order. On the canvas it is the `--state-focus` ring (§VL3). In
  the shell it follows the family contract (Cozy Shelter tokens v1.1.0 §3), and
  the class is decided by whether the control normally **shows a boundary**:
  - **A — a visible boundary** (bordered buttons, the play-bar buttons, every
    bordered input and select, the view tabs, the mean toggle, the minimap
    toggle, the expression operator keys): the boundary itself takes
    `--line-focus`, a 3 px `--focus-halo` surrounds it, and there is no outline.
    The solid boundary carries the 3:1 obligation — measured 3.78–4.40 light,
    5.14–7.55 dark. The halo is an 18 % tint, 1.25:1 on its own, and is never
    the indicator.
  - **A-clipped** — the same control inside a box that clips (the series
    trigger and CSV in the one-row Timeline legend): an outer halo would be cut,
    so it is dropped and the solid indicator is thickened inward.
  - **B — no visible boundary** (ghost buttons, palette chips, menu and sheet
    rows, links, checkboxes, table cells, the reference-insert pill): the opaque
    2 px `--line-focus` outline of the global `:focus-visible` rule. When in
    doubt, B.
  - Under `forced-colors` the halo is dropped by the UA, so every selector that
    says `outline: none` is repeated **with the same specificity** to restore a
    real `Highlight` outline (inside the box for the clipped pair).
  `--focus-ring` / `--line-focus` is the SOLID colour (`--cs-accent` in light,
  Loop's own `#83a9e6` in dark). The family's `--cs-focus-ring` is the halo and
  must not be aliased onto it.
- **Shell tokens.** The light shell reads the family's `--cs-*` layer through
  Loop's own names: ground and sunken (one soft page surface — no warm grey is
  left, and depth is a boundary or an existing shadow, never a difference in
  colour temperature), canvas, panel / raised / overlay (one white), the
  hairline, the container line, primary and secondary ink, the solid focus
  colour, the halo and the overlay elevation. Dark is Loop's own palette — the
  family layer has no dark values. The **hover fill** is a role of its own,
  `--surface-hover` (a hovered or keyboard-focused row, chip or icon button),
  with its own values in both themes: it does not follow the sunken surface, so
  the rest / hover step did not shrink when sunken joined the family ground (a
  menu row steps by an RGB distance of 43 in light, 41 in dark; following
  sunken it would be 15). `--line-structure` is **not** a shell token:
  it is drawn only by the node silhouettes, the state handle, the chart axes,
  the minimap and plot frames and three non-interactive labels; a container's
  boundary is `--line-container` and a control's is `--line-control`.
  **What the shell may and may not move.** The functional token values (hues,
  edges, flow, signal, frame accents, states) are identical to what they were,
  pinned value by value in `e2e/shell-function-colours.spec.ts`, and the opaque
  data marks were measured pixel-identical. A translucent functional fill (a
  frame tint, the 4 % hue wash, the flow trail) composites over the shell
  background, so its rendered result can differ by up to 6 per channel in
  light: that is the background changing, not the functional colour. The
  canvas's information ink (node titles, edge-chip text, token counts) and its
  non-data structure — the dot grid (`--canvas-grid`) and the plot grids
  (`--chart-grid`) — follow the shell ink and hairline in light and keep their
  values in dark. The grids are SVG paint, which forced colours do not
  recolour, so under `forced-colors` each names a system colour by its role
  rather than letting a shell colour show through: the dot grid is a decorative
  position aid — as thousands of `GrayText` dots it would compete with the
  nodes and edges — so it is `Canvas` and is not seen; a plot grid is a line
  values are read against, so it is `GrayText`. Two radius axes: `--radius` (12 px) for
  containers, dialogs and popovers, `--control-radius` (8 px) for standard
  rectangular controls; compact controls (15–22 px tall chips, triggers, tabs,
  operator keys) keep their own 4–6 px — the class is the control's form.
- **Control boundary.** Any 1 px control border on a panel — the shared `.btn`
  (every variant that does not set its own border: plain, `--sm`, `--icon`),
  the PlayBar's `.pb-btn` and the Timeline's `.timeline__csv` — is
  `--line-control` at rest and `--line-control-hover` hovered, and keeps
  **≥ 3:1** against the surface behind it *and* against its own face, light and
  dark (WCAG 1.4.11). The face contrast is what makes the rule global rather
  than per surface: with `--line-structure` it was 1.86 (light) / 2.15 (dark)
  on every surface, and 1.78 / 1.65 / 1.86 / 1.51 against a panel / overlay /
  raised / sunken surface (desktop audit 2026-09-20; the mobile sheet found the
  same 1.78 on 2026-09-19). Measured minima with the control tokens, composited
  pixels, on the family shell (2026-10-01): light rest 3.92 (on a hovered row,
  `--surface-hover`) · 4.49 (sunken) · 4.82 (panel, overlay and face — one
  white), hover ≥ 7.04; dark rest 5.46 (face) ·
  5.98 (overlay) · 6.46 (panel), hover ≥ 7.67. Ghost is outside the contract and keeps its own pair — no
  border at rest, `--line-strong` hovered (an appearing edge, not a boundary
  that has to stay legible) — and primary keeps its `--signal-primary`. A
  disabled control is the WCAG exception (`opacity: .4`, `.pb-btn:disabled` →
  `--line-disabled`), not a 3:1 contract, and its token does not change on
  enable; under forced colours the UA owns the border
  (`ButtonBorder`, `Highlight` hovered, `GrayText` disabled). Pinned on
  composited pixels in `e2e/desktop-btn-boundary.spec.ts` (one control per
  surface token + PlayBar + Timeline, light / dark / forced) and
  `e2e/mobile.spec.ts` (the sheet buttons).
  **The other bordered controls** (2026-10-01) — Inspector fields and selects,
  the Monte-Carlo and author inputs, the language search, the share URL, the
  seed field, the distribution pool select and mean toggle, the view tabs, the
  minimap toggle, the expression operator keys and the reference-insert pill —
  drew `--line-structure` until the shell branch and are held to the same
  contract in `e2e/shell-control-boundary.spec.ts`: rest ≥ 4.14 light,
  ≥ 5.46 dark, hover `--line-control-hover`, and a disabled field drops to
  `--line-disabled` and the disabled ink so it reads as disabled. The
  thirteenth rule is the data-import dialogs' text and number inputs, paste
  area and selects: they were unstyled browser controls (white with black text
  in the dark theme too) and are shell controls now — the control boundary, the
  shell face and ink, class A focus — with their box unchanged (a 1 px border
  and 2 px 3 px padding in place of the browser's 2 px inset border and
  1 px 2 px padding). The inputs and the paste area take the 8 px control
  radius; the selects are 16–19 px tall, compact controls, and keep 6 px.
  `--line-control-hover` states its own value per theme; it does not read an
  ink token, so a shell ink change cannot shrink the rest / hover step.
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
- **The long-label fixture is LATIN-only — a role split, not a cut in
  multi-script support.** §MML1 wraps a long title in full (no ellipsis), so the
  whole string now reaches the pixel clip; a CJK / Cyrillic / emoji tail would
  then render with whatever glyphs the CI runner's OS fonts supply and stop
  being byte-deterministic between Windows builds. The pixel fixture
  (`e2e/canvas-refresh-visual.spec.ts`) therefore uses a long Latin string
  (bundled IBM Plex, identical everywhere) that still wraps to several lines,
  grows the vessel to its ceiling, and force-breaks an unbreakable token. The
  multi-script / CJK / Cyrillic / emoji stress case lives in
  `e2e/node-long-label.spec.ts` as a **DOM** test — full string kept on the
  element, no sideways spill, silhouette grows, handles re-centre — and never
  compares pixels.
- **Parameter / Register are in the committed matrix.** Their frames — `param`
  resting, `param` out-of-range, `register` valid mid-run, `register` `invalid`
  (each `M_REG_*` reason once), the Timeline gap — sit in the same {light, dark}
  × {desktop, mobile} × {L2, L1, L0} grid as every other kind. The Canvas
  Visual Refresh slices land them in three passes: chrome / silhouettes / states
  first, then edge & motion, then the full zoom × `forced-colors` matrix.
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

Machine-checkable, for the Refresh slice's E2E — the chrome/state/edge frames in
`e2e/model-nodes-visual.spec.ts` + `e2e/canvas-refresh-*.spec.ts`, and the
committed pixel matrix in `e2e/canvas-refresh-visual.spec.ts`:

1. **Snapshot matrix** — a committed screenshot for every cell of
   {light, dark} × {desktop, mobile} × {L2, L1, L0} over one long-content
   fixture (a long Latin label that wraps full-height with an unbreakable-token
   tail — see §VL11.2 for why not multi-script — large + negative values, unit,
   an `invalid` Register, a selected + keyboard-focused node, a resource and a
   state edge, a live run cue), plus a `forced-colors: active` frame at L2 and
   L0. The multi-script / CJK / Cyrillic / emoji long label is covered from the
   DOM in `e2e/node-long-label.spec.ts`, not here. Non-deterministic chrome (the build stamp) is outside the `.react-flow`
   clip; the minimap + attribution are masked; fonts are awaited and the
   single-shot run cue is frozen before the shot. Tolerance and platform
   pinning as for the existing Distribution snapshots.
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
11. **Parameter / Register are first-class in the matrix.** Their appearance
    and state representation (§VL2.1, §VL2.4, §VL3, §VL5.4) are rendered on the
    real canvas and covered by criteria 1–10 like every other kind — no dev
    flag, no provisional fixture. The `invalid` state (Register only — a
    Parameter is never `invalid`) is drawn as a `--warning` **dashed** outline
    plus a corner `!` flag, so it is identifiable with hue stripped and under
    `forced-colors`; the value area shows `—`, never `0` or a stale value.

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
- **VL-D4 — Parameter / Register are live and first-class.** `loop-expr/1` /
  `loop-model/1` are Frozen and the model-language implementation has shipped:
  the silhouettes (§VL2.1), in-node layout (§VL2.4), the `invalid` treatment
  (§VL3, Register only — a Parameter is never `invalid`), zoom behaviour
  (§VL7.2), and the display-grouping note (§VL5.4) are **normative** and
  rendered on the real canvas, in the committed acceptance matrix like every
  other kind — **no dev flag, no provisional fixture**. Rendering these nodes
  changes **no** GraphDoc byte, `loop-revision/*` digest, undo entry, or
  viewport (§VL10).
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

1. **This doc — Visual Language draft** (here). ✔ merged; Parameter / Register
   appearance fixed in this follow-up.
2. `loop-model/1` + `loop-expr/1` — Parameter / Register semantics, expression
   grammar & evaluation. ✔ **Frozen** (`SEMANTICS-M.md`, `SEMANTICS-X.md`).
3. `loop-revision/2` (with the "Workspace stays v1" note, `→ SEMANTICS-M.md
   §M8.2`) — new node kinds and expression fields in the canonical projection /
   semantic digest. **Draft** — the remaining pre-implementation spec.
4. Merge `loop-revision/2`; verify merge-commit CI.
5. `chore/open-0.6.0-dev`.
6. Implementation slices: **model language → Canvas Visual Refresh** (this doc
   made real). Scenario Compare is **out of the confirmed v0.6.0 scope** — it
   needs its own spec/design PR and a separate go decision after the Refresh.
