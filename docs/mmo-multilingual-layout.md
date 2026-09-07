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

## MML1. Label rendering (general — the shared node renderer)

Applies to **every** node in every graph, including user-created nodes. The
measurement showed Coffee is as label-heavy as MMO (22 of 23 nodes > 140px
wide), and FR will bring more — a per-template hack does not scale, so this is a
general policy with **two representative fixtures: MMO and Coffee**.

- Node titles render on **up to 2 lines** at a **~135px soft-max target width** —
  the width aimed for when the whole title fits in two lines, **not a hard cap**.
  A title that will not fit in two lines at 135px **widens the line as much as
  needed**; it is **never** ellipsised, truncated, or otherwise lost.
- **2-line (or wider) nodes grow in height to fit their content.** The fixed
  64px node height is replaced by a content-driven height. The title must not
  overlap the value / unit / sub-description for that node kind.
- **Handles reposition to the grown box** — side handles to the real vertical
  centre of the new height, top/bottom and kind-specific handles to their
  defined positions on the new box.
- **Line breaking is the browser's.** The wrap rule (note `word-break: keep-all`
  would block breaking *between* JA characters, so it cannot be combined with
  "browser CJK breaking"):
  - base / EN / JA / ZH: `word-break: normal`, `overflow-wrap: normal`;
  - JA / ZH: `line-break: strict` (or the standard CJK rule the browser
    supports);
  - **KO only:** `:lang(ko) { word-break: keep-all }` — Korean breaks between
    eojeol, not syllables;
  - all: `text-wrap: balance` to even the two lines / avoid a one-character
    orphan.
  No custom "Japanese particle guessing" algorithm.
- The stored `data.label` and the graph schema are **never** modified — no
  injected `<br>`, no newlines, no zero-width spaces, **no render hint of any
  kind**. Purely a render change; Save / Share / Export / digest byte-identical.
- Regression: the existing **short** labels of the production-line templates and
  of ordinary user graphs **do not change size** — the ≤2-line / grow path only
  engages once a title exceeds one line at the soft-max.

### MML1b. Height-parametric silhouettes

The node vessel is a `preserveAspectRatio="none"` SVG that fills a fixed 64px
box; simply scaling it on the Y axis distorts every shape. Instead:

- a **per-kind path function** (all 7), not one shared Y-scale — the SVG
  `viewBox` becomes `0 0 120 <h>` and each path is regenerated for `<h>`;
- **stroke width, corner radius, the `parameter` notch, and the `end` endbar
  thickness are fixed** — height-independent;
- **`gate` and `converter` get a per-kind minimum aspect ratio** so the diamond
  / waisted-hourglass form does not collapse as height grows (the middle stays
  recognisable, no vertical band);
- at **h = 64** every regenerated path is **pixel-identical** to the current
  hard-coded silhouette;
- the selection ring, invalid dashed outline, `evaluated` bracket, top-right
  `!` flag and every `forced-colors` rule stay correct at the 2-line height
  **and** at the longest expected height;
- the render height is **computed, never written to `data`**;
- a `ResizeObserver` on the body settles in **one** pass — no repeated
  re-measurement, no visible jitter;
- if React Flow does not re-fit the connected edges after a height change,
  `useUpdateNodeInternals(id)` is called explicitly once the height settles.

### MML1a. Coffee is the second representative fixture

22 of Coffee's 23 nodes change (compact 2-line, narrower, taller). This is **not**
a light regression check — Coffee is re-measured and visually reviewed in
EN / KO / JA exactly like MMO. "Coffee 배치 불변" (acceptance #9) means:

- stored node coordinates unchanged; edges, values and semantics unchanged;
- the **initial-camera policy** unchanged (no MMO-style custom initial view for
  Coffee);
- the visual change of long nodes becoming narrower and two-line **is allowed**;
- but **no new** node-box overlap, handle collision, or clipping;
- a fitView pass may land on a slightly different zoom, but the **centre and the
  overall framing must not materially change**.

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

For EN / KO / JA, on the freshly-opened **MMO** and **Coffee** templates:

1. **0** node-box AABB overlaps across all nodes (97 for MMO, 23 for Coffee).
2. **0** collisions of a node's label or handle with another node.
3. Every official label fully visible, on **at most 2 lines**; no ellipsis.
4. Title never overlaps the value / unit / sub-description; handles sit on the
   real (grown) box centre / defined position.
5. The first and last segment of every edge that meets a node is visually
   identifiable.
6. MMO initial centre and LOD verified at **1920 / 1280 / 820** — same centre and
   zoom across the three locales at each width; zoom ≥ L1.
7. Focus ON / OFF, and selection / error / Activity rendering, all still legible.
8. **No graph-data diff outside `position`** — node/edge sets, `data`, handles
   config, `recommendedRunConfig`, schema unchanged.
9. The existing deterministic engine trajectory (`templates.trajectory.test.ts`)
   passes with its **current** expectations (a position change moves nothing the
   engine computes).
10. **equilibrium / deadlock**: layout, node sizes and initial camera unchanged
    (their labels are short — the ≤2-line path does not engage).
11. **Coffee**: stored coordinates, edges, values, semantics and initial-camera
    policy unchanged; the narrower / two-line visual change is expected; no new
    overlap / handle collision / clipping; fitView centre and framing not
    materially changed.
12. A locale switch on an open document leaves the viewport unchanged.
13. **Deliverable:** a per-kind side-by-side of the 64px silhouette vs the
    2-line silhouette, so the parametric shapes can be visually signed off.
