# Browser E2E — slice 2 plan (for review, no code yet)

Branch: `test/browser-e2e-2`. Shared input fixture: `examples/risky-factory.json`.

Goal: prove the **HTTP Worker path** and the **portable `file://` cooperative
path** produce the same Monte-Carlo result, that progress/cancel behave under
each, and that undo/redo + template swap invalidate sim/MC state correctly.

Principle: **no product-code changes, no bridge extension.** `src/` is untouched;
the existing DEV-only `window.__loop = {graph, sim, mc}` bridge is used as-is on
http and is *not* available (nor added) on the portable `file://` page. All new
code is Playwright harness + specs.

Review status: plan approved 2026-08-28 with four corrections, folded in below
(§1 message-level path proof, §3 cancel-observer split, §7 tracked precondition,
§6 no `?__e2e` bridge — instrument `URL.createObjectURL` instead).

---

## 1. Distinguishing the two execution paths — and proving which ran

`runMonteCarloParallel(nodes, edges, config, opts)` chooses:

```
workers = floor(opts.workers ?? defaultWorkerCount())
if (workers <= 1 || !canUseWorkers()) → runMonteCarloCooperative(...)   // main thread, MessageChannel yields
else                                   → real Worker pool
```

- `defaultWorkerCount() = min(4, max(1, navigator.hardwareConcurrency - 1))`
- `canUseWorkers()` is `false` when `typeof Worker === 'undefined'` **or**
  `location.protocol === 'file:'`.

The store (`mcStore.run()`) calls `runMonteCarloParallel` with **no `workers`
option**, so the path is decided purely by `navigator.hardwareConcurrency` (http)
or the `file:` protocol (portable).

### Harness levers (all via `page.addInitScript`, before app code runs)

1. **Force the path on http** by redefining the reading:
   ```js
   Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => N, configurable: true })
   ```
   `N = 8` ⇒ `defaultWorkerCount()` = 4 ⇒ **Worker path**.
   `N = 1` ⇒ `defaultWorkerCount()` = 1 ⇒ **cooperative path**.
   A test-environment value; the app already reads it at call time and adapts.

2. **Instrument `Worker` with a `Proxy` `construct` trap** — preserves the real
   prototype, `instanceof`, and all behaviour (no `class extends`, no method
   swap on the instance):
   ```js
   window.__wk = { ctor: 0, init: 0, job: 0, msgIn: 0 }
   const RealWorker = window.Worker
   const realPost = RealWorker.prototype.postMessage
   RealWorker.prototype.postMessage = function (m, ...rest) {
     const t = m && typeof m === 'object' && !ArrayBuffer.isView(m) ? m.type : undefined
     if (t === 'init') window.__wk.init++
     else if (t === 'job') window.__wk.job++
     return realPost.call(this, m, ...rest)
   }
   window.Worker = new Proxy(RealWorker, {
     construct(target, args) {
       window.__wk.ctor++
       const w = Reflect.construct(target, args) // genuine Worker, correct prototype
       w.addEventListener('message', () => { window.__wk.msgIn++ })
       return w
     },
   })
   ```

