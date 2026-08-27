# Execution semantics — Engine B, Part 1: seeded randomness (single run)

**Status: DRAFT, conditionally approved.** The three design decisions are
settled (§B0.1); the amendments below are folded in. On a final read the
expected-value tables in §B7 become the frozen test vectors and implementation
begins on `feat/engine-b-rng` in the order `rng.ts` → `evalRand` →
probabilistic Gate.

This document *extends* [`SEMANTICS.md`](./SEMANTICS.md) (Engine A, frozen). It
only states what changes and what is added. Section numbers are `B0…B9` to
avoid collision. On freeze this folds back into `SEMANTICS.md` as new sections
plus small edits to §5, §6, §8, §12, §15, §16.

Part 1 is a **single run** with randomness. Monte-Carlo (many runs,
distributions, percentile bands) is **Part 2**, a later branch, deliberately
kept separate so RNG reproducibility and distribution aggregation are verified
independently.

---

## B0. Scope

**Added**

- A **seeded, keyed RNG** — spec id **`loop-rng/1`** (§B1). No shared stream, no
  consumption order; every draw is a pure function of an explicit key.
- Evaluation of the flow expressions Engine A parsed but returned `0` for:
  - `range` — `1-3` → inclusive uniform integer
  - `dice` — `2D6`, `D6` → sum of independent uniform integers
- **Probabilistic Gate** — `distribution: 'probabilistic'`: at most one branch
  per step, chosen by categorical sampling.

**Unchanged from Engine A** — the two-phase step algorithm (`SEMANTICS.md` §6),
the reservation ledger, back-pressure, `pull any` / `pull all`, contention
order, capacity clamping, numeric conventions (§5: finite reals ≥ 0,
`epsilon = 1e-9`). Invariants **I1–I5, I7** hold verbatim; **I6 is restated**;
**I8, I9, I10 are added** (§B6).

**Still deferred** — Monte-Carlo; percentile bands; distribution readouts; gate
round-robin (needs integer-token mode); state connections; `passive` /
`interactive` activation.

### B0.1 Settled decisions (this review round)

1. **RNG algorithm = FNV-1a 32-bit + one `mulberry32` output.** No "advance *k*
   times" step — it would only add an arbitrary magic count and complicate the
   reproduction contract. Frozen as `loop-rng/1` (§B1.2).
2. **`seed` is NOT stored in `GraphDoc`.** It is a simulation run parameter
   (§B5). Graph structure and experiment conditions stay separate; sharing a
   `.json` graph never implicitly pins a particular run. Part 2 records `seed`
   in a `RunConfig` / export metadata. Templates that want a representative
   result carry `recommendedSeed` as **template metadata**, not a graph field.
3. **Random Gate weights are allowed in Part 1** (`w = 1-3`, `w = 2D6`) — the
   `flowVal` cache (§B3) already makes each weight edge draw once per step.

---

## B1. The keyed RNG — `loop-rng/1`

### B1.1 Model

There is **no PRNG object threaded through the run.** Every random value is

```
sample(key) → { hash, out, u }        — a pure total function
u ∈ [0, 1)

key = (seed, step, elementId, purpose, drawIndex)
```

| field | type | meaning |
|---|---|---|
| `seed` | **uint32** | run parameter, set in the sim controls; default `1` (§B5) |
| `step` | int ≥ 1 | the step being computed. **Step 0 is the Reset state and draws nothing; the first advance uses `step = 1` keys.** |
| `elementId` | string | the **edge id** (flow expressions) or **gate id** (routing). Must not contain `\|`; the id generator guarantees this. |
| `purpose` | string enum | `flow-range` · `flow-die` · `gate-route` (extensible) |
| `drawIndex` | int ≥ 0 | which draw within one `(elementId, purpose, step)` — the two dice of `2D6` are `drawIndex` 0 and 1; `range` and `gate-route` use `0` |

Properties:

- **The same key always yields the same `{hash, out, u}`** — on re-run, after
  Reset, and when queried more than once inside a step.
- **Reordering the node/edge arrays changes nothing** — order is not an input.
- **Adding an unrelated random element changes nothing** — a new edge/gate has a
  different `elementId`, so every existing key still hashes the same.
