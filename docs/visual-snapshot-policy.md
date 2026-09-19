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
| `desktop-canvas-clip` | `.react-flow` at the desktop viewport | 980×462 | **0.0002** (0.02 %) |
| `mobile-canvas-clip` | `.react-flow` under the `mobile` project | 390×735 | **0.001** (0.1 %) |
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
