# Execution semantics — Engine B, Part 1: seeded randomness (single run)

**Status: DRAFT for review.** Nothing here is frozen yet. Once reviewed, the
expected-value tables in §B7 become the frozen test vectors and implementation
begins on `feat/engine-b-rng`.

This document *extends* [`SEMANTICS.md`](./SEMANTICS.md) (Engine A, frozen). It
does not restate Engine A; it only says what changes and what is added. Section
numbers here are `B0…B8` to avoid collision. When this part is frozen it folds
back into `SEMANTICS.md` as new sections and small edits to §5, §6, §8, §12, §15.

Part 1 covers a **single run** with randomness. Monte-Carlo (many runs,
distributions, percentile bands) is **Part 2**, a later branch, and is out of
scope here — by design, so RNG reproducibility and distribution aggregation are
verified separately.

---

## B0. Scope of Part 1

**Added**

- A **seeded, keyed RNG** (§B1). No shared stream, no consumption order — every
  draw is a pure function of an explicit key.
- Evaluation of the flow expressions Engine A parsed but returned `0` for:
  - `range` — `1-3` → inclusive uniform integer
  - `dice` — `2D6`, `D6` → sum of independent uniform integers
- **Probabilistic Gate** — `distribution: 'probabilistic'`: at most one branch
  per step, chosen by categorical sampling.

**Unchanged from Engine A**

- The two-phase step algorithm (`SEMANTICS.md` §6), the reservation ledger,
  back-pressure, `pull any` / `pull all`, contention order, capacity clamping.
- Numeric conventions (§5): finite reals ≥ 0, `epsilon = 1e-9`. Sampled results
  are integers but live in the same real-valued pipeline.
- Invariants **I1–I5, I7** hold verbatim. **I6 is restated** (§B6). **I8, I9,
  I10 are added** (§B6).

**Still deferred to Part 2 / later** — Monte-Carlo; percentile bands;
distribution readouts; gate round-robin (needs integer-token mode); state
connections; `passive` / `interactive` activation.

---

## B1. The keyed RNG

### B1.1 Model

There is **no PRNG object threaded through the run.** Every random value is

```
sample(key) ∈ [0, 1)          — a pure total function

key = (seed, step, elementId, purpose, drawIndex)
```

| field | type | meaning |
|---|---|---|
| `seed` | uint32 | run parameter, set in the sim controls; default `1` |
| `step` | int ≥ 1 | the step being computed (step 0 has no draws) |
| `elementId` | string | the **edge id** (flow expressions) or **gate id** (routing) |
| `purpose` | string enum | `flow-range` · `flow-die` · `gate-route` (extensible) |
| `drawIndex` | int ≥ 0 | which draw within one `(elementId, purpose, step)` — e.g. the two dice of `2D6` are `drawIndex` 0 and 1 |

Properties this buys us:

- **The same key always yields the same sample** — on re-run, after Reset, and
  when queried more than once inside a step.
- **Reordering the node/edge arrays changes nothing** — order is not an input.
- **Adding an unrelated random element changes nothing** — a new edge/gate has a
  different `elementId`, so every existing key still hashes the same.
- **Reset** returns to step 0 with the **same `seed`** — the whole trajectory
  replays.
- **Only changing `seed`** produces a different trajectory (it is in every key).

### B1.2 Algorithm — frozen in Part 1

The exact algorithm is pinned here so a saved run reproduces byte-for-byte on
any platform with IEEE-754 doubles and 32-bit integer ops (`Math.imul`, `| 0`,
`>>> 0`). **Do not "improve" it later** — a change is a new algorithm and must
be versioned.

**Step 1 — canonical key string.** Join the fields with `|` (which the id
generator never emits):

```
keyString = String(seed) + "|" + String(step) + "|" + elementId
          + "|" + purpose + "|" + String(drawIndex)
```

`String(n)` is decimal, no separators, no leading zeros.

**Step 2 — 32-bit hash: FNV-1a.** Over the UTF-16 code units of `keyString`,
low byte then high byte of each unit:

```
FNV_OFFSET = 0x811c9dc5      FNV_PRIME = 0x01000193

h = FNV_OFFSET
for each code unit c of keyString:
    h = (h XOR (c & 0xFF)) ;           h = Math.imul(h, FNV_PRIME) >>> 0
    h = (h XOR ((c >>> 8) & 0xFF)) ;   h = Math.imul(h, FNV_PRIME) >>> 0
return h >>> 0               // uint32
```