- **Reset** returns to step 0 with the **same `seed`**; the next run replays
  every draw.
- **Only changing `seed`** produces a different trajectory (it is in every key).

### B1.2 Algorithm — frozen as `loop-rng/1`

Pinned exactly so a saved run reproduces byte-for-byte in another language, in a
Worker, or in a later version. **A change to any step here is a new spec id
(`loop-rng/2`), never an in-place edit.**

**Step 1 — canonical key string.** Join with `|` (never present in ids):

```
keyString = decStr(seed) + "|" + decStr(step) + "|" + elementId
          + "|" + purpose + "|" + decStr(drawIndex)
```

`decStr(n)` = base-10, no separators, no leading zeros, no sign (all three
integers are ≥ 0).

**Step 2 — encode as UTF-8 bytes.** `bytes = UTF-8(keyString)`. (All current
ids and `purpose` values are ASCII, so one byte per character; UTF-8 is
specified so any future non-ASCII id still has one defined byte sequence.)

**Step 3 — FNV-1a, 32-bit, over the bytes:**

```
FNV_OFFSET = 0x811c9dc5      FNV_PRIME = 0x01000193

h = FNV_OFFSET
for each byte b of bytes:
    h = h XOR b                      // b in 0..255
    h = Math.imul(h, FNV_PRIME) >>> 0
hash = h >>> 0                       // uint32  — recorded in test vectors
```

Every intermediate `h` is a uint32: `XOR` keeps 32 bits, `Math.imul` gives a
32-bit product, `>>> 0` re-normalises to unsigned.

**Step 4 — one `mulberry32` output, seeded with `hash`:**

```
a   = hash | 0
a   = (a + 0x6D2B79F5) | 0
t   = Math.imul(a XOR (a >>> 15), 1 | a)
t   = (t + Math.imul(t XOR (t >>> 7), 61 | t)) XOR t
out = (t XOR (t >>> 14)) >>> 0       // uint32  — recorded in test vectors
u   = out / 4294967296              // out / 2^32  →  [0, 1)
```

- **Exactly one output.** `mulberry32` is not iterated.
- **Overflow:** every `+` is `| 0`, every `*` is `Math.imul`, the result is
  `>>> 0` before the divide.
- **`[0, 1)`:** `1` is unreachable (`out ≤ 2^32 − 1`); `0` is reachable.

### B1.3 `seed` validation (UI boundary)

The sim control accepts `seed` and normalises it **once, at input**:

- Must be a **finite integer**. Then `seed = value >>> 0` (wrap into `uint32`,
  range `0 … 4294967295`).
- `NaN`, `±Infinity`, or a **non-integer** (`3.5`) is a **rejected input** — the
  control shows an error and keeps the previous valid seed. No implicit
  truncation or coercion.
- The engine only ever sees a `uint32`. `initSim` / `step` do not re-validate.

### B1.4 Deriving values from `u`

| expression | `purpose` | draws | value |
|---|---|---|---|
| `range(lo, hi)` — `1-3` | `flow-range` | `drawIndex 0` | `lo + floor(u · (hi − lo + 1))` → integer in `[lo, hi]` |
| `dice(n, d)` — `2D6`, `D6` | `flow-die` | `drawIndex 0 … n−1` | `Σᵢ (1 + floor(uᵢ · d))` → integer in `[n, n·d]` |
| probabilistic gate route | `gate-route` | `drawIndex 0` | branch id by inverse-CDF (§B4.2) |

`const`, `all`, `25%` are unchanged from Engine A `evalDet` and **never draw**.

**Validation** (→ value `0` + one run diagnostic, never a throw):

- `range`: `lo`, `hi` integers with `lo ≤ hi`. Non-integer endpoint or
  `lo > hi` → `0` + diagnostic.
- `dice`: `n ≥ 1`, `d ≥ 1`, both integers. Otherwise → `0` + diagnostic.

---

## B2. Where randomness enters the step algorithm

Two edits to `SEMANTICS.md` §6; nothing else in §6 changes.

### B2.1 §6 Phase 1 (Push / Sources) — Source edges may be random

