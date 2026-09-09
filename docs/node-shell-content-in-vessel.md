# Node shell — content inside the drawn vessel

**Status: fixed.** A rendering-layer defect in `NodeFrame`
(`src/components/nodes/nodes.tsx`): a node's content (chip · title · value ·
`= expr` sub) could sit a few px **outside** the drawn vessel outline — most
visibly on every result-bearing **Register** (title straddling the top edge,
`= @pool…` hanging below), at every zoom and in every example.

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

## Regression tests

- `e2e/node-long-label.spec.ts` "content ⊂ vessel" — for every node kind, in EN
  / KO / JA, the chip's top and the sub / value's bottom clear the drawn
  `.nodef__stroke` outline by ≥ 3 px; a Source and a plain Pool stay at the
  64 px base box.
- `e2e/coffee-zone-frames.spec.ts` (EN / KO / JA) + `coffee-roastery.test.ts`
  §CR17 — every Forecast node keeps ≥ 24 px frame margin at the new heights.
