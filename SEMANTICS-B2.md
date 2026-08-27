# Execution semantics — Engine B, Part 2: Monte-Carlo (many runs)

**Status: FROZEN.** All decisions are settled (§MC0.1, §MC11, §MC12); the two
mandatory amendments — `loop-mc-seed/1` gains a `mulberry32` mixing step, and the
mean uses Neumaier compensated summation — are folded in. The §MC9 vectors are
frozen fixtures. Any change to `loop-mc/1` / `loop-mc-seed/1` is a new spec id,
never an in-place edit. Implementation proceeds on `feat/engine-b-monte-carlo`
in the order:

1. `runSeed` + vector tests
2. synchronous `runMonteCarlo`
3. exact aggregation + cancellation
4. CSV / JSON
5. portable-build Worker feasibility check
6. parallel driver, if feasible

Extends [`SEMANTICS.md`](./SEMANTICS.md) and [`SEMANTICS-B1.md`](./SEMANTICS-B1.md)
(`loop-rng/1`, frozen). Part 2 does **not** touch `step` or the RNG — it runs the
existing `step(nodes, edges, prev, seed)` many times with derived seeds and
aggregates. Section numbers `MC0…MC12`. Invariants continue the global series:
**I11, I12**.

---

## MC0. Scope

**Added**

- `RunConfig` — the experiment definition (§MC1).
- `runSeed(baseSeed, i)` — per-iteration seed, spec id **`loop-mc-seed/1`**
  (§MC2): FNV-1a **then one `mulberry32` output**, the same validated mixing
  path as `loop-rng/1`.
- Per-timestep bands (p10 / p50 / p90 / mean / min / max) for each tracked Pool,
  plus the final-value distribution as **raw run-index-ordered values**
  (§MC4–MC6, §MC8).
- `MonteCarloResult` + CSV/JSON exports (§MC8).
- Cancellation (→ `AbortError`, no result), progress, and a **5,000,000-cell**
  hard memory limit (§MC7).

**Unchanged** — `step`, `initSim`, `loop-rng/1`, all of Engine A. A run inside
Part 2 is byte-for-byte the run Part 1 produces for that seed.

**Deferred** — approximate/streaming quantiles for configs above the cell limit;
`p25`/`p75` (arrive with a result-spec version bump when a box-plot UI is added);
stdev / higher moments; "save a cancelled run's partial result" (a separate
future feature); convergence diagnostics.

### MC0.1 Settled decisions (this review round)

1. **`CELL_LIMIT = 5_000_000`** (hard). `cells = runs × (steps + 1) ×
   trackedPoolCount`. Above it the config is **rejected before any run executes**
   — warn-and-run is not allowed. Projected memory (including `final.values` and
   the transient sort buffer) is reported in the error. May be raised later once
   `TypedArray` storage + real Worker memory are measured (§MC7.4).
2. **Cancellation throws `AbortError`.** No standard `MonteCarloResult` is
   produced on cancel — a partial result would depend on batch size / Worker
   split and muddy I11. Only a clearly-`provisional` preview is allowed while
   running; `completedRuns` is exposed as cancellation status only (§MC7.2).
3. **No `final.sorted` / no histogram in the public result.** `final.values` is
   the raw terminal values **in run-index order**; `final.summary` is the six
   numbers. The sorted array exists only as a transient aggregation buffer. CSV
   keeps `run` + `seed` for traceability; a UI histogram is computed from
   `final.values` (§MC8).
4. **Worker model:** each Worker is initialised **once** with `{nodes, edges,
   normalized config}`; jobs are `{startRun, endRun}` index ranges; results carry
   the run index. No per-batch graph re-transfer, no `SharedArrayBuffer`. The
   synchronous pure implementation ships first; the parallel driver may be a
   follow-up commit if portable single-file Worker inlining is not verified
   (§MC7.1).
5. **`p25` / `p75` deferred** — `p10/p50/p90` are enough for an uncertainty
   band; quartiles land with a result-spec version bump alongside a real box
   plot.
6. **Template `recommendedRunConfig`** — optional template metadata (not
   `GraphDoc`): `{ baseSeed, runs, steps }`. No `tracked` (it is tightly coupled
   to template node ids; reviewed separately when needed) (§MC12).

---

## MC1. `RunConfig` — the experiment