(For ASCII ids/purposes the high byte is `0`; feeding it anyway keeps the hash
total for any future id.)

**Step 3 — one draw from mulberry32**, seeded with `h`:

```
function mulberry32(a):
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    t = Math.imul(a XOR (a >>> 15), 1 | a)
    t = (t + Math.imul(t XOR (t >>> 7), 61 | t)) XOR t
    return ((t XOR (t >>> 14)) >>> 0) / 4294967296

sample(key) = mulberry32(h)          // seed = h, take exactly ONE output
```

- **Overflow:** every multiply is `Math.imul` (32-bit wraparound); every add is
  `| 0`; the final state is coerced `>>> 0` before the divide.
- **`[0, 1)` conversion:** `uint32 / 4294967296` (i.e. `/ 2^32`). Range is
  `[0, 1)` — `1` is unreachable; `0` is reachable.

### B1.3 Deriving values from `u = sample(key)`

| expression | `purpose` | draws | value |
|---|---|---|---|
| `range(lo, hi)` — `1-3` | `flow-range` | `drawIndex 0` | `lo + floor(u · (hi − lo + 1))` → integer in `[lo, hi]` |
| `dice(n, d)` — `2D6`, `D6` | `flow-die` | `drawIndex 0 … n−1` | `Σᵢ (1 + floor(uᵢ · d))` → integer in `[n, n·d]` |
| probabilistic gate route | `gate-route` | `drawIndex 0` | branch index by inverse-CDF (§B4) |

`const`, `all`, `25%` are unchanged from Engine A `evalDet` and **never draw**.

**Validation (all → value `0` + one run diagnostic, never a throw):**

- `range`: `lo`, `hi` must be integers with `lo ≤ hi`. Non-integer endpoint or
  `lo > hi` → `0` + diagnostic.
- `dice`: `n ≥ 1`, `d ≥ 1`, both integers. Otherwise → `0` + diagnostic.

---

## B2. Where randomness enters the step algorithm

Two edits to `SEMANTICS.md` §6; everything else in §6 is untouched.

### B2.1 §6 Phase 1 (Push / Sources) — Source edges may now be random

Engine A: a Source edge evaluating to `all` / `%` / random contributes `0`.
Part 1: **`range` / `dice` on a Source edge evaluate normally** (a Source that
emits `2D6` per step is a core pattern). `all` and `%` on a Source edge still
contribute `0` — there is no source Pool to measure.

So Phase 1 step 2 becomes: `want = flowVal(edge)` (§B3), where `flowVal` for a
Source edge is `0` for `all`/`%` and the sampled integer for `range`/`dice`.
`push all` atomicity is unchanged, now measured against the sampled `want`.

### B2.2 §6 Phase 2 (Pull) — probabilistic Gate branch

A firing Gate with `distribution: 'probabilistic'` follows §B4 instead of the
deterministic fixed-ratio split. Deterministic Gates are exactly as in
`SEMANTICS.md` §6. A Converter, Drain, End reading a `range`/`dice` input edge
uses `flowVal` (§B3) in place of `evalDet` — no other change to their logic.

---

## B3. One evaluation per edge per step (`flowVal` cache)

Per step there is a map `flowVal : edgeId → number`, empty at step start.

- The **first** time an edge's flow is needed this step, it is evaluated —
  drawing if it is `range`/`dice` — and the **numeric result is stored**.
- Every later read this step (push sizing, Gate `demand`, `accept()` recursion,
  `rateOf()` for Gate weights and Converter rates) returns the stored number.
- **`rateOf` never re-derives from the expression** — it reads `flowVal`. A
  die is rolled once per edge per step, full stop.

For `const` this is trivially the constant. For `all` / `%` the stored value is
the amount *as of first use* (`S[P] − taken[P]` at that moment); because each
edge is consumed by exactly one router that executes once (§6), "first use" is
well defined and equals Engine A's single evaluation. The cache exists so that
**random** edges cannot be sampled twice; it is applied uniformly for simplicity.

`accept()` may populate `flowVal` (it needs rates to size throughput). That is
the *only* mutation `accept()` performs, and it is idempotent — a later real
read gets the same number (this is I10).

---

## B4. Probabilistic Gate

`distribution: 'probabilistic'`. **At most one outgoing branch moves per step.**

### B4.1 Weights and validation

Let the outgoing edges be `e₁ … e_m` in **edge-creation order**, with
`wⱼ = rateOf(eⱼ)` (from `flowVal`; normally constants).

