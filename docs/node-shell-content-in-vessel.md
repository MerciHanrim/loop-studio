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

1. **The silhouettes are re-cut** (`src/components/nodes/silhouette.ts`) to
   near-full-width rounded rectangles — the drawn fill now nearly fills the
   bounding box instead of insetting ~14 viewBox px on each side:

   | | before (leftmost · rightmost · corner) | after |
   |---|---|---|
   | register | `x14 · x116` · elliptical end r≈18 | `x8 · x116` · **r8** |
   | parameter | `x18 · x108` · chamfered tab | `x8 · x112` · **r6** + a left tab `x1…8 × mid±8` |

   The top / bottom cap offsets are **unchanged** (`y12 … H−12`,
   `VESSEL_INSET_Y` still 24) — the #167 height growth and every `boxH`
   calculation are untouched. Register still reads as a soft rounded pill,
   Parameter still carries its left tab (the historic notch height).

2. **A width-scaled `padding-inline`** on the two bodies
   (`.nodef--parameter/.nodef--register .nodef__body`) —
   `clamp(15px, calc(100% * 14 / 120), 32px)`. The percentage resolves against
   the node's own width, so the content's left / right edge sits at a
   **constant** viewBox x (≈ 14) at every width, EN / KO / JA. Pure CSS — the
   browser resolves it in one layout pass, so there is **no measure→pad→measure
   feedback loop** and nothing to converge (a JS width→padding coupling would
   have needed damping and could oscillate).

**Cost.** On a node already at the 260 px `max-width` the wider inset costs the
`= expr` sub line ≈ 26 px of column — it ellipsises a few characters sooner
(the full expression is always in the Inspector, and §RXA will rework the
on-canvas presentation). The title, value and unit never lose space — only the
`= expr` sub, and only at max width. Sub-`max-width` nodes are unaffected in
practice: Coffee's Parameters are already pinned at the 118 px `min-width` and
its Registers at 260 px, so measured EN / KO / JA node sizes and the
`Forecast metrics` frame's 24 px margins are unchanged.

Measured smallest CSS-px gap from any content corner (`.nodef__stack` **and**
`.nodef__chip`, four each) to the fill boundary, after the re-cut:
**≥ 3.25 px** at every width 118 – 260, EN / KO / JA (a plain "is the point in
the fill" test would have passed at 0 px — which was the latent bug).

## Regression tests

- `e2e/node-long-label.spec.ts` "content ⊂ vessel — path-aware (isPointInFill)"
  — for every Parameter / Register, in EN / KO / JA, all four corners of
  `.nodef__stack` **and** `.nodef__chip` are mapped into viewBox space and
  walked outward against `.nodef__fill.isPointInFill()`; the nearest surviving
  gap must be **≥ 2 CSS px**. Plus the #167 vertical check (content clears the
  `.nodef__stroke` top / bottom by ≥ 3 px) and the "Source / plain Pool stay at
  the 64 px base box" guard. The fixture asserts none of its nodes hit
  `MAX_NODE_H` (that ceiling clamp is a separate, pre-existing tradeoff).
- `e2e/coffee-zone-frames.spec.ts` (EN / KO / JA) + `coffee-roastery.test.ts`
  §CR17 — every Forecast node keeps ≥ 24 px frame margin (unchanged by the
  re-cut).
