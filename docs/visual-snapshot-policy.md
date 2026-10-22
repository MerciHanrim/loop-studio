# Visual snapshot tolerance policy

The Playwright pixel snapshots under `e2e/*-snapshots/` are compared with a
`maxDiffPixelRatio` that depends on **what the shot frames**, not one global
number. Source of truth: `e2e/support/snapshot-policy.ts`. Runtime: `snap()` in
`e2e/support/loop.ts`. Guard: `scripts/check-snapshot-policy.mjs` (runs in CI
`checks`).

## Policy

| kind | what it frames | size | `maxDiffPixelRatio` |
|---|---|---|---|
| `desktop-full-page` | `expect(page)` at 1280×800 | 1280×800 | **0.005** (0.5 %) |
| `desktop-canvas-clip` | `.react-flow` at the desktop viewport | 664×548 (980×462 before the workbench; see below) | **0.0002** (0.02 %) |
| `desktop-roomy-canvas-clip` | `.react-flow` at `WORKBENCH_ROOMY_VIEWPORT` (1600×940): a per-scene exception, see below | 984×688 | **0.0002** (0.02 %) |
| `mobile-canvas-clip` | `.react-flow` under the `mobile` project | 390×734 (735 before issue #303: the pane now reserves the run bar's measured 53 px) | **0.001** (0.1 %) |
| `mobile-full-page` | `expect(page)` at the phone viewport | 390×844 | **0.001** (0.1 %) |
| `element` | one component: Inspector, dialog, review overlay, minimap, Distribution panel | any other size | **0.0005** (0.05 %) |

The global fallback in `playwright.config.ts` is `SNAPSHOT_FALLBACK_RATIO` =
the loosest policy (0.005). It can only apply to a shot that bypassed `snap()`,
which the guard forbids.

## Why per kind (measured 2026-09-19, product tree `cafac2c`)

The ratio is *differing pixels ÷ all pixels* after Playwright's YIQ threshold
and anti-alias exclusion. Two facts drive the split:

1. **Cross-machine noise depends on the capture.** Rendering all 46 baselines
   on three independent `windows-latest` runners and on a Windows 11 machine
   (same Playwright 1.62.1 / chromium-1234): runner ↔ runner = **0 counted px in
   every image**; Windows 11 ↔ runner differs only in text rasterisation
   (toolbar text row, KO tooltip lines, node value glyphs), and its size scales
   with how much text a shot holds:

   | kind | max noise (local ↔ runner) | policy | headroom |
   |---|---|---|---|
   | desktop-full-page | 0.352 % (`ko-long-label-and-tip`) | 0.5 % | 1.4× |
   | desktop-canvas-clip | 0.003 % (`forced-colors-L2`) | 0.02 % | 7× |
   | mobile-canvas-clip | 0.029 % (`forced-colors-L2-mobile`) | 0.1 % | 3.4× |
   | mobile-full-page | 0.005 % (`ko-mobile-app`) | 0.1 % | 20× |
   | element | 0 % | 0.05 % | — |

2. **Real drift on a clip is small in ratio terms.** Against the 41 baselines
   that had silently drifted under the old single 2 % gate: a new rail button
   is 0.036 % of a desktop clip, the old bottom-centre selection panel 0.115 %,
   a Register value ellipsis 0.06 % of a mobile clip, a pool value changing
   from 999999 to 3 about 0.46 %. A single gate low enough to catch those
   (≤ 0.03 %) would fail every text-heavy full page on the runner (0.35 %
   noise). Per kind, the same 41 drifts fail **40/41** (only the 1 px value
   glyph shift in `frame-colours`, 0.004 %, passes — it is inside the
   full-page noise and was judged an accepted change).

Limits of the basis: one local machine and one runner image
(`win25-vs2026` 20260907.229.1). If a runner image update changes fonts, the
desktop full pages move first; re-measure with the same isolated method
(render into a scratch `snapshotPathTemplate`, never `--update-snapshots`
into the repo) before touching a number.

## Capture condition: the canvas clip since the workbench (2026-10-22)

The desktop shots run at the `chromium` project's 1280×800, with the
workbench's side panels as the product opens them there: 1280 px is the wide
band (`src/components/workbench/panelLayout.ts`), so the model list (272 px)
and the properties panel (344 px) are both open and the `.react-flow` pane is
**664×548**. The earlier 980×462 was the pane beside the old 300 px right
column; no panel is folded to bring it back.

A spec that compares node symbols, state rings or colours frames its scene so
every node it shows is whole in that pane: it pans
(`e2e/support/visualFrame.ts` `frameInPane`, or a pane-centred viewport), and
lowers the zoom only where the scene cannot fit, never across a level-of-detail
boundary (`src/components/lod.ts`); each such zoom is noted in the spec. A
scene that checks the default layout, fitting or a panel is not reframed: a cut
there is a finding, not a framing to adjust.

The tolerance of 0.02 % was measured on the 980×462 clip; it has not been
re-measured on the smaller pane.

### Scenes that do not fit the pane (2026-10-22)

- **`auto-frames` + `auto-frames-area2`** (large-graph-readability). The two
  suggested frames span about 1,115 px at the scene's L1 zoom 0.62; holding both
  in 664 px would need about 0.36, which is L0. So the scene is shot twice at
  1280×800, zoom 0.62, panels open: Area 1 selected (✕ and resize) with the
  structural-only note, then Area 2 unselected, panned 24 px from the pane's
  left edge so Area 1 is wholly out of the pane. Each shot asserts what it
  holds is whole in the pane.
- **`auto-frames-mixed`** (large-graph-readability) — the one
  `desktop-roomy-canvas-clip`. Its frame is drawn over a row that a 664 px pane
  does not hold, so the test runs at 1600×940 (canvas 984×688, panels open).
  For the capture the zoom is lowered from the drag's 0.62 only as far as
  fitting every node and frame (titles included) needs — 0.52, still L1 — and
  the test fails if that would go below L1.
- The exception is registered for that stem only. Neither scene checks
  automatic fitting, so reframing them hides no fit result.

### Known limits a baseline shows on purpose (accepted, not fixed)

A baseline may show a known limit that was explicitly accepted. It is listed
here so a reader does not take it for an approved normal look, nor for a fix.

- **`matrix-light-L2`, `matrix-dark-L2`** (canvas-refresh-visual, the previous
  node structure `?nodes=inside`, accepted 2026-10-22). The long-label pool's
  content (166 px) runs past the body's height ceiling (`MAX_NODE_H.pool`
  132), so its detail line `≤ 2000000` lies just below the drawn body, and the
  curved state connection `s_fb`, leaving the body's bottom face, runs through
  that line: the line shows between the glyphs. The long-label Parameter's
  name likewise rises above its body. Accepted as a limit of the previous
  structure for this case only — a long name past the height ceiling — with
  no product change. Forced colours hide the crossing only because the
  browser draws a text backplate. In the default structure the two cases
  checked (the same document, and the name pushed below by all four faces in
  use) showed no crossing; that is not a claim for every outside layout. The
  phone L2 shots carry the same crossing under the same acceptance; their
  framing is a separate, still-open item.