Engine A: a Source edge evaluating to `all` / `%` / random contributes `0`.
Part 1: **`range` / `dice` on a Source edge evaluate normally** (a Source
emitting `2D6` per step is a core pattern). `all` and `%` on a Source edge still
contribute `0` — there is no source Pool to measure.

Phase 1 step 2 becomes `want = flowVal(edge)` (§B3): `0` for `all`/`%` on a
Source edge, the sampled integer for `range`/`dice`. `push all` atomicity is
unchanged, now measured against the sampled `want`.

### B2.2 §6 Phase 2 (Pull) — probabilistic Gate branch

A firing Gate with `distribution: 'probabilistic'` follows §B4 instead of the
deterministic fixed-ratio split. Deterministic Gates are exactly as in
`SEMANTICS.md` §6. A Converter / Drain / End reading a `range`/`dice` input edge
uses `flowVal` (§B3) in place of `evalDet`; no other change.

---

## B3. One evaluation per edge per step (`flowVal` cache)

Per step there is a map `flowVal : edgeId → number`, empty at step start.

- The **first** time an edge's flow is needed this step it is evaluated —
  drawing if it is `range`/`dice` — and the **numeric result is stored**.
- Every later read this step (push sizing, Gate `demand`, `accept()` recursion,
  `rateOf()` for Gate weights and Converter rates) returns the stored number.
- **`rateOf` never re-derives from the expression** — it reads `flowVal`. A die
  is rolled once per edge per step.

For `const` the stored value is the constant. For `all` / `%` it is the amount
*as of first use* (`S[P] − taken[P]` then); each edge is consumed by exactly one
router that executes once (§6), so "first use" is well defined and equals Engine
A's single evaluation. The cache exists so **random** edges cannot be sampled
twice; it is applied uniformly for simplicity.

`accept()` may populate `flowVal` (it needs rates to size throughput). That is
its only mutation and it is idempotent — a later real read gets the same number
(I10).

---

## B4. Probabilistic Gate

`distribution: 'probabilistic'`. **At most one outgoing branch moves per step.**

### B4.1 Weights and validation

Outgoing edges are taken in **`edge.id` ascending order** (§B4.2), giving
`e₁ … e_m` with `wⱼ = rateOf(eⱼ)` — read from `flowVal`, so a random weight
(`w = 1-3`, `w = 2D6`) is **drawn once for that edge this step** and reused for
the whole selection.

- Any `wⱼ` that is `< 0`, `NaN`, or `±∞` → **reject**: the Gate does nothing
  this step (`T = 0`; the `gate-route` key is not queried), emit diagnostic
  *"probabilistic gate `G`: invalid branch weight"*.
- `Σw ≤ epsilon` (all zero / all sampled to zero / no out-edges) → Gate does
  nothing, `T = 0`, diagnostic *"probabilistic gate `G`: no positive branch
  weight"*.
- Otherwise `pⱼ = wⱼ / Σw`. A branch with `wⱼ = 0` gets `pⱼ = 0` and is never
  selected; allowed.

### B4.2 Branch selection — canonical order, one draw

The inverse-CDF walk **must not** depend on array order or an implicit "creation
order". Outgoing edges are sorted by **`edge.id` ascending** (string compare).

> If edge creation order ever becomes product-meaningful, add a persistent
> integer `order` field to the edge in `GraphDoc` and sort by `(order, id)`.
> There is no such field today, so **`edge.id` ascending is the frozen rule**.

```
edges  = outgoing edges of G, sorted by edge.id ascending
u      = sample(seed, step, gateId, 'gate-route', 0).u
acc    = 0
for j in 1 … m:
    acc += pⱼ
    if u < acc:  selected = eⱼ;  break
selected ??= e_m           // float-guard: if the walk falls through, last edge
```

`u ∈ [0, 1)` and `Σpⱼ = 1`, so a branch is always selected when weights are
valid.

### B4.3 Throughput — a deterministic gate with one live branch of weight 1

With `J = selected` and destination `destJ`:

```
demand     = Σ flowVal(inEdge)          over input edges
inputAvail = Σ (S[P] − taken[P])        over input Pools
T          = min(demand, inputAvail, accept(destJ))
pull all:  if T < demand − epsilon  ⇒  T = 0
```

