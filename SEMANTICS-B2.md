# Execution semantics — Engine B, Part 2: Monte-Carlo (many runs)

**Status: DRAFT for review.** Nothing here is frozen. Once reviewed, the vectors
in §MC9 become frozen fixtures and implementation begins on
`feat/engine-b-monte-carlo`.

Extends [`SEMANTICS.md`](./SEMANTICS.md) (Engine A, frozen) and
[`SEMANTICS-B1.md`](./SEMANTICS-B1.md) (`loop-rng/1`, frozen). Part 2 does **not**
touch the step function or the RNG — it runs the *existing* `step(nodes, edges,
prev, seed)` many times with derived seeds and aggregates the results. Section
numbers are `MC0…MC10`. Invariants continue the global series: **I11, I12**.

Part 1 established that one run is reproducible from a seed. Part 2's job is to
turn *many* such runs into distribution bands, and to make that aggregation
itself reproducible and independent of how the work is scheduled.

---

## MC0. Scope

**Added**

- `RunConfig` — the experiment definition (§MC1).
- A **per-iteration seed derivation** `runSeed(baseSeed, i)` — spec id
  **`loop-mc-seed/1`** (§MC2).
- Per-timestep distribution bands (p10 / p50 / p90 / mean / min / max) for each
  tracked Pool, plus the final-value distribution (§MC4–MC6).
- A `MonteCarloResult` object and CSV/JSON exports (§MC8).
- Cancellation, progress, and a hard memory ceiling (§MC7).

**Unchanged** — `step`, `initSim`, `loop-rng/1`, all of Engine A. A run inside
Part 2 is byte-for-byte the run Part 1 already produces for that seed.

**Deferred (possible `loop-mc/2`)** — approximate/streaming quantiles (t-digest)
for configs above the exact-aggregation ceiling; stdev / higher moments;
convergence diagnostics; per-edge flow distributions.

---

## MC1. `RunConfig` — the experiment

```ts
type RunConfig = {
  /** base seed; uint32 (validated like SEMANTICS-B1.md §B1.3) */
  baseSeed: number
  /** number of iterations, integer ≥ 1 */
  runs: number
  /** max steps per run, integer ≥ 1 */
  steps: number
  /** Pool ids to record. [] means "every Pool in the graph". */
  tracked: string[]
}
```

- `RunConfig` is the **entire identity** of an experiment: the same graph + the
  same `RunConfig` ⇒ the same `MonteCarloResult` (§I12), always.
- Execution knobs — Worker count, batch size, progress callback, cancel signal —
  are **not** in `RunConfig`. They live in a separate `RunOptions` (§MC7) and are
  guaranteed not to change the result (§I11).
- `tracked` entries that are not current Pool ids are dropped and listed in
  `result.droppedTracked`; recording fewer Pools is the main memory lever (§MC7).
- A run executes `min(steps, stepsUntilEnded)` steps; see §MC3.

---

## MC2. Per-iteration seed — `loop-mc-seed/1`

Run `i` (`i = 0 … runs−1`) is executed as `step(…, runSeed(baseSeed, i))`.

```
// spec: loop-mc-seed/1   (reuses loop-rng/1's fnv1a32, SEMANTICS-B1.md §B1.2)
runSeed(baseSeed, i) = fnv1a32( String(baseSeed) + "|run|" + String(i) )   // uint32
```

- **Keyed, not sequential.** Run `i`'s seed depends only on `baseSeed` and `i` —
  never on how many runs there are, the order they execute, the batch size, or
  the Worker count. Adding runs `8…15` to an existing `0…7` job leaves runs
  `0…7` bit-identical.
- **`baseSeed` is the only control.** Changing it re-derives every run.
- **Collisions.** Two indices could hash to the same `uint32` (32-bit; ~1 in
  2³² per pair). A collision is not incorrect — the two runs produce the
  identical trace, i.e. one sample point counted twice — and is astronomically
  unlikely at practical `runs`. If it ever needs eliminating, that is
  `loop-mc-seed/2` (rejection-resample); not in Part 1's scope.
- The derived value is a plain `uint32` seed and flows into `loop-rng/1`
  unchanged, so every §B1 property (I6, I8, I9, I10) holds within each run.

---

## MC3. Runs that end early

`step` sets `state.ended = true` when an End node receives `> epsilon`
(`SEMANTICS.md` §6). In Part 2:

- The run **stops** at the step it ends; no further `step` calls for that run.
- Record `endedAtStep[i]` = the step index it ended on, or `null` if it ran the
  full `steps` without ending.
