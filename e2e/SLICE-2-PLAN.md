# Browser E2E — slice 2 plan (for review, no code yet)

Branch: `test/browser-e2e-2`. Shared input fixture: `examples/risky-factory.json`.

Goal: prove the **HTTP Worker path** and the **portable `file://` cooperative
path** produce the same Monte-Carlo result, that progress/cancel behave under
each, and that undo/redo + template swap invalidate sim/MC state correctly.

Principle: **no product-code changes.** One optional change is flagged in §8 and
will not be made without approval. Everything else is Playwright harness + specs.

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

### Harness levers (both via `page.addInitScript`, before app code runs)

1. **Force the path on http** by redefining the reading:
   ```js
   Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => N, configurable: true })
   ```
   `N = 8` ⇒ `defaultWorkerCount()` = 4 ⇒ **Worker path**.
   `N = 1` ⇒ `defaultWorkerCount()` = 1 ⇒ **cooperative path**.
   This is a test-environment value, not app behaviour — the app already reads it
   at call time and adapts.

2. **Prove a Worker was actually constructed**:
   ```js
   window.__workerCtors = 0
   const R = window.Worker
   window.Worker = class extends R { constructor(...a){ window.__workerCtors++; super(...a) } }
   ```
   - Worker path ⇒ `__workerCtors > 0`
   - cooperative path (`N=1` or `file://`) ⇒ `__workerCtors === 0`
   Readable with `page.evaluate` even on the bridge-less portable page.

3. **`file://` needs nothing forced** — `canUseWorkers()` returns `false` from the
   protocol check, so cooperative is guaranteed; the spy's `0` confirms it and a
   bridge/DOM assertion of `canUseWorkers() === false` is redundant but cheap on
   http-served portable (not attempted on `file://`).

### What each spec asserts about the path

| spec | how the path is pinned | proof it ran |
|---|---|---|
| worker run (http) | initscript `hardwareConcurrency = 8` | `__workerCtors >= 2`, result correct |
| cooperative run (http) | initscript `hardwareConcurrency = 1` | `__workerCtors === 0`, result correct |
| portable run (`file://`) | real `file:` protocol | `__workerCtors === 0`, no dev server, result correct |

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
- portable `file://` vs http reference: compare the **exported JSON files**
  (Export ▾ → JSON) for the same `500 × 40, baseSeed 1` config — see §6.

---

## 3. Mid-run progress observation + callbacks stop after cancel

The store's `onProgress` does `if (get().status !== 'running') return; set({progress, completedRuns})`.
`runMonteCarloParallel` fires progress every 64 completed runs (and once at the
end); on abort it `reject`s and the internal `done()` guard makes any late
worker message a no-op (`if (settled) return`), and removes the `abort`
listener. `runMonteCarloCooperative` fires at batch boundaries and, on abort,
throws out of the loop and `dispose()`s the MessageChannel — no queued yield
callbacks survive.

### Observation (http, both paths, via the bridge)

- Size the run so wall-time is comfortably > ~1 s (e.g. `2000 × 40`, all pools;
  cells = 2000·41·8 = 656 k < 5 M limit).
- `expect.poll` on `mc.getState()` and record: at least one sample with
  `0 < progress < 1` **and** `status === 'running'` ⇒ *mid-run progress seen*.
- Let it finish: `progress === 1`, `status === 'done'`.

### Callbacks stop after cancel (http, both paths)

- Start a large run (`5000 × 40`, all pools = 1.64 M cells).
- Poll until `completedRuns` is in `(0, 5000)` and `status === 'running'`.
- `mc.cancel()` (or click the strip **Cancel**).
- Poll until `status !== 'running'`; snapshot `completedRuns` as `X`.
- Wait 750 ms, re-read: assert `completedRuns === X` (frozen — no callback
  advanced it), `progress === 0` (the catch resets it), `message === 'Cancelled'`.

### Portable `file://` (DOM only, no bridge)

- Progress: the strip shows `Monte Carlo NN%` (`.pstrip__mcprog`); assert its text
  advances past `0%` and below `100%` while `status` is running, then the run
  completes and DISTRIBUTION appears.
- Cancel: click the strip **Cancel**; assert `.pstrip__mcprog` disappears, the
  button reads `Monte Carlo · Cancelled` briefly, and the `%` text seen just
  before cancel does not increase afterwards (poll twice, 500 ms apart).

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
- **Read the result for byte-equality**: Export ▾ → **JSON**, capture the
  `download`, parse the file. An http context exports the same config's JSON;
  the two files are compared byte-for-byte.
  - **Open risk to confirm in step 1 of implementation**: whether Chromium fires
    a `download` event for a `blob:` download initiated from a `file://` page
    under Playwright. The download originates from a `blob:` URL (not the
    `file:` origin) via `a.download` + `a.click()`, which is how slice 1's export
    spec already works on http — so it is *expected* to work. If it does not,
    the fallback in §8 applies (needs approval).

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