```ts
type RunConfig = {
  baseSeed: number        // uint32, validated like SEMANTICS-B1.md §B1.3
  runs: number            // integer ≥ 1
  steps: number           // integer ≥ 1, max steps per run
  tracked: string[]       // Pool ids to record; [] = every Pool in the graph
}
```

- `RunConfig` is the **entire identity** of an experiment: same graph + same
  `RunConfig` ⇒ same `MonteCarloResult` (§I12), always.
- Execution knobs live in a separate `RunOptions` (§MC7) and never change the
  result (§I11).
- `tracked` ids that are not current Pools are dropped into
  `result.droppedTracked`. Narrowing `tracked` is the main memory lever (§MC7.4).
- A run executes `min(steps, stepsUntilEnded)` steps (§MC3).

---

## MC2. Per-iteration seed — `loop-mc-seed/1`

Run `i` (`i = 0 … runs − 1`, **0-based**) executes as
`step(…, runSeed(baseSeed, i))`.

```
// spec: loop-mc-seed/1   — same mixing path as loop-rng/1 (SEMANTICS-B1.md §B1.2)
runSeed(baseSeed, i):
    key  = String(baseSeed) + "|run|" + String(i)     // decimal, no separators
    return mix32(key).out                              // FNV-1a 32-bit → one mulberry32 output → uint32
```

`mix32(key)` is the shared `loop-rng/1` primitive: UTF-8 bytes → FNV-1a 32-bit
(`hash`) → one `mulberry32` output (`out`, uint32). `runSeed` is that `out`. It
is a plain `uint32` and flows into `loop-rng/1` unchanged, so every §B1 property
holds inside each run.

- **Keyed, not sequential.** `runSeed` depends only on `baseSeed` and `i` —
  never on `runs`, execution order, batch size, or Worker count. Extending a
  `0…7` job to `0…15` leaves runs `0…7` bit-identical.
- **`baseSeed` is the only control.**
- **Collisions:** two indices could produce the same `uint32` (~1 in 2³² per
  pair). Not incorrect — the two runs give the identical trace (one sample point
  counted twice) — and negligible at practical `runs`. Elimination would be
  `loop-mc-seed/2` (rejection-resample); out of scope.

---

## MC3. Runs that end early

`step` sets `state.ended = true` when an End node receives `> epsilon`. In
Part 2:

- The run **stops** at the step it ends; no further `step` calls.
- Record `endedAtStep[i]` = the step it ended on, or `null` if it ran the full
  `steps`.
- **Carry-forward.** For any timestep `t` greater than a run's end step, that run
  contributes its **terminal Pool values** (last-observation-carried-forward).
  An ended economy is frozen — nothing flows after `ended` — so carry-forward is
  **exact**, not an approximation. Every per-timestep band therefore has constant
  `n = completedRuns` for all `t ∈ [0, steps]`.
- `result.endedRuns.atOrBeforeStep[t]` = number of runs ended by step `t`
  (monotone non-decreasing), for UI shading.

`t = 0` (initial state) is always included; all runs are identical there.

---

## MC4. Quantiles — method and interpolation

One definition everywhere: **R-7 / linear on `(n − 1)q`** (NumPy's and pandas'
default `linear`). Deterministic for any `n ≥ 1`.

```
quantile(sortedAsc, q):            // ascending, q ∈ [0, 1], n = length
  if n == 0:  return NaN           // only when completedRuns == 0
  if n == 1:  return sortedAsc[0]
  h    = (n - 1) * q
  lo   = floor(h)
  frac = h - lo
  return sortedAsc[lo] + frac * (sortedAsc[min(lo + 1, n - 1)] - sortedAsc[lo])
```

Every aggregate (min, max, quantiles, mean) is computed from the **ascending-
sorted** array of the `n` per-run values for that `(pool, t)`. Sorting first is
what makes the whole result independent of execution order (§I11).

- `p10 = quantile(·, 0.10)`, `p50 = quantile(·, 0.50)` (median),
  `p90 = quantile(·, 0.90)`.
- No other percentiles in Part 1 (see MC0 deferred).

---

## MC5. Per-timestep bands

For every tracked Pool `P` and every `t ∈ [0, steps]`, over
`x = sortedAsc( value of P in run i at timestep t )`:

| field | definition |
|---|---|
| `p10[t]`, `p50[t]`, `p90[t]` | `quantile(x, 0.10 / 0.50 / 0.90)` |
| `mean[t]` | `neumaier(x) / n` — Neumaier compensated sum of the **sorted** values (§MC6) |
| `min[t]` | `x[0]` |
| `max[t]` | `x[n − 1]` |

All six are arrays of length `steps + 1`, indexed by `t`.

---

## MC6. Summaries included, and how the mean is pinned

- **Included:** `mean`, `min`, `max` alongside `p10/p50/p90`.
- **Not in Part 1:** stdev / variance, skew, mode, CIs. (`p25/p75` deferred to a
  result-spec bump.)
- **Mean is order-pinned for I11 via sorted + Neumaier summation.** Sorting
  alone already makes min / max / quantiles order-independent; the mean also
  needs its addition order fixed *and* wants low error when large and small
  magnitudes mix. So:

  ```
  neumaier(xs):                      // xs already ascending-sorted
    sum = 0; c = 0
    for x in xs:
      t = sum + x
      if |sum| >= |x|:  c += (sum - t) + x
      else:             c += (x - t) + sum
      sum = t
    return sum + c

  mean = neumaier(sortedAsc) / n
  ```

  With this rule the entire `MonteCarloResult` is a pure, bit-stable function of
  the multiset of per-run traces, regardless of how execution was scheduled.

---

## MC7. Execution — options, invariance, limits

```ts
type RunOptions = {
  workers?: number            // ≥ 1; default 1 (synchronous). Optimisation only.
  batchSize?: number          // run indices per work unit; default 64
  progressEvery?: number      // emit progress at least every N runs; default 64
  onProgress?: (p: MonteCarloProgress) => void   // see §MC7.3
  signal?: AbortSignal
}
```

### MC7.1 Invariance (I11) & the Worker model

`workers`, `batchSize`, `progressEvery`, `onProgress`, sync vs async — **none**
change any result field. Rests on: run seed pure in `i` (§MC2); aggregation
sorts before summarising (§MC4); mean is sorted + Neumaier (§MC6).

- **Reference implementation is synchronous, single-threaded:**
  `runMonteCarlo(nodes, edges, config): MonteCarloResult` — a pure function. It
  ships first and is always the fallback.
- **Parallel driver** `runMonteCarloParallel(nodes, edges, config, options)`
  must return a result that compares **equal** to the reference.
  - Each Worker is initialised **once**: `init(nodes, edges, normalizedConfig)`.
    No graph re-transfer per batch. No `SharedArrayBuffer`.
  - A job is a half-open run-index range `[startRun, endRun)`.
  - A reply is a **structured envelope** — the numbers are one flat
    `Float64Array`, no header packed inside it:

    ```ts
    type WorkerBatchResult = {
      startRun: number
      endRun: number                 // half-open: covers startRun … endRun-1
      poolIds: string[]              // the normalized tracked order
      steps: number
      values: Float64Array           // run-major, see below; values.buffer is Transferable
    }
    ```

  - **Run-major layout**, `poolCount = poolIds.length`, `localRun = run −
    startRun`:

    ```
    index = ((localRun * (steps + 1) + step) * poolCount) + poolIndex
    ```

  - `values.buffer` is transferred (not copied). The main thread merges each
    batch into its global storage at the batch's `[startRun, endRun)` position,
    then aggregates once all runs are in.
  - **The final result is byte-identical for any `workers` count or `batchSize`.**
  - Portable single-file build: Worker inlining via `vite-plugin-singlefile` is
    an implementation checkpoint (same class of check as `TextEncoder` in
    Part 1). If it does not hold, the parallel driver is a **follow-up commit**;
    the sync path still delivers correct results.

### MC7.2 Cancellation

`signal.aborted` is checked at **batch boundaries** (never mid-run). On abort,
`runMonteCarlo` / `runMonteCarloParallel` **throws `AbortError`** — no
`MonteCarloResult` is returned. The error carries `completedRuns` (status only).
Any provisional preview is discarded before the throw.

- Persisting a cancelled run's partial data is a separate future feature with its
  own design.

### MC7.3 Progress and the provisional preview

`onProgress` is a **separate lightweight type**, structurally incompatible with
`MonteCarloResult` so a mid-flight value can never reach a save or export path:

```ts
type MonteCarloProgress = {
  provisional: true
  completedRuns: number
  totalRuns: number
  progress: number               // completedRuns / totalRuns ∈ [0, 1]
  preview?: {
    // a limited UI-only summary — e.g. current p50 band per tracked pool.
    // NO final.values, NO frozen-method quantiles, NO CSV/JSON export fields.
  }
}
```