- Any `wⱼ` that is `< 0`, `NaN`, or `±∞` → **reject**: the Gate does nothing
  this step (`T = 0`, no draw consumed conceptually — the key is simply never
  queried), emit diagnostic *"probabilistic gate `G`: invalid branch weight"*.
- `Σw ≤ epsilon` (all zero / empty) → Gate does nothing, `T = 0`, diagnostic
  *"probabilistic gate `G`: no positive branch weight"*.
- Otherwise `pⱼ = wⱼ / Σw`. Branches with `wⱼ = 0` get `pⱼ = 0` and are never
  selected; that is allowed.

### B4.2 Branch selection — categorical, one draw

```
u = sample(seed, step, gateId, 'gate-route', 0)
acc = 0
for j in 1 … m (edge-creation order):
    acc += pⱼ
    if u < acc:  selected = j;  break
```

`u ∈ [0, 1)` and `Σpⱼ = 1`, so some branch is always selected when weights are
valid. (Floating-point guard: if the loop finishes without selecting due to
round-off, `selected = m`, the last branch.)

### B4.3 Throughput — like a deterministic gate with one branch of weight 1

With branch `J = selected` and destination `destJ`:

```
demand      = Σ flowVal(inEdge)            over input edges   (all → S[P]−taken[P], % → frac·S[P], const, range/dice)
inputAvail  = Σ (S[P] − taken[P])          over input Pools
T           = min(demand, inputAvail, accept(destJ))
pull all:   if T < demand − epsilon  ⇒  T = 0
```

If `T > epsilon`: pull `T` from the input Pools in `(sourceNodeId, edgeId)`
order (update `taken`, `working`, emit `Pool→G` events); deliver **all** of `T`
to `destJ` — a Pool: `working += T`; a Drain/End/Converter: `inbox[destJ] += T`;
and if the delivery causes a downstream production of `q` into a Pool `Pk`, add
`q` to `reserved[Pk]` now (same rule as the deterministic gate). Emit the
`G→destJ` event. `moved[G] = T`.

**Non-selected branches:** exactly `0` this step. No delivery, no event, no
reservation.

**Selected branch blocked:** if `accept(destJ)` is small, `T` shrinks (or is
`0`). **No re-draw. No fall-back to another branch.** `demand − T` stays in the
input Pool (back-pressure, I4). This is the "no spill" rule (`SEMANTICS.md`
decision 2) applied to a single branch.

### B4.4 `accept()` of a probabilistic Gate

For the forward-planning recursion (an upstream router sizing what it may hand
this Gate):

```
accept(G_probabilistic) = accept(destJ)          where J is the branch that
                                                 sample(…, gateId, 'gate-route', 0) selects
```

`accept()` may call `sample()` because draws are keyed and pure — no stream is
advanced, no state mutated. The key is identical at planning time and execution
time, so the branch chosen in `accept()` is the branch that actually moves
(I10). Effectively the Gate looks, to `accept`, like a fixed-ratio gate whose
only live branch has weight 1.

---

## B5. Reset and seed

- **Reset** (`simStore.reset`): step → 0, values → `initial`, series cleared.
  `seed` is **unchanged**. The next run replays every draw identically (same
  keys) — this is I6.
