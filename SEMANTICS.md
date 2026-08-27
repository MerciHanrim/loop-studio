# Execution semantics

How Loop Studio runs a diagram. The reference point is Machinations' observable
behaviour; where this document and Machinations disagree, that is a bug to fix
here.

This revision specifies **Engine A — the deterministic core**, and is **frozen**:
the expected-result tables in §14 are the acceptance target and become the first
automated tests. Randomness, Monte-Carlo, state connections, and interactive
play are Engine B and appear here only under *Deferred* (§15).

---

## 1. Scope of Engine A

**Modelled**

- Node kinds: **Source, Pool, Gate (deterministic), Converter, Drain, End**
- Resource connections with a flow rate
- Flow expressions **evaluated**: a constant (`2`, `0.5`), `all`, a percentage
  (`25%`)
- Flow expressions **parsed but not evaluated**: ranges (`1-3`), dice (`2D6`) —
  these contribute `0` in Engine A (§8)
- Activation: `automatic`, `onStart`
- Flow modes: `pull any` / `pull all` on Gate·Converter·Drain·End, `push any` /
  `push all` on Source
- Pool capacity and **back-pressure**

**Not in Engine A** — see §15.

---

## 2. The running model

A run is a fold over a **pure** step function:

```
state0                  = initSim(graph)
state(n+1), report      = step(graph, state(n))
```

- `state` is `{ step, values, ended }`. `values` maps every Pool id to a
  non-negative finite real (§5).
- `step` has **no hidden state**: output depends only on `graph` and the `state`
  passed in. No RNG, no module-level cursor, no wall clock.
- `initSim` fully rebuilds `state` from the graph (each Pool = its `initial`,
  `step = 0`, `ended = false`).
- **Reset + the same graph reproduces the exact same sequence of states and
  reports, every time** (invariant I6).

`report` is `{ events, activated, fired }`:

- `events`: ordered `{ edgeId, from, to, amount }` for every transfer with
  `amount > epsilon` this step. Drives animation; asserted by tests.
- `activated`: node ids evaluated as execution targets this step.
- `fired`: node ids that actually moved / produced / consumed `> epsilon` this
  step. **The UI firing pulse uses `fired` only** (decision 5).

---

## 3. Time