`onProgress(p: MonteCarloProgress)` fires at least every `progressEvery`
completed runs and once at natural completion (`completedRuns === totalRuns`).
It is side-effect-free w.r.t. the result (I11) and is **not** called after an
abort throw. `preview` contents are advisory and not covered by the frozen
method definitions; only the returned `MonteCarloResult` is.

### MC7.4 Memory limit

Exact R-7 quantiles require holding, per tracked Pool per timestep, all `runs`
values.

```
cells = runs × (steps + 1) × trackedPoolCount
```

- **`cells > CELL_LIMIT` (5_000_000) ⇒ the config is rejected before any run
  executes.** The error names the three knobs (`runs`, `steps`, `tracked`) and
  reports the projected footprint:

  ```
  seriesCells   = runs × (steps + 1) × trackedPoolCount     // f64 band storage (main thread)
  finalCells    = runs × trackedPoolCount                    // final.values
  sortBuffer    ≈ runs × trackedPoolCount                    // transient, one (pool,t) column reused
  workerBuffers ≈ workers × batchSize × (steps + 1) × trackedPoolCount   // batch envelopes alive at once
  projectedBytes ≈ (seriesCells + finalCells + sortBuffer + workerBuffers) × 8   + JS array / structured-clone overhead
  ```

  The `workerBuffers` term is included even for the synchronous path (`workers
  = 1`, one batch buffer at a time) so the projection is an upper bound.

- Warn-and-run is **not** an option.
- Raising the limit later requires switching band storage to `TypedArray` and
  measuring real Worker transfer cost; a `loop-mc/2` streaming/t-digest path
  (approximate quantiles, bounded memory) is the intended escape hatch above the
  limit.

---

## MC8. Result structure

### MC8.1 JSON — `MonteCarloResult`

```ts
type MonteCarloResult = {
  spec: 'loop-mc/1'
  seedSpec: 'loop-mc-seed/1'
  rngSpec: 'loop-rng/1'
  config: RunConfig
  completedRuns: number          // always == config.runs (cancel throws, §MC7.2)
  droppedTracked: string[]

  pools: { id: string; label: string }[]     // tracked Pools, in graph order
  runSeeds: number[]             // runSeeds[i] = runSeed(config.baseSeed, i); length runs

  endedRuns: { atOrBeforeStep: number[] }    // length steps+1, monotone

  series: Record<string /* poolId */, {
    p10: number[]; p50: number[]; p90: number[]
    mean: number[]; min: number[]; max: number[]
  }>                              // each array length steps+1

  final: Record<string /* poolId */, {
    values: number[]              // terminal value per run, in RUN-INDEX order; length runs
    summary: { p10: number; p50: number; p90: number; mean: number; min: number; max: number }
  }>
}
```

- No `cancelled` field — cancellation is an exception, not a result state.
- `final[P].values[i]` is Pool `P` in run `i` at its last executed step (== the
  value at `t = steps` after carry-forward), kept in **run-index order** so it
  joins to `runSeeds[i]`.
- Field order and array indexing are part of the frozen contract (byte-stable
  JSON).

### MC8.2 CSV

Three flat files, `\n`-terminated, labels sanitised with
`replace(/[",\n]/g, ' ')` (as the existing timeline CSV):

**`montecarlo-series.csv`** — one row per `(step, pool)`:
```
step,pool,p10,p50,p90,mean,min,max
```

**`montecarlo-final.csv`** — one row per run, wide over Pools, with the seed
inline. **Rows are in run-index order**, so row `i` corresponds exactly to
`result.runSeeds[i]` and `result.final[P].values[i]`. This one file reproduces
every run on its own — no separate seed map.
```
run,seed,<PoolLabelA>,<PoolLabelB>,...
0,1119822658,...
1,2846739420,...
```

**`montecarlo-final-summary.csv`** — one row per Pool (`pool` = its label):
```
pool,p10,p50,p90,mean,min,max
```

---

## MC9. Draft test vectors

From the real `loop-rng/1` engine + `loop-mc-seed/1` + the `quantile` / Neumaier
definitions above. Frozen on review.

### `runSeed(baseSeed = 1, i)` — `loop-mc-seed/1`