If `T > epsilon`: pull `T` from the input Pools in `(sourceNodeId, edgeId)`
order (update `taken`, `working`, emit `Pool→G` events); deliver **all** of `T`
to `destJ` — Pool: `working += T`; Drain/End/Converter: `inbox[destJ] += T`; if
the delivery causes a downstream production of `q` into a Pool `Pk`, add `q` to
`reserved[Pk]` now (same rule as the deterministic gate). Emit `G→destJ`.
`moved[G] = T`.

- **Non-selected branches:** exactly `0` — no delivery, no event, no reservation.
- **Selected branch blocked:** `accept(destJ)` small ⇒ `T` shrinks or is `0`.
  **No re-draw, no fall-back to another branch.** `demand − T` stays in the
  input Pool (I4). This is `SEMANTICS.md` decision 2 ("no spill") on one branch.

### B4.4 `accept()` of a probabilistic Gate

```
accept(G_probabilistic) = accept(destJ)     where J is the branch that
                                            sample(…, gateId, 'gate-route', 0) selects
```

`accept()` may call `sample()` — draws are keyed and pure, so no stream advances
and nothing mutates. The key is identical at planning and execution time, so the
branch assumed by `accept()` is the branch that moves (I10). To `accept`, the
Gate looks like a fixed-ratio gate whose only live branch has weight 1.

---

## B5. `seed`, Reset, templates

- **`seed` is a run parameter, not graph data.** It lives in the sim controls
  (`simStore.seed`, default `1`), is **not** written to `GraphDoc`, and is not
  in the undo history. Rationale: graph *structure* and *experiment conditions*
  stay separate; a shared `.json` never silently fixes someone else's run.
- **Reset** (`simStore.reset`): step → 0, values → `initial`, series cleared,
  **`seed` unchanged**. The next run replays every draw (same keys) — this is I6.
- Changing `seed` re-hashes every key ⇒ a different, equally reproducible
  trajectory.
- **Part 2** records `seed` in a `RunConfig` and/or result-export metadata so a
  specific run can be cited.
- **Templates** that want a representative outcome carry `recommendedSeed` in
  **template metadata** (alongside `name` / `blurb`), applied to the sim control
  on load — never as a field on the template's nodes or edges.

---

## B6. Invariants

I1–I5 and I7 (`SEMANTICS.md` §12) are unchanged. I6 is restated to name the
seed. I8–I10 are new.

| # | Invariant |
|---|---|
| **I6** (restated) | **Determinism given a seed.** `step` is pure; `initSim` is total. Same graph **+ same `seed`** + same start ⇒ identical `state` sequence **and** identical `report`, on every run and after every Reset. |
| **I8** | **Domain.** Every sampled value is in its expression's domain: `range(lo,hi)` → integer in `[lo, hi]`; `dice(n,d)` → integer in `[n, n·d]`; a probabilistic-gate draw selects exactly one existing branch, or none only when weights are invalid / `Σw ≤ ε`. No sample is `NaN` or `±∞`. |
| **I9** | **Key isolation.** A draw's value depends **only** on its key `(seed, step, elementId, purpose, drawIndex)`. Permuting the node or edge arrays, or adding / removing elements whose ids are not in that key, leaves `hash`, `out`, and `u` bit-identical. (I7 sharpened for randomness.) |
| **I10** | **Intra-step stability.** Within one step, every evaluation of the same `(elementId, purpose, drawIndex)` — including `accept()`'s trial pass and the execution pass — returns the same sample. Guaranteed by key purity and, redundantly, by the `flowVal` cache. |

---

## B7. Expected results — draft test vectors

Generated by the reference implementation of `loop-rng/1` (§B1.2). Every random
row records the **key**, the FNV **`hash`** (uint32, hex), the **`out`** (uint32
`mulberry32` output), and **`u`** (6 dp) — so a port in another language can
check each stage, not just the final number. On freeze these become fixtures for
`src/engine/rng.test.ts` and `src/engine/step.b1.test.ts`.

Common: all nodes `automatic`; all pull nodes `pull any` unless noted. Step 0 is
the Reset state (no draws); the first advance is step 1.