- Discrete integer steps. **Step 0** is the initial state: Pools hold `initial`,
  nothing has flowed. **Step**/**Play** advances to 1, 2, 3, …
- Each step reads a **snapshot** `S` = the Pool values committed at the end of
  the previous step. Every pull demand is measured against `S` (and against what
  earlier nodes already took this step — §10), never against mid-step working
  values.
- A separate **working copy** is mutated during the step and becomes `S` for the
  next step.

Consequence: a resource a Source pushes into a Pool in step *n* is **not
pullable from that Pool until step *n+1***. Zero-storage routers (Gate,
Converter) are the exception — a Pool → Gate → Converter → Pool hand-off
resolves inside one step (§6).

---

## 4. What fires each step

| Activation | Fires |
|---|---|
| `automatic` | every step |
| `onStart` | only on the first advance (step 0 → 1) |
| `passive` | never in Engine A (needs triggers — Engine B) |
| `interactive` | never in Engine A |

---

## 5. Numeric conventions

- Every resource amount, capacity, and flow value is a **finite real ≥ 0**.
- `epsilon = 1e-9`.
- Any computed magnitude with `|x| < epsilon` is normalised to exactly `0`.
- A Pool value that lands fractionally outside its bounds through rounding is
  clamped into `[0, capacity]` (`[0, ∞)` if uncapped); this clamp only ever
  corrects sub-`epsilon` drift — a clamp larger than `epsilon` is a bug (I3).
- **`NaN` and `Infinity` are not valid inputs.** `initSim` rejects a graph whose
  `initial`, `capacity`, or constant flow is non-finite.
- Comparisons in tests are `|a − b| ≤ epsilon`.
- Integer tokens, remainder distribution, and gate round-robin are a **separate
  future mode** (§15), not part of Engine A.

---

## 6. The step algorithm

Two phases. **Push before pull** (Q1). Phase 2 is a single forward walk of the
router DAG in topological order; capacity is planned with a **reservation
ledger** so it can never be double-spent.

### Ledgers held for the duration of one step

| ledger | meaning |
|---|---|
| `working[P]` | live Pool value; every headroom read uses this |
| `taken[P]` | amount already pulled **out** of Pool `P` this step |
| `reserved[P]` | amount promised **into** Pool `P` by an already-planned upstream router, not yet added to `working` |
| `inbox[node]` | amount handed to a router by an upstream router this step |

**Effective headroom:** `headroom(P) = capacity(P) − working[P] − reserved[P]`
(`∞` if `P` is uncapped).

### Phase 1 — Push (Sources)

Firing Sources in **ascending node-id** order; each Source's outgoing resource
edges in **edge-creation** order.

1. `push all`: if **any** outgoing edge has `headroom(target) < evalDet(flow)`,
   the Source pushes **nothing on any edge** this step (atomic). Otherwise:
2. per edge: `want = evalDet(flow)` (a Source edge's `all` / `%` / random all
   evaluate to `0`; only a constant supplies resources), `m = min(want,
   headroom(target))`, then `working[target] += m` and emit an event if
   `m > epsilon`.

Sources have infinite supply and never contend; `want − m` is simply not
created (I4).

### Phase 2 — Pull (Gate, Converter, Drain, End)

**Router DAG.** Nodes = the firing Gates / Converters / Drains / Ends. Directed
edges = resource connections between them. Pools are the roots. A cycle among
these zero-storage nodes with **no Pool in it** is ill-defined — every edge on
such a cycle is treated as flow `0` and a diagnostic is emitted. Real feedback
loops must contain a Pool.

**Order:** topological (roots first), ties broken by **ascending node id**.
Every router executes **exactly once** per step.

**`accept(n)`** — read-only, used by a Gate/Converter to size its throughput. It
reads **live** `working` / `reserved`, and recurses forward through
not-yet-executed downstream routers (whose `inbox` is still empty):

| n | `accept(n)` = max it can take on its input side |
|---|---|
| Pool `P` | `headroom(P)` |
| Drain `D`, End `E` | `∞` |
| Converter `C` | `fmax · Σ inRate`, where `fmax = min(1, min over out-edges k of accept(destₖ) / outRateₖ)` |
| Gate `G` | `min over out-edges j of ( accept(destⱼ) · Σw / wⱼ )` |

**Execution**, in topo order:

- **Drain `D` / End `E`** — consume `got = inbox[node] + pullInputs(node)`
  (§10). If `E` and `got > epsilon`: `ended = true`. Record `moved[node] = got`.

- **Gate `G`** (deterministic, fixed-ratio splitter):
  1. `demand = Σ evalDet(inEdge.flow)` (`all` → `S[P] − taken[P]`; `%` →
     `frac · S[P]`; constant → the number; random → `0`)
  2. `inputAvail = Σ (S[P] − taken[P])` over input Pools
  3. `T = min(demand, inputAvail, accept(G))`
  4. `pull all`: if `T < demand − epsilon` then `T = 0`
  5. if `T > epsilon`: pull `T` from the input Pools in `(sourceNodeId, edgeId)`
     order (updating `taken`, `working`), emit `Pool→G` events. For each
     outgoing edge `j` in edge-creation order: `share = T · wⱼ / Σw`; hand
     `share` to `destⱼ` — a Pool: `working += share`; a Drain/End/Converter:
     `inbox[destⱼ] += share`. **When a delivery will cause a downstream
     production of `q` into some Pool `Pk` (i.e. feeding a Converter), add `q`
     to `reserved[Pk]` now.** Emit `G→destⱼ` events. `moved[G] = T`.

  **No spill** (decision 2): a capacity-blocked branch shrinks `accept(G)` and
  therefore `T`; **all** branches scale down together; `demand − T` stays in the
  input Pool.

- **Converter `C`** — `received = inbox[C]` (+ a pool-fed Converter may also pull
  up to `Σ inRate` from its input Pools in `(sourceNodeId, edgeId)` order).
  `f = min( 1, received / Σ inRate, min over out-edges k of headroom(destₖ) /
  outRateₖ )`, then `epsilon`-normalised into `[0, 1]`. `pull all`: if
  `f < 1 − epsilon` then `f = 0`.
  If `f > epsilon`: consume `f · inRateᵢ` on each input edge (from `inbox`
  first, then Pool pull); produce `f · outRateₖ` into each `destₖ`
  (`working += `, and settle the reservation: `reserved -= ` the amount
  originally reserved for this Converter). `moved[C] = f · Σ inRate`.

  **Exactly one activation per step, `0 ≤ f ≤ 1`** (gap 1). Because a Gate sizes
  its delivery from `accept(C)` (which already caps at `f ≤ 1` and at live
  output headroom via the reservation ledger), `received` never exceeds what `C`
  can consume — **`inbox` is always fully consumed, so no router holds anything
  between steps** (I5).

### Commit

`working` becomes the next `S`. Every Pool is already within `[0, capacity]` by
construction (I3); the commit asserts it. If `ended` was set, the run stops.

---

## 7. Node reference

| Node | Role | reads its edge rate as | `accept` |
|---|---|---|---|
| **Source** | creates resources from nothing, pushes downstream | amount to push per step | — |
| **Pool** | passive storage between steps; the only stateful node. Never auto-pulls or auto-pushes in Engine A | amount to move when pulled | `headroom(P)` |
| **Gate** | pulls, splits by fixed ratio, pushes — holds nothing | split **weight** per outgoing edge | see §6 |
| **Converter** | consumes inputs, produces outputs at its own ratio — holds nothing; ≤ 1 activation/step | consume-per-activation (in), produce-per-activation (out) | see §6 |
| **Drain** | pulls resources and removes them from the system | amount to pull per step | `∞` |
| **End** | any arrival `> epsilon` ends the run and marks it `fired` | amount to pull per step (if pool-fed) | `∞` |

The number on a resource edge is one value whose role (amount / weight / rate)
is decided by the active node at that end.

---

## 8. Flow expressions

| Form | Parsed to | Engine A `evalDet` |
|---|---|---|
| empty | const 1 | `1` |
| `2`, `0.5` | const | the number (must be finite ≥ 0) |
| `all` | all | `S[sourcePool] − taken[sourcePool]` (`0` on a Source edge) |
| `25%` | percent 0.25 | `0.25 · S[sourcePool]` (`0` on a Source edge) |
| `1-3` | range(1,3) | **`0`** + run diagnostic |
| `2D6`, `D6` | dice(2,6) / dice(1,6) | **`0`** + run diagnostic |

Ranges and dice are **parsed into structured values now** so the editor,
serialisation, and Engine B share one representation. Engine A cannot evaluate
randomness and does **not** substitute a stand-in value — the edge contributes
`0` so a wrong-but-plausible number never appears in a run. One diagnostic per
run: *"N edges use random flow — inactive in deterministic mode; needs Engine
B."* A lower-bound preview may later be an explicit opt-in.

---

## 9. `pull all` vs `pull any`

Per node, across **all** its input edges plus its output headroom:

- **`pull any`** (default): each input edge moves `min(want, avail)`
  independently; the node produces at whatever fraction it can.
- **`pull all`**: if the node cannot pull **every** input edge in full **and**
  place the full result, it moves **`0`** from every edge (atomic). For a Gate
  this is `T = 0` when `T < demand`; for a Converter, `f = 0` when `f < 1`; for
  a Drain/End, `0` when any input edge is short.

`push all` is the Source mirror: full push on every outgoing edge, or nothing.

---

## 10. Contention & ordering (Q2)

When two firing nodes pull from the same Pool and it cannot satisfy both:

1. Pull-phase nodes execute in **topological order** over the router DAG (a node
   after every upstream router it depends on).
2. Same topological rank → **ascending node id** ("first created, first
   served").
3. Within one node, multiple input edges are consumed in
   **`(sourceNodeId, edgeId)`** order.
4. Each pull takes from `S[P] − taken[P]`; earlier nodes/edges have priority.
5. A `pull all` node that cannot be satisfied from what remains takes **`0`**,
   leaving it for later nodes.

Because every pull reads the **snapshot** `S` (not `working`), the **final Pool
values are invariant to iteration order** except through this one explicit,
deterministic priority rule (I7). `events` are always emitted in this order.

---

## 11. Capacity & back-pressure (Q3, Q4, Q5)

- A transfer moves `min(demand, sourceAvailable, targetHeadroom)`. Capacity is
  enforced at transfer time, never by discarding an overfill.
- **Multiple producers into one Pool** cannot overfill it: each planned inflow
  is added to `reserved[P]` when the upstream router is executed, and
  `headroom(P)` subtracts `reserved[P]`. Producers execute in the deterministic
  `(topo, id)` order; each sees the headroom the earlier ones left (gap 2).
- Unmoved resources stay upstream (I4): in the source Pool, or unproduced by a
  Source.
- Routers never accumulate (I5): a blocked Gate/Converter pulls less input via
  `accept()`; nothing is left inside a zero-storage node between steps.
- **Converter partial input → proportional output (Q4).** One `f ∈ [0, 1]`
  scales every input consumption and every output production together.
- **Gate remainder (Q5).** The weighted split is exact over reals (no rounding
  remainder). A blocked branch reduces `T` itself (no spill); `demand − T` stays
  in the input Pool.

---

## 12. Invariants (acceptance checks)

| # | Invariant |
|---|---|
| **I1** | **Conservation.** Per step: `Σ Pool(after) = Σ Pool(before) + Σ Source pushes − Σ Drain/End pulls − Σ Converter net loss`. No resource is created or destroyed in transit. |
| **I2** | **Converter proportionality.** Per Converter per step there is a single `f ∈ [0, 1]` with `consumedᵢ = f·inRateᵢ` and `producedₖ = f·outRateₖ` for all its edges. |
| **I3** | **Capacity.** After every step every Pool value is within `[0, capacity]`; any clamp applied is `< epsilon`. |
| **I4** | **Back-pressure retention.** Anything a transfer could not move remains in the upstream Pool, or is not produced by a Source. Nothing is silently dropped. |
| **I5** | **Router zero-storage.** Gates and Converters hold `0` between steps; every `inbox` is fully consumed in the step it is filled. |
| **I6** | **Determinism.** `step` is pure and `initSim` is total. Same graph + same start ⇒ identical `state` sequence and identical `report` on every run and after every Reset. |
| **I7** | **Iteration-order invariance.** The result depends on node/edge iteration order only through the explicit `(topo rank, node id)` / `(sourceNodeId, edgeId)` priority rules; any other ordering of the same nodes yields the same `values` and `events`. |

---

## 13. The six questions, answered

1. **push or pull first?** — Push (Phase 1: Sources), then pull (Phase 2). A
   resource pushed into a Pool this step is pullable only next step; router
   chains still resolve within the step.
2. **Several nodes want the same Pool — order?** — Topological rank, then
   ascending node id; within a node, `(sourceNodeId, edgeId)`. Earlier = higher
   priority; each takes from what remains; `pull all` losers take `0` (§10).
3. **Capacity short — where do the resources stay?** — In the upstream Pool
   (back-pressure), or unproduced by a Source. Never discarded (I3, I4). Multiple
   producers are serialised through the reservation ledger (§11).
4. **Converter gets only part of its input — output proportional?** — Yes. One
   `f ∈ [0, 1]`, exactly one activation per step (I2).
5. **Gate split — the remainder?** — Exact weighted split over reals, no
   rounding remainder. A blocked branch shrinks the gate's total intake (no
   spill); the shortfall stays in the input Pool.
6. **Reset then the same input — same result?** — Yes. No RNG, no hidden state
   (I6).

---

## 14. Representative sample & expected results (test basis)

```
        e1: 3            e2: all         e3: w2 / consume 2
Source ───────► Pool V ─────────► Gate ───────────────────► Converter ──► Pool P
 (auto,        (init 0,         (det.,        │                (2 in → 1 out)   (init 0,
  push any)     cap 10)          pull any)    │ e4: w1                           cap 3)
                                             ▼
                                           Drain D
```

- All nodes `automatic`; all pull nodes `pull any`.
- `e3` rate `2` = Gate weight for that branch **and** Converter consume/activation.
  `e4` rate `1` = Gate's other weight. `e5` (Converter → P) rate `1` =
  produce/activation.

### Variant A — flowing equilibrium

Add **Drain D2** pulling `e6: 1` from Pool P (`pull any`).

| step | V | P | Src→V | V→G | G→C | C→P | G→D | P→D2 | note |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 0 | 0 | – | – | – | – | – | – | initial |
| 1 | 3 | 0 | 3 | 0 | – | – | – | 0 | gate idle: snapshot `V = 0` |
| 2 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 0 | first full cycle |
| 3 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 1 | **equilibrium** |
| ≥3 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 1 | steady state |

Steady-state balance: in `3` (Source); out `1` (D) + `1` (D2) + `1` (Converter
net loss) = `3`. V `+3 −3 = 0`; P `+1 −1 = 0`. ✔ I1.
`fired` at steady state = {Source, Gate, Converter, Drain D, Drain D2}. At
step 1 only {Source} fired (Gate/D2 activated, moved `0`).

### Variant B — bottleneck deadlock

Same diagram **without D2** — Pool P has no outlet.

| step | V | P | Src→V | V→G | G→C | C→P | G→D | note |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 0 | 0 | – | – | – | – | – | initial |
| 1 | 3 | 0 | 3 | 0 | – | – | – | gate idle |
| 2 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | |
| 3 | 3 | 2 | 3 | 3 | 2 | 1 | 1 | |
| 4 | 3 | 3 | 3 | 3 | 2 | 1 | 1 | **P at capacity** |
| 5 | 6 | 3 | 3 | 0 | – | – | – | gate stalls; V backs up |
| 6 | 9 | 3 | 3 | 0 | – | – | – | |
| 7 | 10 | 3 | 1 | 0 | – | – | – | **V at capacity; Source back-pressures 3 → 1** |
| 8 | 10 | 3 | 0 | 0 | – | – | – | frozen |
| ≥8 | 10 | 3 | 0 | 0 | – | – | – | stable terminal state |

Steps 5–7: `accept(G) = accept(C) · Σw/w_C = 0` (P full ⇒ `headroom(P) = 0` ⇒
`f_max = 0`), so `T = 0` and the 3 stay in V. Step 7: the Source can place only
`1` of `3`; the other `2` are never created. ✔ I3, I4, I6. `fired` at steps ≥ 5
= {Source} (step 5–6) then {} (step ≥ 8).

### Mini-cases

- **`pull all`:** Drain with `pull all`, input edge `flow 5`, Pool holds `4` ⇒
  pulls `0`; Pool keeps `4`. When the Pool holds `≥ 5` ⇒ pulls exactly `5`.
- **`25%`:** Gate input edge `flow 25%` from a Pool with `S[P] = 10` ⇒
  `want = 2.5`, independent of other pulls from `P` this step.
- **random flow:** Source edge `flow 2D6` ⇒ contributes `0`; run shows the
  "needs Engine B" diagnostic.

---

## 15. Deferred to Engine B / later

- RNG + seed reproducibility; evaluation of `1-3`, `2D6`; opt-in lower-bound preview
- Probabilistic gates; gate **round-robin** (needs discrete tokens)
- Monte-Carlo: many runs, percentile bands, end-step distribution
- State connections: label modifiers, node modifiers, **triggers**, **activators**
- `passive` / `interactive` activation
- Auto-pull / auto-push Pools
- Delay, Queue, Register (formula), Trader
- Typed / multi-colour resources
- **Integer-token mode** — reintroduces split remainders, enables round-robin
- **Gate spill / reroute mode** — a blocked branch's share flows to open branches

---

## 16. Decisions log (resolved for this freeze)

1. **Random flow in Engine A** → contributes `0` (not a min substitute).
2. **Gate** → fixed-ratio splitter, **no spill**.
3. **Amounts** → finite reals with `epsilon = 1e-9`; integer mode deferred (§5).
4. **Gate → Converter** → Gate-driven via `inbox`; the Converter never
   re-pulls that input; every router executes once per step.
5. **`fired`** → actual moved/produced/consumed `> epsilon`; `activated` is the
   separate "was evaluated" set; the UI pulse uses `fired`.
6. **Converter** → exactly one activation per step, `0 ≤ f ≤ 1`.
7. **Multiple producers into one Pool** → serialised via `reserved[P]` ledger in
   `(topo, id)` order.
8. **End** → `accept = ∞`; a `> epsilon` arrival ends the run and counts as
   `fired`.
9. **I7** → "Iteration-order invariance" (not full order independence).