| i | key | FNV-1a (`mix32.hash`) | `runSeed` (`mix32.out`) |
|--:|---|---|--:|
| 0 | `1\|run\|0` | `0x20d40ea1` | 1119822658 |
| 1 | `1\|run\|1` | `0x1fd40d0e` | 2846739420 |
| 2 | `1\|run\|2` | `0x1ed40b7b` | 1652246540 |
| 3 | `1\|run\|3` | `0x1dd409e8` | 2344041868 |
| 4 | `1\|run\|4` | `0x24d414ed` | 2234127498 |
| 5 | `1\|run\|5` | `0x23d4135a` | 2381107215 |
| 6 | `1\|run\|6` | `0x22d411c7` | 3605042148 |
| 7 | `1\|run\|7` | `0x21d41034` | 3442733231 |

### V1 — Source `[1-3]` → uncapped Pool P, `baseSeed 1`, `runs 8`, `steps 3`

Per-run `P` trace (`t = 0…3`), run 0…7:

```
[0,3,6,9] [0,3,4,6] [0,3,5,6] [0,2,4,7] [0,1,2,3] [0,2,3,5] [0,2,5,8] [0,2,5,7]
```

Aggregated bands for `P`:

| t | sorted values | p10 | p50 | p90 | mean | min | max |
|--:|---|--:|--:|--:|--:|--:|--:|
| 0 | 0,0,0,0,0,0,0,0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 1,2,2,2,2,3,3,3 | 1.7 | 2 | 3 | 2.25 | 1 | 3 |
| 2 | 2,3,4,4,5,5,5,6 | 2.7 | 4.5 | 5.3 | 4.25 | 2 | 6 |
| 3 | 3,5,6,6,7,7,8,9 | 4.4 | 6.5 | 8.3 | 6.375 | 3 | 9 |

`p10` values are shown rounded; the fixture compares the computed array (e.g.
`p10[t=1]` is `1 + 0.7·(2 − 1)` = `1.7000000000000002` in IEEE-754). Hand-check
`p90` at `t = 3`: `n = 8`, `h = 6.3`, `x[6] + 0.3·(x[7] − x[6]) = 8 + 0.3 =
8.3`. ✔ `p50` at `t = 2`: `h = 3.5`, `x[3] + 0.5·(x[4] − x[3]) = 4 + 0.5 =
4.5`. ✔

### V2 — mixed endings + carry-forward

`Source [1-3] → P(cap 6)`; `P —[4, pull all]→ End Z`. `baseSeed 1`, `runs 8`,
`steps 6`.

| run | endedAtStep | `P` trace `t = 0…6` |
|--:|--:|---|
| 0 | 3 | 0,3,6,2,2,2,2 |
| 1 | 3 | 0,3,4,2,2,2,2 |
| 2 | 3 | 0,3,5,2,2,2,2 |
| 3 | 3 | 0,2,4,2,2,2,2 |
| 4 | 5 | 0,1,2,3,6,2,2 |
| 5 | 4 | 0,2,3,5,2,2,2 |
| 6 | 3 | 0,2,5,2,2,2,2 |
| 7 | 3 | 0,2,5,2,2,2,2 |

`endedRuns.atOrBeforeStep[0…6] = [0, 0, 0, 6, 7, 8, 8]`. From each run's
`endedAtStep` on, its `P` column repeats (carry-forward), so bands there flatten.

### Neumaier vs naive (mean stability)

`xs = [1e16, 1, −1e16, 1, 1, 1]`. Naive left-to-right sum is order-dependent
(`3` as given, `0` after ascending sort — the small terms vanish). `neumaier`
over the ascending-sorted array returns `4` (exact). The spec's mean uses the
latter.

### Statistical-tolerance vectors (large `runs`, asserted with a band)

Deterministic (fixed `baseSeed`), checked with tolerance not exact equality —
they exercise plumbing, not RNG quality:

- **S1** — `Source [1-3] → uncapped P`, `runs 20000`, `steps 10`. `E[1-3] = 2` ⇒
  `E[P@t] = 2t`. Assert `|mean[t] − 2t| < 0.05` and `p50[t]` within `±1` of `2t`.
- **S2** — probabilistic Gate, weights `[1, 3]`, one unit routed/step,
  `runs 20000`, `steps 1`. Fraction routed to the weight-3 branch ∈ `0.75 ±
  0.01`.
