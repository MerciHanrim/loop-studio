# MMO multilingual large-graph layout (non-frozen design doc)

**Status: settled contract — implementation in progress.** Issue 3 of the
post-v0.8.0 multilingual defect cluster (after §TLO11 label switch and the
toolbar responsive PR). The bundled **MMO progression** template (97 nodes /
144 edges) has node-box overlaps and an unreadable initial camera; the problem
is worst in JA but is **not JA-only**.

## MML0. What the measurement pass found

All figures are **flow coordinates** (measured at zoom = 1, so screen px = flow
px). MMO opened from the Templates menu, in EN / KO / JA.

- **Node-internal label overflow: 0 in every locale.** Nodes auto-width to the
  label (min 118px, capped 260px), so labels are never clipped or pushed
  outside their own box. Label length shows up as **box growth**, not overflow.
- **Node-box overlaps (pairwise AABB): EN 12 · JA 12 · KO 5.** Split by cause:
  - **Canonical-coordinate spacing shortfall — locale-independent (~5 pairs, in
    all three locales):** sibling groups placed ~0px apart centre-to-centre in
    `examples/mmo-progression.json` overlap **even at the 118px minimum node** —
    `combat_wins ↔ combat_fails ↔ deaths`, `water ↔ food`,
    `water_upkeep ↔ food_upkeep`, `water_consumed ↔ food_consumed` (ox ≈
    118–128). Root = `position`, not labels.
  - **Node intrinsic-size shortfall — locale-dependent (the extra ~7 in EN/JA):**
    pairs that clear in KO but overlap once a longer label grows the box past
    ~150–200px — `water_consumed ↔ water_upkeep` (fully vertically stacked in
    JA), `food_consumed ↔ food_upkeep`, `quest_payout ↔ quest_xp` (JA),
    `z1_xp_meter ↔ z2_win` (JA), `reward_router` fan-out, `bucket_*`.
- **Minimum canonical gap:** as low as **1–9px horizontal**, **16px vertical**;
  10% of gaps are under ~22–31px horizontal.
- **Label ↔ other-node / handle collisions (EN):** 4 label-into-box, 4
  label-into-handle (subset of the 12 box overlaps).
- **Whole-graph bounds: ~3500 × 1525 flow, locale-independent within ~2%.**
- **Camera after template-load fitView:** zoom **0.34 at ~1920** (measured 3×
  identical for EN / KO / JA), ~0.29 at 1280, ~0.20 at 820 — the whole 97-node
  graph is shown, which forces a zoom below the L1/L2 thresholds, so **nothing
  is readable on first open, in any language.** Fully locale-independent — a
  fit-all camera-policy problem, not layout, not locale.
- **Longest labels:** JA `草原地帯の経験値メーター` 168px, EN
  `Water consumed (units)` 155px, `Consumables burned` 138px, KO
  `초원 지대 경험치 계량기` 150px. A ≤2-line policy at ~130px would halve the
  widest boxes (200–260px → ~85–130px), node height ~64 → ~83.

**Three independent causes: label rendering, canonical coordinates, initial
camera.** Each is fixed on its own terms; all are verified together in one PR.

---

## MML1. Label rendering

- Node labels render on **up to 2 lines** with a **~130px soft-max target
  width** — the target width used when the whole label fits in 2 lines, **not a
  fixed hard cap**. A label that cannot fit in 2 lines at 130px widens the line
  further; it is **never** ellipsised, truncated, or otherwise lost.
- **Line breaking is the browser's:** EN wraps at word boundaries; JA uses the
  browser's standard CJK line-break rules. **No custom "Japanese particle
  guessing" algorithm.** `text-wrap: balance` plus an appropriate
  `line-break` / `word-break` pair minimises an awkward one-character orphan
  line.
- The stored `data.label` is **never** modified — no injected newlines, no
  zero-width characters. This is a **render-only** change; Save / Share / Export
  / digest are byte-identical.
- If the change lands in the **general node renderer**, it must be regression-
  verified that the existing short labels of the Coffee and production-line
  templates, and of ordinary user graphs, **do not change size** — the ≤2-line
  path only engages once a label exceeds one line at the soft-max width.

## MML2. MMO canonical coordinates

- In `examples/mmo-progression.json`, widen the `position` deltas of the
  chronically-overlapping sibling groups (combat row, water / food rows, upkeep
  row, consumed row, reward-router fan-out) so **every node pair clears a
  measured minimum gap of ≥ 40px horizontal / ≥ 24px vertical** at the EN / JA
  worst-case rendered width.
- **Unchanged:** the tier structure, the left-to-right progression, the branch
  order, every edge, and every engine-relevant value (`initial`, `capacity`,
  `flow`, expressions, `mode`, …).
- **The engine trajectory is NOT re-pinned.** `src/model/templates.trajectory.test.ts`
  keeps its current numeric expectations and must pass **as-is** — a position
  change moves nothing the engine computes. Only a dedicated *layout / position*
  snapshot (if one exists) has its expectation refreshed.
- KO structural parity of `examples/mmo-progression.ko.json` is re-verified by
  hand per the [[mmo-ko-derived-example]] rule.

## MML3. Initial camera

- When MMO is opened **fresh from the Templates menu**, the initial view is the
  **early progression band** (character creation → zone 1 → the level / XP
  meters), centred and zoomed so labels are readable (**zoom ≥ the L1
  threshold**), instead of fit-all.
- The centre is a **fixed graph-coordinate point** — **no branch on locale**.
  The zoom may differ per viewport width, but **for one viewport width the
  centre and zoom are identical for EN / KO / JA**.
- The camera is **not** re-initialised on: a language change, a plain reload, an
  Import / Share / Workspace restore, or Undo / Redo. A viewport the user has
  panned or zoomed is **never** overwritten by a language change.
- The rest of the graph stays reachable through the minimap and panning (and
  Focus).

## MML4. Acceptance (all verified in the one PR)

For EN / KO / JA, on the freshly-opened MMO template:

1. **0** node-box AABB overlaps across all 97 nodes.
2. **0** collisions of a node's label or handle with another node.
3. Every official label fully visible, on **at most 2 lines**.
4. The first and last segment of every edge that meets a node is visually
   identifiable.
5. Initial centre and LOD verified at **1920 / 1280 / 820** — same centre and
   zoom across the three locales at each width; zoom ≥ L1.
6. Focus ON / OFF, and selection / error / Activity rendering, all still legible.
7. **No graph-data diff outside `position`** — node/edge sets, `data`, handles,
   `recommendedRunConfig` unchanged.
8. The existing deterministic engine trajectory (`templates.trajectory.test.ts`)
   passes with its current expectations.
9. The **Coffee, equilibrium and deadlock** templates' layout and initial camera
   are **unchanged**.
10. A locale switch on an open document leaves the viewport unchanged.