### RNG stage vectors (algorithm-only, no graph)

| key | hash | out | u |
|---|---|---:|---:|
| `1\|1\|e1\|flow-die\|0` | `0x31a1fe5a` | 3827404282 | 0.891137 |
| `1\|1\|e1\|flow-die\|1` | `0x32a1ffed` | 4280748691 | 0.996689 |
| `1\|1\|e1\|flow-range\|0` | `0x0a9078c9` | 1628349630 | 0.379130 |
| `1\|1\|G\|gate-route\|0` | `0xea0ec4b5` | 198040717 | 0.046110 |
| `2\|1\|e1\|flow-range\|0` | `0x60bfd79c` | 1987613312 | 0.462777 |

### R1 — Source `2D6` → uncapped Pool (`seed = 1`)

```
Source S ──[e1: 2D6]──► Pool P   (P init 0, uncapped)
```

| step | key₀ / key₁ | hash₀ / hash₁ | u₀ / u₁ | die₀ | die₁ | S→P | P |
|---:|---|---|---:|---:|---:|---:|---:|
| 0 | – | – | – | – | – | – | 0 |
| 1 | `1\|1\|e1\|flow-die\|0` / `…\|1` | `0x31a1fe5a` / `0x32a1ffed` | 0.891137 / 0.996689 | 6 | 6 | 12 | 12 |
| 2 | `1\|2\|e1\|flow-die\|0` / `…\|1` | `0xc1d77357` / `0xc0d771c4` | 0.695931 / 0.226545 | 5 | 2 | 7 | 19 |
| 3 | `1\|3\|e1\|flow-die\|0` / `…\|1` | `0x8ffb2b04` / `0x90fb2c97` | 0.563082 / 0.604685 | 4 | 4 | 8 | 27 |
| 4 | `1\|4\|e1\|flow-die\|0` / `…\|1` | `0x21e314e9` / `0x20e31356` | 0.145074 / 0.692496 | 1 | 5 | 6 | 33 |
| 5 | `1\|5\|e1\|flow-die\|0` / `…\|1` | `0x0813e0ee` / `0x0913e281` | 0.643021 / 0.610432 | 4 | 4 | 8 | 41 |
| 6 | `1\|6\|e1\|flow-die\|0` / `…\|1` | `0x4f24a5eb` / `0x4e24a458` | 0.010927 / 0.782814 | 1 | 5 | 6 | 47 |

`fired` every step = {S}. I8: each die ∈ [1, 6]; each `S→P` ∈ [2, 12].
**I9 check (required test):** re-run with an unrelated `Source X ──[1-3]──► Drain Y`
added anywhere ⇒ the `hash / out / u` columns are unchanged.

### R2 — Pool `1-3` → Drain, with back-pressure

```
Pool V ──[e1: 1-3]──► Drain D        (V init 10, pull any)
want = 1 + floor(u · 3)
```

**`seed = 1`**

| step | key | hash | u | want | V→D | V | note |
|---:|---|---|---:|---:|---:|---:|---|
| 0 | – | – | – | – | – | 10 | |
| 1 | `1\|1\|e1\|flow-range\|0` | `0x0a9078c9` | 0.379130 | 2 | 2 | 8 | |
| 2 | `1\|2\|e1\|flow-range\|0` | `0x16ee7534` | 0.558641 | 2 | 2 | 6 | |
| 3 | `1\|3\|e1\|flow-range\|0` | `0x05207717` | 0.347429 | 2 | 2 | 4 | |
| 4 | `1\|4\|e1\|flow-range\|0` | `0x159fc50a` | 0.489049 | 2 | 2 | 2 | |
| 5 | `1\|5\|e1\|flow-range\|0` | `0x46e52945` | 0.332034 | 1 | 1 | 1 | |
| 6 | `1\|6\|e1\|flow-range\|0` | `0x700ab260` | 0.608527 | 2 | 1 | 0 | back-pressure (I4) |
| 7 | `1\|7\|e1\|flow-range\|0` | `0x051a7a53` | 0.521358 | 2 | 0 | 0 | empty |

**`seed = 2`** (same graph — I6: seed alone changes the trajectory)

