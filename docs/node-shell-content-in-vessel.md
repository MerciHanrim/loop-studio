# Node shell — content inside the drawn vessel

**Status: fixed** (vertical: #167; curved corner: follow-up). A rendering-layer
defect in `NodeFrame` (`src/components/nodes/nodes.tsx`): a node's content
(chip · title · value · `= expr` sub) could sit a few px **outside** the drawn
vessel outline — most visibly on every result-bearing **Register** (title
straddling the top edge, `= @pool…` hanging below), at every zoom and in every
example. #167 fixed the vertical overhang; the **"Follow-up — the CURVED
corner"** section below closes the horizontal case at the rounded ends.

## Cause

`NodeFrame` draws the vessel from a per-kind SVG path in a `0 0 120 H` viewBox
that fills the node's bounding box, but each path **insets its own top and
bottom caps** — the straight run starts a fixed number of px in from each edge,
so the *visible* capsule is shorter than the box:

| kind | path spans (at any `H`) | `VESSEL_INSET_Y` |
|---|---|---|
| pool | `y 6 … H−6` | 12 |
| source · drain · converter · end | `y 8 … H−8` | 16 |
| gate | `y 3 … H−3` (diamond) | 6 |
| **parameter · register** | `y 12 … H−12` | **24** |

At the historic `BASE_NODE_H = 64` the Parameter / Register capsule is only
**40 px** tall inside the 64 px box. `.nodef__body` centres `.nodef__stack` in
the **full box**, so a stack taller than ~40 px (a Register is chip+title ≈ 16 +
value ≈ 21 + `= expr` sub ≈ 15 ≈ **54 px**) overhangs the outline ~7 px at each
end. The box only grew when the **title wrapped to two lines**
(`oneLine ? BASE_NODE_H : …`), never for a tall single-line stack.

## Fix

`boxH` is driven by the **measured** `.nodef__stack` height plus the kind's
vessel inset plus a minimum clear gap top and bottom:

```
boxH = clampNodeHeight(kind, stack.offsetHeight + VESSEL_INSET_Y[kind] + 2·VESSEL_MIN_PAD_Y)
```

`VESSEL_MIN_PAD_Y = 4` (design px, each side). `clampNodeHeight` still floors at
`BASE_NODE_H` and ceils at `MAX_NODE_H[kind]`, so a short node — Source, Drain,
Gate, a plain Pool — is **byte-identical** to before (still a 64 px box,
snapshot-stable). Only nodes whose content genuinely exceeds the base grow:

| | before | after |
|---|---|---|
| Register | 64 (spills ±7 px) | 86 · 102 with a wrapped / tall label |
| Parameter + unit | 64 (spills ±7 px) | 70 – 86 |
| Pool + capacity sub | 64 (spills ±1 px) | ~75 |
| Source / Drain / Gate / plain Pool | 64 | **64, unchanged** |

The silhouette redraws at the new `boxH` (only the straight middle stretches;
caps keep their offsets) and `useUpdateNodeInternals` re-measures, so the React
Flow selection box, `fit-view`, and frame-margin computations all track the
visible AABB.

## Layout follow-through

- **Coffee zone frames (§CR17).** The taller Registers ate into
  `zone_forecast`'s 24 px bottom margin in **JA** (the 2-line-title
  `dessert_prep_margin` grew ~16 px). `zone_forecast`'s bottom was extended
  **+20 px** (`h` 614 → 634, `docs/example-coffee-roastery.md` §CR17) — top /
  left / right unchanged, the other two zones unchanged, frame-to-frame gaps
  unchanged, no frame overlap, fit-all clear at 1280 & 1920 in EN / KO / JA.
  `coffee-roastery.test.ts` `NODE_WH` / `PARAM_WH` were re-measured to the real
  rendered heights.
- **MMO** — Registers grow the same way; no node-node overlap (97 nodes), no
  stored frames (auto-frames recompute from the AABBs).

## Follow-up — the CURVED corner (horizontal containment)

The height fix above closed the **vertical** overhang, but the Parameter /
Register left + right edges are **rounded**, and the content is still laid out
to the CSS box while the vessel path lives in a **fixed** `0 0 120 H` viewBox.
The two coordinate systems diverge as the node widens: a fixed CSS
`padding-left: 16px` maps to a viewBox x of `16 · 120 / nodeWidth`, which
shrinks toward the rim — from ≈ 16 on a 118 px node down to ≈ 7 on a 260 px one
— so on a wide Register / Parameter the chip · title · value corners fell
**outside the rounded fill** even though inside the rectangular bbox
(`.nodef__stroke.getBBox()`). Worst on the widest Registers (a long `= expr`
with no break opportunity pushes the node to its 260 px `max-width`), where
*all four* corners of the content AABB were outside the fill.

Two coupled changes, both scoped to `parameter` / `register`:

1. **The silhouettes are re-cut** (`src/components/nodes/silhouette.ts`) so the
   drawn fill nearly fills the bounding box instead of insetting ~14 viewBox px
   on each side — but each keeps its identity: the top / bottom **edges** are
   pulled almost full-width so the content-facing run is flat, and the ends
   still carry the shape:

   | | before (edge start · extreme · corner) | after |
   |---|---|---|
   | register | edges `x30…98`, elliptical ends to `x14` / `x116` | edges **`x14…110`**, elliptical ends bulging to **`x6` / `x118`** at mid-height (a flattened lozenge) |
   | parameter | body `x40…108`, chamfered tab out to `x18` | body **`x8…112`** r6 + a left tab **`x1…8 × mid±8`** (the historic notch height) |

   The top / bottom cap offsets are **unchanged** (`y12 … H−12`,
   `VESSEL_INSET_Y` still 24) — the #167 height growth and every `boxH`
   calculation are untouched. A **true stadium** (semicircular ends) cannot be
   used: it pinches in exactly where the chip / title corner sits, 4 px below
   the top edge — so Register is a flatter, wider lozenge rather than a full
   pill. Parameter keeps its left tab as the kind tell.

2. **A width-scaled rim on the two corner lines, a fixed body padding.**
   `.nodef--parameter/.nodef--register .nodef__body` keeps a fixed `15px`
   horizontal padding, and the rim that scales with the node's width is a
   margin on `.nodef__head` (chip + title) and `.nodef__sub` only:
   `clamp(0px, calc(11.6667% - 11.5px), 17px)`. The percentage resolves against
   the stack (the node's width − 30), so `11.6667 % · (W − 30) − 11.5 px ≡
   11.6667 % · W − 15 px`: those two lines' left / right edges sit at a
   **constant** viewBox x (≈ 14) at every width, EN / KO / JA. The value line
   sits at mid-height where the lozenge / tag is widest and only carries a small
   inset that is counted in the intrinsic width: `margin-inline: 1px` on a
   Register (16 px from the box edge); on a Parameter, whose tag side is at
   viewBox x8 rather than x6, `max(4px, calc(8% - 13px))` — 19 px up to ~243 px,
   growing by at most 1.4 px per side so the ≥ 2 px clearance holds to the
   260 px cap. Pure CSS, one layout pass, nothing to converge.

   *Why not a percentage body padding* (the first cut of this follow-up,
   `dd52a4e` / `1ff8bef`): on a shrink-to-fit box a percentage padding is a
   **cyclic percentage** — the browser sizes the node with the `%` as 0 (so the
   15 px floor won and the outer width was content + 30), then resolves the `%`
   against the finished width and carves the difference out of the content
   column. Every node wider than 128.6 px lost `0.2333·W − 30` px from
   whichever line had set its width. When that line was the **value + unit**
   the number ellipsised (`370370.3…` on a 137 px Register: 107.4 px of text in
   a 105.0 px column). The fixed-padding-plus-margin form keeps the intrinsic
   width and the layout width in agreement: the rim margin's `%` is 0 in the
   intrinsic pass, and the value's fixed inset is counted in it.

**Cost.** On a node already at the 260 px `max-width` the rim costs the
`= expr` sub line ≈ 30 px of column — it ellipsises a few characters sooner
(the full expression is always in the Inspector). The title, value and unit
never lose space: a value-driven node is 2 px (Register) / 8 px (Parameter)
wider than its content + 30 instead of clipping. No Parameter / Register in the
bundled examples (Coffee, MMO, gacha) is value-driven, so their measured
EN / KO / JA node sizes and the `Forecast metrics` frame's 24 px margins are
unchanged.

Measured smallest CSS-px gap from any **painted** box corner (`.nodef__chip`,
`.nodef__head`, `.nodef__value`, `.nodef__sub`, four each) to the fill
boundary: chip ≥ 5.5, head / sub ≥ 3.0, value ≥ 2 px (parameter, 118 – 260) /
≥ 2.75 px (register at 260 px), at every width 118 – 260, EN / KO / JA — a plain
"is the point in the fill" test would have passed at 0 px, which was the latent
bug. (`.nodef__stack` is an unpainted layout box that spans to the fixed body
padding, so its corners are no longer the thing measured.)

## Regression tests

- `e2e/node-long-label.spec.ts` "content ⊂ vessel — path-aware (isPointInFill)"
  — for every Parameter / Register, in EN / KO / JA, all four corners of every
  painted box (`.nodef__chip`, `.nodef__head`, `.nodef__value`, `.nodef__sub`)
  are mapped into viewBox space and walked outward against
  `.nodef__fill.isPointInFill()`; the nearest surviving gap must be
  **≥ 2 CSS px**, and the title / value never ellipsise. The fixture includes a
  **value-driven** Register (`regValue`, value + unit is its widest line) and
  Parameter (`paramValue`, a 17-character number) — the case the percentage
  padding clipped; `e2e/canvas-refresh-visual.spec.ts` additionally pins the
  matrix fixture's `r_ok` value (`370370.34`) as rendered in full. Plus the #167 vertical check (content clears the
  `.nodef__stroke` top / bottom by ≥ 3 px) and the "Source / plain Pool stay at
  the 64 px base box" guard. The fixture asserts none of its nodes hit
  `MAX_NODE_H` (that ceiling clamp is a separate, pre-existing tradeoff).
- `e2e/coffee-zone-frames.spec.ts` (EN / KO / JA) + `coffee-roastery.test.ts`
  §CR17 — every Forecast node keeps ≥ 24 px frame margin (unchanged by the
  re-cut).