## Adding a snapshot

1. Register the stem in `SNAPSHOTS` (`e2e/support/snapshot-policy.ts`) with its
   kind per project. A stem that is not registered throws at runtime and fails
   the guard — there is no way to inherit the fallback by accident.
2. Take the shot through the helper:

   ```ts
   await expect(page.locator('.react-flow')).toHaveScreenshot(...snap(page, 'my-shot', { mask: [...] }))
   ```

   `snap()` resolves the kind from the running project (`chromium` / `mobile`)
   and returns `['my-shot.png', { maxDiffPixelRatio, ...extra }]`. Do not pass
   `maxDiffPixelRatio` yourself; the guard rejects it.
3. Run `node scripts/check-snapshot-policy.mjs`. It checks: every baseline on
   disk is registered under exactly one kind and has that kind's pixel size
   (an `element` must not have a page/clip size); every registration has a
   file; every `toHaveScreenshot` goes through `snap()`; the fallback is not
   looser than the loosest policy.

## Regenerating a baseline

`npx playwright test --update-snapshots` rewrites only a baseline whose test
**fails**; a drifted image inside its tolerance is kept as-is. To see the true
state of every baseline, render into an isolated directory and diff — the
2026-09-18 audit and the 2026-09-19 measurement did exactly that. Baselines are
reviewed image by image before they are replaced; a change of tolerance is not
a reason to regenerate.