| step | key | hash | u | want | V→D | V |
|---:|---|---|---:|---:|---:|---:|
| 1 | `2\|1\|e1\|flow-range\|0` | `0x60bfd79c` | 0.462777 | 2 | 2 | 8 |
| 2 | `2\|2\|e1\|flow-range\|0` | `0x0b4d26f1` | 0.200080 | 1 | 1 | 7 |
| 3 | `2\|3\|e1\|flow-range\|0` | `0x2be38226` | 0.252245 | 1 | 1 | 6 |
| 4 | `2\|4\|e1\|flow-range\|0` | `0xf8637b9b` | 0.811918 | 3 | 3 | 3 |
| 5 | `2\|5\|e1\|flow-range\|0` | `0x8705e5c8` | 0.325100 | 1 | 1 | 2 |
| 6 | `2\|6\|e1\|flow-range\|0` | `0xd2c64c2d` | 0.620825 | 2 | 2 | 0 |
| 7 | `2\|7\|e1\|flow-range\|0` | `0x243a7dd2` | 0.977753 | 3 | 0 | 0 |

### R3 — Probabilistic Gate, two drains (`seed = 1`)

```
Pool V ──[e_in: 4]──► Gate G (probabilistic) ──[eA: w 1]──► Drain A
  (V init 100)                                └─[eB: w 3]──► Drain B
```

Outgoing edges id-sorted `[eA, eB]`; `Σw = 4`; `p = [0.25, 0.75]`.
Key `1|<step>|G|gate-route|0`. `demand = 4`, `accept(destJ) = ∞`, so `T = 4`.

| step | hash | u | walk | pick | G→A | G→B | V | A | B |
|---:|---|---:|---|:--:|---:|---:|---:|---:|---:|
| 1 | `0xea0ec4b5` | 0.046110 | `u < 0.25` | eA | 4 | 0 | 96 | 4 | 0 |
| 2 | `0x0cb5b73a` | 0.879574 | `≥ 0.25` | eB | 0 | 4 | 92 | 4 | 4 |
| 3 | `0xe61b0097` | 0.240920 | `u < 0.25` | eA | 4 | 0 | 88 | 8 | 4 |
| 4 | `0x6ca04d2c` | 0.912739 | `≥ 0.25` | eB | 0 | 4 | 84 | 8 | 8 |
| 5 | `0x8ce51a99` | 0.691021 | `≥ 0.25` | eB | 0 | 4 | 80 | 8 | 12 |
| 6 | `0xcbbae83e` | 0.940401 | `≥ 0.25` | eB | 0 | 4 | 76 | 8 | 16 |
| 7 | `0xd04b713b` | 0.609347 | `≥ 0.25` | eB | 0 | 4 | 72 | 8 | 20 |
| 8 | `0x029c6b10` | 0.595210 | `≥ 0.25` | eB | 0 | 4 | 68 | 8 | 24 |

Exactly one branch fires per step. (8 steps land 1×eA / 7×eB — small-sample
noise around `p = [0.25, 0.75]`; **distribution convergence is a Part 2 concern**,
not asserted here.)

### R4 — Probabilistic Gate, selected branch capacity-blocked (`seed = 1`)

Same as R3 but `eA` feeds **Pool A, capacity 1** (`eB` still a Drain). Same
`gate-route` keys and `u` values as R3 — the draw does not depend on downstream
capacity (I9).

| step | u | pick | `accept(destJ)` | T | V | A | note |
|---:|---:|:--:|---:|---:|---:|---:|---|
| 1 | 0.046110 | eA | 1 | 1 | 99 | 1 | A fills; `demand−T = 3` stays in V |
| 2 | 0.879574 | eB | ∞ | 4 | 95 | 1 | |
| 3 | 0.240920 | eA | 0 | 0 | 95 | 1 | A full → **T = 0, no reroute to eB** |
| 4 | 0.912739 | eB | ∞ | 4 | 91 | 1 | |
| 5 | 0.691021 | eB | ∞ | 4 | 87 | 1 | |
| 6 | 0.940401 | eB | ∞ | 4 | 83 | 1 | |
| 7 | 0.609347 | eB | ∞ | 4 | 79 | 1 | |
| 8 | 0.595210 | eB | ∞ | 4 | 75 | 1 | |