- **S3** — `2D6` per step into a Pool, `runs 20000`, `steps 1`. `mean[1] ∈ 7 ±
  0.1`; `p10[1] ∈ [4, 5]`, `p90[1] ∈ [9, 10]`.

- **I11 test** — the same `RunConfig` via `workers: 1`, `workers: 4`, and a
  shuffled batch order all produce byte-identical `series` and `final`.

---

## MC10. Invariants (additions)

I1–I10 unchanged.

| # | Invariant |
|---|---|
| **I11** | **Execution invariance.** Every `MonteCarloResult` field is bit-identical regardless of Worker count, batch size, run execution order, progress cadence, or sync vs async. Rests on: per-run seed pure in `i` (§MC2); aggregation sorts before summarising (§MC4); mean is sorted + Neumaier (§MC6). |
| **I12** | **Monte-Carlo determinism.** Same graph + same `RunConfig` ⇒ identical `MonteCarloResult` on every invocation and machine. `runMonteCarlo` is pure in `(nodes, edges, config)`; `loop-mc/1` + `loop-mc-seed/1` + `loop-rng/1` are all pinned. |

---

## MC11. Resolved (final review round)

1. **`montecarlo-final.csv`** — seed inline per row (`run,seed,<pools…>`), rows
   in run-index order matching `runSeeds[]`. One file reproduces every run; no
   separate map (§MC8.2).
2. **Provisional preview** — a distinct lightweight type `MonteCarloProgress`
   (`provisional: true`), structurally incompatible with `MonteCarloResult`; no
   `final.values`, no frozen-method quantiles, no export fields; discarded on
   cancel before the `AbortError` (§MC7.3).
3. **Worker transport** — one flat run-major `Float64Array` in a structured
   envelope (`{ startRun, endRun, poolIds, steps, values }`), no header packed
   in the array; `values.buffer` Transferable;
   `index = ((localRun·(steps+1) + step)·poolCount) + poolIndex` (§MC7.1).

`SEMANTICS-B2.md` and the §MC9 vectors are **frozen** as of this round.

---

## MC12. Decisions log (this part)

1. **`loop-mc-seed/1`** → `runSeed(baseSeed, i) = mix32("<baseSeed>|run|<i>").out`
   — FNV-1a 32-bit **then one `mulberry32` output**, the shared `loop-rng/1`
   mixing path. 0-based `i`. Vectors in §MC9.
2. **Quantiles** → R-7 / linear on `(n−1)q`, `n ≥ 1`, always after an ascending
   sort. Only `p10/p50/p90`; `p25/p75` deferred to a result-spec bump.
3. **Mean** → `neumaier(sortedAsc) / n` — sorted for order-invariance, Neumaier
   for mixed-magnitude accuracy.
4. **Early-ended runs** → stop, record `endedAtStep`, carry terminal values
   forward (exact). Constant `n` at every timestep.
5. **`CELL_LIMIT = 5_000_000`**, `cells = runs × (steps+1) × trackedPoolCount`,
   rejected up front with a projected-memory report. No warn-and-run.
6. **Cancellation** → throw `AbortError`, no `MonteCarloResult`; discard the
   preview first. `completedRuns` is status only. Preview is the separate
   `MonteCarloProgress` type (`provisional: true`) — no export path.
7. **`final`** → `values` in run-index order + `summary`; no `sorted`, no
   histogram in the public result. `montecarlo-final.csv` = `run,seed,<pools…>`
   in run-index order, matching `runSeeds[]` — reproduces every run alone.
8. **Workers** → init graph once per Worker; jobs are half-open `[startRun,
   endRun)`; a reply is a structured envelope with one **run-major** flat
   `Float64Array` (`index = ((localRun·(steps+1)+step)·poolCount)+poolIndex`),
   `values.buffer` Transferable, no in-array header; no per-batch graph
   transfer, no SAB. Sync pure impl first; parallel driver is the last,
   independent checkpoint after sync core + aggregation + export pass.
9. **Template `recommendedRunConfig`** → `{ baseSeed, runs, steps }` in template
   metadata only (never `GraphDoc`); no `tracked`.
10. **Memory projection** includes `workerBuffers ≈ workers · batchSize ·
    (steps+1) · trackedPoolCount` alongside the main-thread storage.
11. **Invariants** → I11 (execution invariance), I12 (Monte-Carlo determinism).