1. Import risky-factory, run a small MC (`120 × 20`) → `stale === false`,
   `view === 'distribution'`, Export enabled.
2. Advance the live sim a few steps (`sim.stepOnce()` ×3) → `stepIndex === 3`.
3. **Undo** an earlier structural edit (make one first: e.g.
   `graph.updateNodeData(<pool>, {capacity: 999})` so `canUndo` is true), then
   `graph.undo()`:
   - `mc.getState().stale === true`, `result` still present (viewable)
   - Export menu button `disabled` (`.dist__stats .menu button[disabled]`, title
     "Result is stale — re-run to export")
   - `sim.getState().stepIndex === 0`, `status === 'idle'` (sim was reset)
4. **Redo** (`graph.redo()`): still `stale === true` (redo bumps rev too),
   result still present.
5. Re-run MC → `stale === false`, fresh `result`, Export enabled again.
6. **Config edit does NOT stale** (re-affirm slice 1): with a fresh result,
   `mc.setConfig({runs: 300})` ⇒ `stale` stays `false`, `result` unchanged.
7. **Template swap**: `page.on('dialog', d => d.accept())`, open Templates ▾,
   pick "Flowing equilibrium":
   - `graphSnapshot` now shows the template's nodes (risky-factory gone)
   - `mc.getState().stale === true`, result still viewable
   - `mc.getState().config.tracked` — reconciled: risky-factory pool ids no
     longer match, so it falls to `[<first template pool id>]` (per
     `reconcileTracked`: empty intersection + pools remain ⇒ first pool; never
     widens to "all")
   - `sim.getState().status === 'idle'`, `stepIndex === 0`
8. Swap while a **live run** is active: `sim.play()`, then pick the other
   template — `Templates.pick()` pauses first; assert `sim.status !== 'running'`
   and `stepIndex === 0` after.

---

## 8. The one potential product-code change (flagged, not made)

**Only if** the `file://` blob-download for JSON export does not fire under
Playwright (see §6 risk). Fallback:

> In `src/main.tsx`, widen the bridge guard from `import.meta.env.DEV` to
> `import.meta.env.DEV || new URLSearchParams(location.search).has('__e2e')`, and
> have the portable spec load `loop-studio.html?__e2e=1`.

- ~2 lines, additive, **opt-in via an explicit query param** — no effect on any
  real user who never appends `?__e2e=1`.
- Would let the `file://` spec read `window.__loop.mc.getState().result`
  directly, same as the http specs.

Preference order: (a) download-based, no change; (b) this opt-in un-gate. Will
report which one is needed after the step-1 spike and **wait for approval**
before touching `main.tsx`.

---

## 9. File / config plan

New:
- `e2e/support/mc.ts` — `simSnapshot`, `mcResultJson(page)`, `forcePath(page, 'worker'|'coop')`
  (hardwareConcurrency initscript), `installWorkerSpy(page)`, `workerCtorCount(page)`,
  `readPortableUrl()`, `importGraphFile(page, path)` (setInputFiles).
- `e2e/mc-paths.spec.ts` — §1–§4 on http (worker vs cooperative): byte-equal,
  worker spy, mid-run progress, cancel stops callbacks, cancel keeps prior result.
- `e2e/mc-invalidation.spec.ts` — §7.
- `e2e/portable-file.spec.ts` — §5–§6 on `file://`.
- Possibly `e2e/fixtures/risky-factory.mc-500x40.json` — a committed reference
  `MonteCarloResult` for the portable byte-equal check (generated from the http
  run, ~1–2 MB; or regenerated in `globalSetup` to avoid committing a big blob —
  decide at review).

Changed (harness only):
- `playwright.config.ts` — add the `portable` project + build step; keep the
  existing `chromium` project untouched.
- `e2e/support/loop.ts` — export `readRiskyFactory` is already there; add
  `simSnapshot` if not colocated in `mc.ts`.

Unchanged: all of `src/`.

## 10. Order of work (each a reviewable commit)

1. Harness: `e2e/support/mc.ts` + config `portable` project + the `file://`
   download spike (report result; get §8 decision if needed).
2. `e2e/mc-paths.spec.ts` — byte-equality + worker spy (the core proof).
3. `e2e/mc-paths.spec.ts` — progress + cancel semantics.
4. `e2e/mc-invalidation.spec.ts` — undo/redo/template.
5. `e2e/portable-file.spec.ts` — portable `file://` end-to-end.
6. Full `--repeat-each=2`, review checkpoint, `--no-ff` merge.