I10: the branch `accept()` assumes when planning (`eA` at step 3) is the branch
that then executes — both use key `1|3|G|gate-route|0`.

### Mini-cases (each a required test)

- **`D6`:** `dice(1, 6)`, one draw `drawIndex 0`, value `1 + floor(u · 6)` ∈ [1, 6].
- **`range` bad bounds:** `3-1` ⇒ value `0` + diagnostic; no draw.
- **prob gate `Σw = 0`:** two branches both weight `0` ⇒ `T = 0` every step +
  diagnostic; `V` unchanged; `gate-route` key never queried.
- **prob gate weight `-1` / `NaN` / `∞`:** rejected ⇒ `T = 0` + diagnostic.
- **prob gate random weight:** `eA: w = 1-3`, `eB: w = 2` — `eA`'s weight is one
  `flow-range` draw on `eA` per step, reused for `Σw` and `pⱼ`; not re-drawn for
  the `gate-route` selection.
- **array-reversal invariance (I7/I9):** declare G's out-edges `[eB, eA]`
  instead of `[eA, eB]`; id-sort still yields `[eA, eB]`, so every `pick` in R3
  is unchanged.

---

## B8. Reference algorithm (normative pseudocode)

```
// spec: loop-rng/1
const FNV_OFFSET = 0x811c9dc5, FNV_PRIME = 0x01000193

function fnv1a32(bytes: Uint8Array): uint32 {
  let h = FNV_OFFSET
  for (const b of bytes) { h ^= b; h = Math.imul(h, FNV_PRIME) >>> 0 }
  return h >>> 0
}

function sample(seed, step, elementId, purpose, drawIndex) {
  const key   = `${seed}|${step}|${elementId}|${purpose}|${drawIndex}`
  const hash  = fnv1a32(utf8Encode(key))
  let a = hash | 0
  a = (a + 0x6D2B79F5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const out = (t ^ (t >>> 14)) >>> 0
  return { hash, out, u: out / 4294967296 }
}

rangeInt(lo, hi, u) = lo + Math.floor(u * (hi - lo + 1))
die(d, u)           = 1 + Math.floor(u * d)
```

---

## B9. Decisions log (this part)

1. **RNG** → `loop-rng/1`: canonical `|`-joined key string → **UTF-8 bytes** →
   FNV-1a 32-bit → **one** `mulberry32` output → `out / 2^32 ∈ [0,1)`. No
   k-advance. All ops 32-bit (`Math.imul`, `| 0`, `>>> 0`).
2. **`seed`** → `uint32`; UI validates a finite integer then `>>> 0`;
   `NaN`/`∞`/fractional is a rejected input, not coerced. Not stored in
   `GraphDoc`. Part 2 puts it in `RunConfig` / export metadata. Templates use
   `recommendedSeed` metadata.
3. **`range`** → inclusive uniform integer; endpoints must be integers.
   **`dice`** → sum of `n` independent `1..d` integers, `drawIndex 0..n−1`.
   Bad bounds → `0` + diagnostic.
4. **One evaluation per edge per step** via `flowVal[edgeId]`; `rateOf` reads
   the cache; `accept()` may populate it (idempotent).
5. **Probabilistic Gate** → categorical inverse-CDF, **one draw**
   (`gate-route`, `drawIndex 0`); outgoing edges ordered by **`edge.id`
   ascending** (a future persistent `order` field could replace this); at most
   one branch per step; blocked branch → `T` shrinks / `0`, **no re-draw, no
   reroute**; invalid or zero-sum weights → inert + diagnostic. Random weights
   allowed via the `flowVal` cache.
6. **Timeline** → step 0 is the Reset state and draws nothing; the first advance
   uses `step = 1` keys.
7. **Invariants** → I6 restated for the seed; I8 (domain), I9 (key isolation),
   I10 (intra-step stability) added; I1–I5, I7 unchanged.
8. **Test vectors** record `key`, `hash` (uint32), `out` (uint32), and `u` for
   every draw, so a non-JS port is checkable stage by stage.