- **Carry-forward for aggregation.** For any timestep `t` greater than a run's
  end step, that run contributes its **terminal Pool values** (last-observation-
  carried-forward). An ended economy is frozen — nothing flows after `ended` —
  so its Pool values genuinely do not change; carry-forward is exact, not an
  approximation.
- Consequence: every per-timestep band is computed over the **full** `runs`
  sample at every `t ∈ [0, steps]` (constant `n`), so bands never jump from
  changing sample size.
- `result.endedRuns.atOrBeforeStep[t]` = how many runs had ended by step `t`
  (monotone non-decreasing). The UI can shade the region where runs have started
  terminating.

Step 0 (the initial state) is always included as `t = 0`; all runs are identical
there, so every band collapses to the initial value.

---

## MC4. Quantiles — method and interpolation

One definition, everywhere: **R-7 / linear on `(n−1)q`** (NumPy's and
`pandas`' default `linear` method). Deterministic for any `n ≥ 1`.

```
quantile(sortedAsc, q):          // sortedAsc ascending, q ∈ [0, 1], n = length
  if n == 0:  return NaN         // only when completedRuns == 0
  if n == 1:  return sortedAsc[0]
  h    = (n - 1) * q
  lo   = floor(h)
  frac = h - lo
  return sortedAsc[lo] + frac * (sortedAsc[min(lo + 1, n - 1)] - sortedAsc[lo])
```

- **Always sort first.** Every aggregate (min, max, quantiles, mean) is computed
  from the ascending-sorted array of the `n` per-run values for that
  `(pool, t)`. This is what makes the result independent of execution order
  (§I11).
- p10 = `quantile(·, 0.10)`, p50 = `quantile(·, 0.50)` (the median), p90 =
  `quantile(·, 0.90)`.
- No other percentiles in Part 1. p25/p75 (IQR) would be a trivial `loop-mc/2`
  add if the UI wants a box.

---

## MC5. Per-timestep bands

For every tracked Pool `P` and every `t ∈ [0, steps]`, over the `n` per-run
values `x = sortedAsc( value of P in run i at timestep t )`:

| field | definition |
|---|---|
| `p10[t]` | `quantile(x, 0.10)` |
| `p50[t]` | `quantile(x, 0.50)` |
| `p90[t]` | `quantile(x, 0.90)` |
| `mean[t]` | `(Σ x) / n` — **summed in ascending sorted order** (§MC6) |
| `min[t]` | `x[0]` |
| `max[t]` | `x[n−1]` |

All six are arrays of length `steps + 1`, indexed by `t`.

---

## MC6. Which summaries are included, and how the mean is pinned

- **Included:** `mean`, `min`, `max` — alongside `p10/p50/p90`. Cheap, and every
  one is unambiguous.
- **Not in Part 1:** stdev / variance, skew, mode, geometric mean, confidence
  intervals on the mean. (`loop-mc/2` if asked.)
- **Mean is order-pinned for I11.** Floating-point addition is not associative,
  so a parallel reduction could shift the mean by a ULP. To keep the result
  **bit-identical** regardless of scheduling, `mean` is defined as

  ```
  mean = sum(sortedAsc) / n           // add the SORTED values, ascending, left to right
  ```

  Min, max, and the quantiles are already sort-based and therefore
  order-independent. With this rule the entire `MonteCarloResult` is a pure
  function of the multiset of per-run traces.

---

## MC7. Execution — options, invariance, limits

```ts
type RunOptions = {
  workers?: number            // ≥ 1; default 1 (synchronous). Optimisation only.
  batchSize?: number          // runs dispatched per unit of work; default 64
  progressEvery?: number      // emit progress at least every N runs; default 64
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}
```

### MC7.1 Invariance (I11)

`workers`, `batchSize`, `progressEvery`, `onProgress`, sync vs async — **none**
change `series`, `final`, `endedRuns`, or any other result field. Guaranteed by:
run `i`'s seed = `runSeed(baseSeed, i)` (pure in `i`); aggregation sorts before
summarising; the mean is summed in sorted order (§MC6).

The **reference implementation is synchronous, single-threaded**
(`runMonteCarlo(nodes, edges, config)` — a pure function). A parallel driver
(`runMonteCarloParallel(nodes, edges, config, options)`) must return a result
that compares equal to the reference. (Portable single-file build: Worker
inlining via `vite-plugin-singlefile` is an implementation checkpoint — same
class of check as `TextEncoder` in Part 1; the sync path is always available as
the fallback.)

### MC7.2 Cancellation

`signal.aborted` is checked at **batch boundaries** (never mid-run — a partial
run would bias the sample). On abort:

- Execution stops after the current batch.
- The result is still produced, aggregated over the `k = completedRuns`
  finished runs (`k` may be `< runs`), with `cancelled: true`.
- If `k == 0`: `series` / `final` arrays are present but empty / `NaN`; the
  caller decides whether to show anything.

### MC7.3 Progress

`onProgress(done, total)` fires at least every `progressEvery` completed runs and
exactly once at completion with `done == total` (or `done == completedRuns` on
cancel). It must be side-effect-free w.r.t. the result (I11).

### MC7.4 Memory ceiling

Exact R-7 quantiles require holding, per tracked Pool per timestep, all `runs`
values:

```
cells = trackedPoolCount × (steps + 1) × runs
```

- If `cells > CELL_LIMIT` (**proposed `20_000_000`** ≈ 160 MB of `float64`), the
  config is **rejected before any run executes**, with an error naming the three
  knobs to reduce (`runs`, `steps`, or the size of `tracked`).
- The final-value distribution adds `trackedPoolCount × completedRuns` more
  cells; folded into the same check.
- Above the ceiling, a `loop-mc/2` streaming/t-digest path (approximate
  quantiles, bounded memory) is the intended escape hatch — out of scope now.

---

## MC8. Result structure

### MC8.1 JSON — `MonteCarloResult`

```ts
type MonteCarloResult = {
  spec: 'loop-mc/1'
  seedSpec: 'loop-mc-seed/1'
  rngSpec: 'loop-rng/1'
  config: RunConfig
  completedRuns: number          // == config.runs unless cancelled
  cancelled: boolean
  droppedTracked: string[]        // tracked ids that were not current Pools

  pools: { id: string; label: string }[]   // the tracked Pools, in graph order

  /** how many runs had ended by each step; length steps+1, monotone */
  endedRuns: { atOrBeforeStep: number[] }

  /** per Pool id → six arrays of length steps+1 */
  series: Record<string, {
    p10: number[]; p50: number[]; p90: number[]
    mean: number[]; min: number[]; max: number[]
  }>

  /** per Pool id → the terminal-value distribution over completedRuns */
  final: Record<string, {
    sorted: number[]             // ascending, length == completedRuns
    p10: number; p50: number; p90: number
    mean: number; min: number; max: number
  }>
}
```

- `final[P].sorted` is the value of `P` at each run's **last executed step**
  (== the value at `t = steps` after carry-forward). It is kept in full (bounded
  by `completedRuns` and the §MC7.4 ceiling) so the UI can draw a histogram at
  any bin count.
- Field order and array indexing are part of the frozen contract (so JSON
  compares byte-stably).

### MC8.2 CSV

Three flat files (long format, `\n`-terminated, labels sanitised with
`replace(/[",\n]/g, ' ')` — same as the existing timeline CSV):

**`montecarlo-series.csv`** — one row per `(step, pool)`:
```
step,pool,p10,p50,p90,mean,min,max
```

**`montecarlo-final.csv`** — one row per completed run (wide over Pools):
```
run,<PoolLabelA>,<PoolLabelB>,...
```

**`montecarlo-final-summary.csv`** — one row per Pool:
```
pool,p10,p50,p90,mean,min,max
```

---

## MC9. Draft test vectors

Generated from the real `loop-rng/1` engine + the `runSeed` / `quantile`
definitions above. Frozen on review.

### `runSeed(baseSeed = 1, i)` — `loop-mc-seed/1`

| i | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| `runSeed` | 550768289 | 533990670 | 517213051 | 500435432 | 617878765 | 601101146 | 584323527 | 567545908 |

### V1 — Source `[1-3]` → uncapped Pool P, `baseSeed 1`, `runs 8`, `steps 3`

Per-run `P` trace (`t = 0…3`), run 0…7:

```
[0,1,3,5]  [0,1,3,4]  [0,3,4,6]  [0,1,4,6]  [0,1,2,4]  [0,2,5,7]  [0,1,3,4]  [0,1,2,4]
```

Aggregated bands for `P`:

| t | sorted values | p10 | p50 | p90 | mean | min | max |
|--:|---|--:|--:|--:|--:|--:|--:|
| 0 | 0,0,0,0,0,0,0,0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 1,1,1,1,1,1,2,3 | 1 | 1 | 2.3 | 1.375 | 1 | 3 |
| 2 | 2,2,3,3,3,4,4,5 | 2 | 3 | 4.3 | 3.25 | 2 | 5 |
| 3 | 4,4,4,4,5,6,6,7 | 4 | 4.5 | 6.3 | 5 | 4 | 7 |

Hand-check `p90` at `t = 1`: `n = 8`, `h = 7·0.9 = 6.3`, `lo = 6`, `frac = 0.3`,
`x[6] + 0.3·(x[7] − x[6]) = 2 + 0.3·1 = 2.3`. ✔
`p50` at `t = 3`: `h = 3.5`, `x[3] + 0.5·(x[4] − x[3]) = 4 + 0.5·1 = 4.5`. ✔

### V2 — mixed endings, carry-forward

`Source [1-3] → P(cap 6)`; `P —[4, pull all]→ End Z`. `baseSeed 1`, `runs 8`,
`steps 6`.

| run | endedAtStep | `P` trace `t = 0…6` |
|--:|--:|---|
| 0 | 4 | 0,1,3,5,2,2,2 |
| 1 | 4 | 0,1,3,4,2,2,2 |
| 2 | 3 | 0,3,4,2,2,2,2 |
| 3 | 3 | 0,1,4,2,2,2,2 |
| 4 | 4 | 0,1,2,4,2,2,2 |
| 5 | 3 | 0,2,5,2,2,2,2 |
| 6 | 4 | 0,1,3,4,1,1,1 |
| 7 | 4 | 0,1,2,4,2,2,2 |

`endedRuns.atOrBeforeStep[0…6] = [0, 0, 0, 3, 8, 8, 8]`. Steps 5–6 in every run
repeat the step-`endedAtStep` value (carry-forward), so the bands there are flat.

### Statistical-tolerance vectors (large `runs`, asserted with a band)

Deterministic (fixed `baseSeed`), but checked with tolerance rather than exact
equality:

- **S1** — `Source [1-3] → uncapped P`, `runs 20000`, `steps 10`.
  `E[1-3] = 2`, so `E[P at t] = 2t`. Assert `|mean[t] − 2t| < 0.05` for all `t`;
  assert `p50[t]` within `±1` of `2t`.
- **S2** — probabilistic Gate, weights `[1, 3]`, one unit routed per step,
  `runs 20000`, `steps 1`. Over the 20000 runs, the fraction that routed to the
  weight-3 branch ∈ `0.75 ± 0.01`.
- **S3** — `2D6` per step into a Pool, `runs 20000`, `steps 1`. `mean[1] ∈
  7 ± 0.1`; `p10[1] ∈ [4, 5]`, `p90[1] ∈ [9, 10]` (theoretical `2D6` deciles).

Tolerances are set generously (≈ 3–4 σ for the given `n`); they test *plumbing*,
not RNG quality, which `loop-rng/1` already fixed.

---

## MC10. Invariants (additions)

I1–I10 unchanged. Two added for Part 2.

| # | Invariant |
|---|---|
| **I11** | **Execution invariance.** The `MonteCarloResult` (every field except `cancelled` and any wall-clock metadata) is bit-identical regardless of Worker count, batch size, run execution order, progress cadence, or sync vs async. Rests on: per-run seed pure in `i` (§MC2); aggregation sorts before summarising (§MC4); mean summed in sorted order (§MC6). |
| **I12** | **Monte-Carlo determinism.** Same graph + same `RunConfig` ⇒ identical `MonteCarloResult` on every invocation and machine. `runMonteCarlo` is a pure function of `(nodes, edges, config)`; `loop-mc/1` + `loop-mc-seed/1` + `loop-rng/1` are all pinned. |

---

## MC11. Open questions for review

1. **`CELL_LIMIT`** — proposed 20 M cells (≈160 MB f64). Too tight / too loose?
   Alternative: no hard limit, warn + let the caller proceed.
2. **Cancellation return** — partial result (current draft) vs reject with
   `AbortError` and no result. Partial seems more useful for a "cancel a huge
   job, keep what finished" flow.
3. **`final.sorted` in the JSON** — keep the full per-run array (bounded by the
   ceiling), or only a fixed-bin histogram + summary? Full array keeps the UI
   free to re-bin; histogram bounds JSON size.
4. **Worker transport** — pass `{nodes, edges, config}` to each Worker and have
   it run a slice, or a shared graph + a range of `i`? Latter is less transfer.
   Implementation detail; flagged because portable-build Worker inlining needs a
   check.
5. **`p25` / `p75`** — add now for a box-plot UI, or defer? One extra field pair.
6. **Seed-in-document** — Part 1 deferred pinning `baseSeed` into `GraphDoc`;
   Part 2 could add an optional `recommendedRun: RunConfig` to template metadata
   (not graph data), mirroring `recommendedSeed`.