- **`seed` is a run parameter, not graph data** in Part 1. It lives in the sim
  controls (`simStore.seed`, default `1`), is not written into the graph
  document, and is not part of the undo history. (A future "pin seed to the
  document" option is possible; out of scope now.)
- Changing `seed` re-hashes every key ⇒ a completely different but equally
  reproducible trajectory.
- `step` is in the key, so a draw at step 5 is independent of the draw at step 4
  for the same element — there is no carried state to get out of sync.

---

## B6. Invariants

I1–I5 and I7 from `SEMANTICS.md` §12 are unchanged. I6 is restated to name the
seed. I8–I10 are new.

| # | Invariant |
|---|---|
| **I6** (restated) | **Determinism given a seed.** `step` is pure; `initSim` is total. Same graph **+ same `seed`** + same start ⇒ identical `state` sequence **and** identical `report`, on every run and after every Reset. |
| **I8** | **Domain.** Every sampled value lies in its expression's domain: `range(lo,hi)` → integer in `[lo, hi]`; `dice(n,d)` → integer in `[n, n·d]`; a probabilistic-gate draw selects exactly one existing branch, or none only when weights are invalid / `Σw ≤ ε`. No sample is `NaN` or `±∞`. |
| **I9** | **Key isolation.** A draw's value depends **only** on its key `(seed, step, elementId, purpose, drawIndex)`. Permuting the node or edge arrays, or adding / removing elements whose ids are not in that key, leaves the value bit-identical. (This is I7 sharpened for randomness: not just "final Pool values are order-invariant" but "each individual sample is stable".) |
| **I10** | **Intra-step stability.** Within one step, every evaluation of the same `(elementId, purpose, drawIndex)` — including `accept()`'s trial pass and the execution pass — returns the same sample. Guaranteed by key purity and, redundantly, by the `flowVal` cache. |

---

## B7. Expected results (draft test vectors)

Generated by the reference implementation of §B1.2. Each table records the
**sample key(s)**, the **`u` value(s)** (6 dp), the **derived integer(s)**, and
the resulting flow / Pool values. On freeze these become fixtures for
`src/engine/rng.test.ts` and `src/engine/step.b1.test.ts`.

Common: all nodes `automatic`; all pull nodes `pull any` unless noted.

### R1 — Source `2D6` → uncapped Pool  (`seed = 1`)

```
Source S ──[e1: 2D6]──► Pool P   (P init 0, uncapped)
```

Keys: `1|<step>|e1|flow-die|0` and `1|<step>|e1|flow-die|1`.

| step | u₀ | u₁ | die₀ | die₁ | S→P | P |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | – | – | – | – | – | 0 |
| 1 | 0.807186 | 0.885514 | 5 | 6 | 11 | 11 |
| 2 | 0.303506 | 0.658543 | 2 | 4 | 6 | 17 |
| 3 | 0.017977 | 0.331800 | 1 | 2 | 3 | 20 |
| 4 | 0.006782 | 0.280174 | 1 | 2 | 3 | 23 |
| 5 | 0.797746 | 0.816517 | 5 | 5 | 10 | 33 |
| 6 | 0.832926 | 0.118526 | 5 | 1 | 6 | 39 |

`fired` every step = {S}. I8: every die ∈ [1, 6]; every `S→P` ∈ [2, 12].
I9 check: re-run with an extra unrelated `Source X ──[1-3]──► Drain Y` added
anywhere ⇒ the `u₀ / u₁` column is unchanged.

### R2 — Pool `1-3` → Drain, with back-pressure

```
Pool V ──[e1: 1-3]──► Drain D        (V init 10, pull any)
```

Key: `<seed>|<step>|e1|flow-range|0`.  `want = 1 + floor(u · 3)`.

**`seed = 1`**

| step | u | want | V→D | V | note |
|---:|---:|---:|---:|---:|---|
| 0 | – | – | – | 10 | |
| 1 | 0.705431 | 3 | 3 | 7 | |
| 2 | 0.485432 | 2 | 2 | 5 | |
| 3 | 0.291902 | 1 | 1 | 4 | |
| 4 | 0.138796 | 1 | 1 | 3 | |
| 5 | 0.316249 | 1 | 1 | 2 | |
| 6 | 0.957962 | 3 | 2 | 0 | back-pressure: only 2 left (I4) |
| 7 | 0.109135 | 1 | 0 | 0 | empty |

**`seed = 2`** (same graph — I6: seed alone changes the trajectory)

| step | u | want | V→D | V |
|---:|---:|---:|---:|---:|
| 1 | 0.432355 | 2 | 2 | 8 |
| 2 | 0.934066 | 3 | 3 | 5 |
| 3 | 0.604038 | 2 | 2 | 3 |
| 4 | 0.761805 | 3 | 3 | 0 |
| 5 | 0.810542 | 3 | 0 | 0 |

### R3 — Probabilistic Gate, two drains  (`seed = 1`)

```
Pool V ──[e_in: 4]──► Gate G (probabilistic) ──[eA: w 1]──► Drain A
  (V init 100)                                └─[eB: w 3]──► Drain B
```

`Σw = 4`, `p = [0.25, 0.75]` over edge-creation order `[A, B]`.
Key: `1|<step>|G|gate-route|0`.  `demand = 4`, `accept(destJ) = ∞`, so `T = 4`.

| step | u | cumulative test | pick | G→A | G→B | V | A | B |
|---:|---:|---|:--:|---:|---:|---:|---:|---:|
| 1 | 0.376663 | 0.25 ≤ u < 1.0 | B | 0 | 4 | 96 | 0 | 4 |
| 2 | 0.003411 | u < 0.25 | A | 4 | 0 | 92 | 4 | 4 |
| 3 | 0.724678 | 0.25 ≤ u | B | 0 | 4 | 88 | 4 | 8 |
| 4 | 0.032683 | u < 0.25 | A | 4 | 0 | 84 | 8 | 8 |
| 5 | 0.123051 | u < 0.25 | A | 4 | 0 | 80 | 12 | 8 |
| 6 | 0.519107 | 0.25 ≤ u | B | 0 | 4 | 76 | 12 | 12 |
| 7 | 0.246256 | u < 0.25 | A | 4 | 0 | 72 | 16 | 12 |
| 8 | 0.658592 | 0.25 ≤ u | B | 0 | 4 | 68 | 16 | 16 |

Exactly one branch fires per step; the other is `0`. (This 8-step trace does not
"look" 25/75 — that is small-sample noise; **distribution convergence is a Part 2
/ Monte-Carlo concern**, not something this single run asserts.)

### R4 — Probabilistic Gate, selected branch capacity-blocked  (`seed = 1`)

Same as R3 but branch A feeds **Pool A, capacity 1** (branch B still a Drain).
Same `gate-route` keys and `u` values as R3 (the draw does not depend on
downstream capacity — I9).

| step | u | pick | `accept(destJ)` | T | V | A | note |
|---:|---:|:--:|---:|---:|---:|---:|---|
| 1 | 0.376663 | B | ∞ | 4 | 96 | 0 | |
| 2 | 0.003411 | A | 1 | 1 | 95 | 1 | A fills; `demand−T = 3` stays in V |
| 3 | 0.724678 | B | ∞ | 4 | 91 | 1 | |
| 4 | 0.032683 | A | 0 | 0 | 91 | 1 | A full → **T = 0, no reroute to B** |
| 5 | 0.123051 | A | 0 | 0 | 91 | 1 | idem |
| 6 | 0.519107 | B | ∞ | 4 | 87 | 1 | |
| 7 | 0.246256 | A | 0 | 0 | 87 | 1 | idem |
| 8 | 0.658592 | B | ∞ | 4 | 83 | 1 | |

I10: the branch `accept()` assumes for planning (`A` at steps 4/5/7) is the
branch that then executes; both use key `1|<step>|G|gate-route|0`.

### Mini-cases

- **`D6` (single die):** `dice(1, 6)`, one draw `drawIndex 0`,
  value `1 + floor(u · 6)` ∈ [1, 6].
- **`range` bad bounds:** `3-1` ⇒ value `0` + diagnostic; no draw.
- **prob gate, `Σw = 0`:** two branches both weight `0` ⇒ `T = 0` every step +
  diagnostic; `V` unchanged.
- **prob gate, weight `-1`:** ⇒ rejected, `T = 0` + diagnostic.
- **I9 permutation:** R3 with edges declared `[eB, eA]` instead of `[eA, eB]` —
  `p` is still keyed to weights, and `u` is unchanged, but selection now walks
  `B (0.75)` then `A`. Document whether branch **order** is part of the frozen
  contract → **yes**: inverse-CDF walks edges in **edge-creation order**, so
  `[eB, eA]` changes which branch a given `u` picks. Permuting the array that
  React Flow hands us does **not** reorder creation order; only editing the graph
  does. (Consistent with I7/I9: creation order is the explicit tiebreak, array
  order is not.)

---

## B8. Open questions for review

1. **Hash choice.** FNV-1a (32-bit) + one `mulberry32` output. Simple, portable,
   adequate for a single-run simulator. Alternative: hash → advance mulberry32
   `k` times before output (better decorrelation of nearby seeds, costs one
   magic constant `k`). Proposal: keep the single-output form; revisit only if a
   Part 2 Monte-Carlo bias test fails.
2. **`seed` in the document?** Part 1 keeps it a sim-control parameter. Pin-to-doc
   could come with Part 2 (so a shared graph reproduces a specific run).
3. **`drawIndex` for `dice` beyond `n`?** Not needed — `n` is fixed by the
   expression. Listed for completeness only.
4. **Random Gate *weights*** (`w = 1-3`): allowed by the `flowVal` path (the
   weight edge draws once via its own `flow-range` key). Confirm this is in
   scope for Part 1 or should be rejected until later. Proposal: allow it; it
   falls out of the design for free and has a test vector cost of one row.
5. **`purpose` string vs enum int in the key.** Strings are readable in test
   vectors and diagnostics. Ints would be marginally faster. Proposal: keep
   strings; the hash cost is negligible at these graph sizes.