3. **Cooperative-side probe** — a macrotask ticker to witness event-loop
   interleave during a main-thread run:
   ```js
   window.__ticks = 0
   ;(function t () { window.__ticks++; setTimeout(t, 0) })()
   ```
   It also lets a test snapshot "ticks advanced by ≥ k across the run" as
   independent evidence the loop yielded (the cooperative driver's whole point).

### Strengthened proof that the chosen path did the computation

| path | pinned by | proof it actually computed |
|---|---|---|
| **Worker** (http, `N=8`) | `hardwareConcurrency` initscript | `__wk.ctor ≥ 2` **and** `__wk.init ≥ 1` **and** `__wk.job ≥ 1` **and** `__wk.msgIn ≥ jobs` (result messages came back) **and** the run completes with a correct result |
| **cooperative** (http, `N=1`) | `hardwareConcurrency` initscript | `__wk.ctor === 0` **and** a mid-run `0 < progress < 1` sample was seen (loop yielded) **and** `__ticks` advanced during the run **and** the run completes with a correct result |
| **portable cooperative** (`file://`) | real `file:` protocol | `__wk.ctor === 0`, no dev server in play, mid-run progress seen via the strip `%`, completes with a correct result (same `424/500`) |

`__wk.job` and `__wk.msgIn` together show the worker pool *sent jobs and received
their results* — not merely that a `Worker` object was constructed.

---

## 2. Byte-equal comparison — fields compared, nothing excluded

Compare the **entire `MonteCarloResult`** serialized with `JSON.stringify` (the
same thing `toMonteCarloJson` emits). SEMANTICS-B2 I11 guarantees the parallel
and cooperative drivers are bit-identical because both feed the raw trajectories
into the *same* `aggregateRuns` on the main thread.

Fields, all included, exact (no float tolerance — a mismatch is a real bug):

```
spec, seedSpec, rngSpec
config                       (baseSeed, runs, steps, tracked)
completedRuns
droppedTracked
pools[]                      ({id,label} in resolve order)
runSeeds[]                   (length runs)
endedRuns.atOrBeforeStep[]   (length steps+1, monotone)
series[poolId].{p10,p50,p90,mean,min,max}    (each length steps+1)
final[poolId].values[]       (length runs, run-index order)
final[poolId].summary.{p10,p50,p90,mean,min,max}
```

`mean` is Neumaier summation over an ascending-sorted array, so ordering is fixed
and associativity does not bite. If any run ever produces a differing byte, the
spec's core invariant is violated — that is the point of the test.

Comparison method:
- http worker vs http cooperative: read `window.__loop.mc.getState().result`
  from each context, `JSON.stringify` (stable key order — same object shape),
  `expect(a).toBe(b)`.
- portable `file://` vs http: compare the **exported JSON** for the same
  `500 × 40, baseSeed 1` config, captured on both sides by the same
  `URL.createObjectURL` instrumentation (see §6), `expect(a).toBe(b)`.

---

## 3. Mid-run progress observation + callbacks stop after cancel

The store's `onProgress` does `if (get().status !== 'running') return; set({progress, completedRuns})`.
`runMonteCarloParallel` fires progress every 64 completed runs (+ once at the
end); on abort it `reject`s and the internal `done()` guard makes any late
worker message a no-op (`if (settled) return`) and removes the `abort`
listener. `runMonteCarloCooperative` fires at batch boundaries and, on abort,
throws out of the loop and `dispose()`s the MessageChannel — no queued yield
callback survives.

**Verified store behaviour on cancel** (removes the apparent contradiction in the
first draft): the `AbortError` branch sets `progress: 0` and `message:'Cancelled'`
but **does not touch `completedRuns`** — it keeps whatever the last `onProgress`
committed. So `progress` (a product-rule *reset*) and `completedRuns` (the last
*delivered* value, now frozen) are two different quantities with two different
post-cancel rules. The test asserts them separately, and adds an independent
test-side observer of the async machinery so "work stopped" is not proven from
product state alone.

### Mid-run progress observed (http, both paths, bridge)

- Size the run so wall-time ≫ 1 s (`2000 × 40`, all pools; 656 k cells < 5 M).
- `expect.poll` on `mc.getState()`: at least one sample with `0 < progress < 1`
  **and** `status === 'running'` ⇒ progress observed mid-run.
- Worker path additionally: `__wk.msgIn` climbs across those samples. Cooperative
  path additionally: `__ticks` advances by ≥ 20 across the run window.
- Finish: `progress === 1`, `status === 'done'`, result correct.

### Callbacks stop after cancel (http, both paths)

Three distinct observations, not one:

1. **Test-side observer of the async machinery** (the primary "callbacks stopped"
   proof, decoupled from the store):
   - Worker path — `X = window.__wk.msgIn` at the moment `status` leaves
     `'running'`. Re-read after 750 ms: `__wk.msgIn === X` (workers were
     `terminate()`d; no further result messages). Also `__wk.job` unchanged.
   - Cooperative path — `X = mc.getState().completedRuns` captured while still
     `'running'`; re-read the store's `completedRuns` at +250 / +500 / +750 ms:
     never exceeds `X` (the loop threw; no batch boundary advanced it). (`__ticks`
     keeps climbing — the ticker is independent — so it is *not* used as the
     freeze signal here, only as the earlier "did yield" signal.)
2. **Product state reset per product rules**: `progress === 0`,
   `message === 'Cancelled'` (clears itself after 2.5 s), `status` back to
   `'idle'` (no prior result) or `'done'` (prior result kept — §4).
3. `completedRuns` is *not* re-zeroed by the cancel path (verified above), so it
   equals the frozen `X` from step 1 for the cooperative case; for the worker
   case it holds the last `onProgress` value. Asserted as `> 0 && < N` and stable
   over 750 ms — a weaker corroboration of step 1, never the sole proof.

### Portable `file://` (DOM only, no bridge)

- Progress: `.pstrip__mcprog` text (`Monte Carlo NN%`) advances past `0%` and
  below `100%` while running; then DISTRIBUTION appears.
- Cancel: click the strip **Cancel**; `.pstrip__mcprog` disappears, the button
  shows `Monte Carlo · Cancelled`. Record the last `%` seen before cancel;
  re-read at +500 ms and +1000 ms — it does not increase. `__wk.ctor === 0`
  throughout (cooperative), and no partial DISTRIBUTION appears (§4).

---

## 4. Cancel keeps the prior successful result; never a partial

`mcStore.run()` sets `status:'running'` **without clearing `result`**. On
`AbortError` it sets `status: get().result ? 'done' : 'idle'`, `progress:0`,
`message:'Cancelled'`, and keeps `result` / `runGraph` / `runRev` untouched.
`runMonteCarloParallel` never resolves with a partial — abort always `reject`s.

Spec (http, worker path and cooperative path):
1. Run a small MC (`120 × 20`) → success. Snapshot `result` as `R0`
   (`completedRuns === 120`, `view === 'distribution'`).
2. Start a large MC (`5000 × 40`). Poll until `status === 'running'` and
   `completedRuns > 0`.
3. Cancel.
4. Assert:
   - `status === 'done'` (because `R0` exists)
   - `deepEqual(mc.getState().result, R0)` — same object, **not** advanced, not a
     merge, `completedRuns` still `120` (never an in-between number)
   - `message === 'Cancelled'`, `stale === false` (a cancelled run doesn't stale
     a good result)
   - DISTRIBUTION header still shows `120 runs`
5. "No partial exposed": there is no code path; asserted by `completedRuns === 120`
   exactly and `result === R0`.

Also the no-prior case (already in slice 1, re-affirmed here): cancel with no
previous result ⇒ `status:'idle'`, `result === null`, `.dist` not rendered.

---

## 5. Risky Factory: real termination line + Bead + `424 / 500`

Config: `baseSeed 1, runs 500, steps 40`, all pools tracked (or the six from the
README — the tracked set does not change `endedRuns`).

Assertions (http worker path, cooperative path, and portable `file://`):
- `endedRuns.atOrBeforeStep` length `41`, monotone non-decreasing, last value
  **`=== 424`** (locked by the unit test already; re-checked end-to-end here).
- `completedRuns === 500`, so `Ended` = `424 / 500` = **85 %** (rounded).
  - http: `.dist__stat` "Ended" contains `85%`; bridge `endedPct` numerator
    (`atOrBeforeStep.at(-1)`) `=== 424`.
  - `file://`: `.term__pct b` reads `85%`; the DISTRIBUTION "Ended" stat reads
    `85%`.
- `.term__line` count `1`, `.term__bead` count `1`, `.term__empty` count `0`
  (the populated sparkline — complements slice 1's 0 % "No runs ended" shot).
- The exported JSON's `endedRuns.atOrBeforeStep.at(-1) === 424` on every path.

This ties the four numbers Lumi listed together end-to-end in the browser:
`last cumulative === independent recount (unit test) === Ended numerator === 424`.

---

## 6. Portable `file://` in CI — how it is reproduced, and the constraints

### Build + serve

- New Playwright **project** `portable` (or a `globalSetup`) that runs
  `npm run build:portable` once, producing `dist-portable/loop-studio.html`
  (single self-contained file; `dist-portable/` is git-ignored, so it is always
  built fresh in CI).
- The spec navigates with `page.goto(pathToFileURL('dist-portable/loop-studio.html').href)`.
  Playwright + Chromium allow `file://` navigation with no extra flags.
- No `webServer`, no dev server for this project.

### Driving it with no `window.__loop` bridge (production build)

- **Import**: `page.locator('input[type=file]').setInputFiles('examples/risky-factory.json')`
  drives the real hidden `<input accept=".json">` → `FileReader` → `loadJSON`.
- **Run / observe / cancel**: entirely through the DOM (strip button, MC dialog
  inputs, `.pstrip__mcprog`, `.dist`, `.term__*`).
- **Read the exported result** for byte-equality — three mechanisms, tried in
  order, **all pure test instrumentation, no product change** (see §6.1 spike):
  1. the real Playwright `download` event on Export ▾ → **JSON**;
  2. an `addInitScript` that wraps `URL.createObjectURL` so that when the app's
     `download()` helper builds its `Blob`, the test captures `await blob.text()`
     keyed by the returned `blob:` URL (`DistributionPanel.download()` calls
     `URL.createObjectURL(blob)` then `a.download` + `a.click()` synchronously —
     the wrapper reads the Blob before `revokeObjectURL`);
  3. combine the Export click succeeding with DOM metrics (`.term__pct`,
     the "Ended" `.dist__stat`, `.term__line`/`.term__bead` counts) as a
     coarser cross-check.
  Mechanism 2 is protocol-independent and is the one the http reference also uses
  so the two captures are apples-to-apples. If **all three** fail, stop and
  report — a product-code bridge into the portable build is **not** an option.

### `file://` browser constraints (documented in the spec header)

- Opaque origin ⇒ `localStorage` access can throw; the app already wraps
  `loadFromStorage` / `saveToStorage` in try/catch, so import + run are
  unaffected. The spec starts from a clean import, not persisted state.
- Module / blob Workers are unreliable from `file://` across browsers — this is
  exactly why `canUseWorkers()` returns `false` for `file:` and the cooperative
  path is used. That behaviour is the thing under test.
- No `fetch` of sibling files — irrelevant, the portable build is one file with
  fonts and JS inlined (slice-1 checks already assert "no external refs").
- No HMR / dev server — static file, so the spec must not rely on reload-based
  helpers.

---

## 7. undo / redo and template swap → sim + MC stale

`undo()` and `redo()` both call `bump()` → `simulationRev++`. `loadGraph`
(template pick) also `bump()`s. Subscribers:

- `simStore`: any `simulationRev` change ⇒ `reset()` (status `idle`, stepIndex 0,
  series cleared).
- `mcStore`: on `simulationRev` change ⇒ `reconcileTracked()` **and**
  `if (result && !stale) → stale = true`.

`Templates.pick()` additionally calls `useSimStore.getState().pause()` before the
swap and prompts `window.confirm()` when the canvas is non-empty.

### Spec `e2e/mc-invalidation.spec.ts` (http, bridge)

**Precondition on `tracked`** (correction 3): `tracked: []` means "track every
Pool" and `reconcileTracked()` returns early for it — a template swap leaves it
`[]` (now meaning the template's pools). To exercise the "falls to first pool"
branch the test must first set an **explicit subset of Risky Factory Pool ids**.
Both cases are covered:

- Case A (explicit subset): before the swap,
  `mc.setConfig({ tracked: ['ore_stock', 'components'] })`.
- Case B (`[]`): a second run of the swap with `tracked: []` left as default.

Steps:

1. Import risky-factory. `mc.setConfig({ tracked: ['ore_stock','components'] })`.
   Run a small MC (`120 × 20`) → `stale === false`, `view === 'distribution'`,
   Export enabled, `result.pools` = exactly those two.
2. Advance the live sim (`sim.stepOnce()` ×3) → `stepIndex === 3`.
3. Make an undoable structural edit first
   (`graph.updateNodeData(<pool>, {capacity: 999})` ⇒ `canUndo === true`), then
   **`graph.undo()`**:
   - `mc.getState().stale === true`; `result` still present (viewable)
   - Export button `disabled` (`.dist__stats .menu button[disabled]`, title
     "Result is stale — re-run to export")
   - `sim.getState().stepIndex === 0`, `status === 'idle'`
4. **`graph.redo()`** — still `stale === true` (redo bumps rev too); result
   still present.
5. Re-run MC → `stale === false`, fresh `result`, Export enabled.
6. **Config edit does NOT stale** (re-affirm slice 1): `mc.setConfig({runs:300})`
   ⇒ `stale` stays `false`, `result` unchanged.
7. **Template swap, Case A**: `page.on('dialog', d => d.accept())`, Templates ▾ →
   "Flowing equilibrium":
   - `graphSnapshot` shows the template's nodes (risky-factory gone)
   - `mc.getState().stale === true`; result still viewable
   - `mc.getState().config.tracked` reconciled to `[<first template pool id>]`
     (empty intersection with `['ore_stock','components']` + pools remain ⇒
     first pool; never widens to `[]`)
   - `sim.getState().status === 'idle'`, `stepIndex === 0`
8. **Template swap, Case B** (`tracked: []`): reset, import risky-factory, leave
   `tracked` default `[]`, run MC, swap template ⇒ `stale === true`,
   `config.tracked` **still `[]`** (all — now the template's pools), sim reset.
9. Swap while a **live run** is active: `sim.play()`, pick the other template —
   `Templates.pick()` pauses first; assert `sim.status !== 'running'` and
   `stepIndex === 0` after.

---

## 6.1 Spike (step 1 deliverable) — before any spec is written

Build the portable file, open it from `file://`, and confirm — reporting back:

1. the page boots (root renders, no console errors), `location.protocol === 'file:'`;
2. `setInputFiles` on the hidden `<input type=file>` imports risky-factory
   (node count 18);
3. an MC run completes with `window.__wk.ctor === 0` (cooperative), and the
   `URL.createObjectURL` wrapper captures the Export → JSON blob text on
   `file://` (mechanism 2);
4. whether the real Playwright `download` event also fires on `file://`
   (mechanism 1) — informational;
5. that the captured JSON's `endedRuns.atOrBeforeStep.at(-1) === 424` for
   `500 × 40, baseSeed 1`.

If mechanisms 1–3 all fail to yield the result JSON, **stop and report** — a
product-code path into the portable build is off the table per review.

## 8. Product-code changes

**None.** The rejected `?__e2e` bridge un-gate is not pursued. Result extraction
on `file://` uses test-side Web-API instrumentation only (§6, mechanisms 1–3).
If that proves impossible, the portable byte-equality check is dropped and the
gap reported, rather than adding any access path to the shipped file.

---

## 9. File / config plan

New:
- `e2e/support/mc.ts` — path-instrumentation initscript (`__wk` Proxy + prototype
  `postMessage` spy + `__ticks` ticker + `URL.createObjectURL` capture),
  `forcePath(page, 'worker'|'coop')` (hardwareConcurrency), `pathProbe(page)`
  (reads `__wk`/`__ticks`), `capturedExports(page)`, `simSnapshot(page)`,
  `mcResultJson(page)`, `importGraphFile(page, path)`, `portableUrl()`.
- `e2e/mc-paths.spec.ts` — §1–§4 on http (worker vs cooperative): byte-equal,
  message-level path proof, mid-run progress, cancel stops callbacks, cancel
  keeps the prior result.
- `e2e/mc-invalidation.spec.ts` — §7.
- `e2e/portable-file.spec.ts` — §5–§6 on `file://`.
- Reference for the portable byte-equal check: regenerated in `globalSetup`
  (http run, same config) and written to `test-results/` — **not committed**
  (avoids a ~1–2 MB blob in the repo). Decide at review if a committed trimmed
  reference is preferred.

Changed (harness only):
- `playwright.config.ts` — add a `portable` project (its own `globalSetup` runs
  `npm run build:portable`; no `webServer`); the existing `chromium` project
  untouched.
- `e2e/support/loop.ts` — `readRiskyFactory` already exported; add `simSnapshot`
  re-export if colocated elsewhere.

Unchanged: **all of `src/`.**

## 10. Order of work (each a reviewable commit)

1. **Spike + harness** (§6.1): `e2e/support/mc.ts` + `portable` project in the
   config. Run the spike, **report results** (esp. `file://` result capture).
2. `e2e/mc-paths.spec.ts` — byte-equality + message-level path proof (core).
3. `e2e/mc-paths.spec.ts` — mid-run progress + cancel-stops-callbacks +
   cancel-keeps-prior-result.
4. `e2e/mc-invalidation.spec.ts` — undo/redo/template (Cases A + B).
5. `e2e/portable-file.spec.ts` — portable `file://` end-to-end + byte-equal vs
   the http reference.
6. Full `--repeat-each=2`, review checkpoint, `--no-ff` merge.
