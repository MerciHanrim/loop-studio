# Execution semantics

How Loop Studio runs a diagram. The reference point is Machinations' observable
behaviour; where this document and Machinations disagree, that is a bug to fix
here.

This revision specifies **Engine A — the deterministic core**. Randomness,
Monte-Carlo, state connections, and interactive play are Engine B and are only
sketched here under *Deferred*.

> **Status: draft for review.** Nothing in `src/engine/` implements this yet
> beyond the Source → Pool → Drain slice. The expected-result tables at the end
> are the acceptance target; they become the first automated tests.

---

## 1. Scope of Engine A

**Modelled**

- Node kinds: **Source, Pool, Gate (deterministic), Converter, Drain, End**
- Resource connections with a flow rate
- Flow expressions **evaluated**: a constant (`2`), `all`, a percentage (`25%`)
- Flow expressions **parsed but not evaluated**: ranges (`1-3`), dice (`2D6`) —
  see §7
- Activation: `automatic`, `onStart`
- Flow modes: `pull any` / `pull all` on Gate·Converter·Drain, `push any` /
  `push all` on Source
- Pool capacity and **back-pressure**

**Not in Engine A** (see §12): probabilistic gates, RNG, Monte-Carlo, state
connections (triggers / activators / modifiers), `passive` / `interactive`
activation, auto-pull / auto-push pools, delay / queue / register / trader,
typed resources, gate round-robin.

---

## 2. The running model

A run is a fold over a **pure** step function:

```
state₀      = initSim(graph)
stateₙ₊₁, events, fired = step(graph, stateₙ)
```

- `state` is `{ step, values, ended }` where `values` maps every Pool id to a
  real number (Engine A works in real amounts, not integer tokens).
- `step` has **no hidden state**: its output depends only on `graph` and the
  `state` passed in. There is no RNG, no module-level cursor, no wall clock.
- `initSim` fully rebuilds `state` from the graph (each Pool = its `initial`,
  `step = 0`, `ended = false`).
- Therefore **Reset + the same graph reproduces the exact same sequence of
  states and events, every time** (invariant I6).

`events` is an ordered list of `{ edgeId, from, to, amount }` describing what
moved this step; it drives the animation and is asserted by tests. `fired` is
the set of node ids that activated this step (whether or not they moved
anything).

---

## 3. Time

- Discrete integer steps. **Step 0** is the initial state: Pools hold `initial`,
  nothing has flowed. **Step**/**Play** advances to 1, 2, 3, …
- Every step reads a **snapshot** `S` = the Pool values as committed at the end
  of the previous step. All pull demands are measured against `S` (and against
  what earlier nodes have already taken this step — §9), never against
  mid-step working values.
- A separate **working copy** of the values is mutated during the step and
  becomes `S` for the next step.

Consequence: a resource that a Source pushes into a Pool in step *n* is **not
pullable from that Pool until step *n+1*** (it is not in the snapshot yet).
Zero-storage routers (Gate, Converter) are the exception — see §5.

---

## 4. What fires each step

| Activation | Fires |
|---|---|
| `automatic` | every step |
| `onStart` | only on the first advance (step 0 → 1) |
| `passive` | never in Engine A (needs triggers — Engine B) |
| `interactive` | never in Engine A |

---

## 5. The step algorithm

Two phases. **Push before pull** (answer to Q1).

### Phase 1 — Push (Sources)

For each firing Source, in ascending node-id order, for each outgoing resource
edge in edge-creation order:

1. `want = evalDet(edge.flow)` (§7)
2. target `T` is the Pool the edge points at
3. `headroom(T) = capacity(T) − working[T]` (`∞` if `T` has no capacity)
4. `moved = clamp(want, 0, headroom(T))`
5. `working[T] += moved`; emit `{edge, from: source, to: T, amount: moved}`

`push all`: if **any** of the Source's outgoing edges cannot take its full
`want` (headroom `< want`), the Source pushes **nothing on any edge** this step
(atomic). `push any` (default): each edge moves what fits, independently.

Sources have infinite supply, so they never contend; `want − moved` is simply
not produced — it does not accumulate anywhere (I4).

### Phase 2 — Pull (Gates, Converters, Drains)

Routers hold nothing, so a Pool → Gate → Converter → Pool hand-off must resolve
inside one step. This needs the downstream capacity to be known before anything
is pulled, so Phase 2 is a **backward capacity pass** followed by a **forward
execution pass**.

**Router DAG.** Build the DAG whose nodes are the firing Gates / Converters /
Drains and whose edges are resource connections between them; Pools are the DAG
roots (sources). A cycle of zero-storage routers with no Pool in it is
ill-defined — Engine A treats every edge on such a cycle as flow `0` and emits a
diagnostic. Real feedback loops must contain a Pool.

**Backward pass — `accept(node)`** = the maximum it can take on its input side
this step, memoised over the DAG (leaves first):

| node | `accept` |
|---|---|
| Pool `P` | `headroom(P)` using the current working value (Phase-1 pushes included) |
| Drain `D` | `∞` |
| Converter `C` | largest input total `x` such that every output `j` gets `x · outRateⱼ / Σ inRate ≤ accept(destⱼ)`; also `≤ Σ inRate` (one activation's worth per unit `f`, unbounded activations) |
| Gate `G` | largest pulled total `T` such that every branch share `T · wⱼ / Σw ≤ accept(destⱼ)` — i.e. `T = minⱼ( accept(destⱼ) · Σw / wⱼ )` |

**Forward pass — execution**, routers in topological order (roots first), ties
broken by ascending node id:

- **Drain `D`** (pool-fed): for each input edge, `pull(D, edge)` (§8); consumed
  resources leave the system.
- **Gate `G`** (deterministic):
  - `demand = Σ evalDet(inEdge.flow)` over input edges (`all` → the pool's
    snapshot-minus-taken; `%` → fraction of the pool's snapshot)
  - `inputAvail = Σ (S[inPool] − taken[inPool])`
  - `T = min(demand, inputAvail, accept(G))`
  - pull `T` from the input pools (updating `taken` and `working`), emit
    `V→G` events
  - split by weight: branch `j` receives `T · wⱼ / Σw`, emit `G→destⱼ` events,
    hand that amount to `destⱼ` (a Pool adds it to `working`; a Drain consumes
    it; a Converter runs on it)

  **No spill.** If one branch is capacity-blocked, `accept(G)` shrinks and
  **all** branches scale down together; the un-pulled remainder stays in the
  input Pool. (A gate is a fixed splitter, not a router that reroutes. Spill /
  reroute is a candidate Engine-B feature — flagged in §13.)

- **Converter `C`**: let `f` = feasible fraction `∈ [0, 1+]` =
  `min( received / Σ inRate , accept-of-each-output / outRateⱼ )`. Consume
  `f · inRateⱼ` on each input edge, produce `f · outRateⱼ` on each output edge.
  A Converter fed by a Gate uses the amount the Gate handed it as `received`; a
  pool-fed Converter pulls `f · inRate` from the pool.

`pull all` on a Gate / Converter / Drain: if the feasible amount is **less than
the full demand**, the node moves **nothing** this step (atomic). `pull any`
(default): move the feasible amount.

### Commit

`working` becomes the next `S`. By construction every Pool is already within
`[0, capacity]` (I3); the commit asserts this rather than clamping. `ended` is
set if any resource was delivered to an **End** node this step (§6); once set,
the run stops.

---

## 6. Node reference

| Node | Role | Reads the edge rate as |
|---|---|---|
| **Source** | creates resources from nothing, pushes downstream | amount to push per step |
| **Pool** | passive storage between steps; the only stateful node | amount to move (when pulled) |
| **Gate** | pulls, splits, pushes — holds nothing | split **weight** on each outgoing edge |
| **Converter** | consumes inputs, produces outputs at its own ratio — holds nothing | consume-per-activation (in), produce-per-activation (out) |
| **Drain** | pulls resources and removes them from the system | amount to pull per step |
| **End** | any resource reaching it ends the run | — |

The number on a resource edge is one value with a context-dependent role
(amount / weight / rate), decided by the active node at that end.

A **Pool in Engine A never acts on its own** — it does not auto-pull or
auto-push. It only gains resources from an upstream push and loses them to a
downstream pull.

---

## 7. Flow expressions

| Form | Parsed to | Engine A evaluation (`evalDet`) |
|---|---|---|
| empty | const 1 | `1` |
| `2`, `0.5` | const | the number |
| `all` | all | `S[sourcePool] − taken[sourcePool]` (0 for a Source edge) |
| `25%` | percent 0.25 | `0.25 · S[sourcePool]` (0 for a Source edge) |
| `1-3` | range(1,3) | **`1`** (the minimum) + run diagnostic |
| `2D6`, `D6` | dice(2,6) / dice(1,6) | **`2`** / **`1`** (the minimum) + run diagnostic |

Ranges and dice are **parsed into structured values now** so the editor,
serialisation, and Engine B all share one representation, but Engine A cannot
evaluate randomness. It substitutes the **minimum** so a diagram containing dice
still runs and previews a lower bound, and surfaces one diagnostic per run:
*"N edges use random flow; held at minimum (deterministic mode). Full evaluation
arrives with Engine B."*

> **Open decision (§13):** minimum vs. treating a random edge as inert (`0`).

---

## 8. `pull` helper

```
pull(node, edge) →
  P     = edge.source                      // a Pool
  avail = S[P] − taken[P]                   // snapshot minus earlier claims
  want  = evalDet(edge.flow)               // 'all' → avail ; '25%' → 0.25·S[P]
  amt   = (node is pull-all) ? (avail ≥ want ? want : 0)
                             : clamp(want, 0, avail)
  taken[P] += amt ; working[P] −= amt
  emit { edge, from: P, to: node, amount: amt }
  return amt
```

`pull all` atomicity is evaluated per node across **all** its input edges plus
its output headroom: if the node cannot pull every input edge in full **and**
place the full result, it pulls `0` from every edge.

---

## 9. Contention & ordering (Q2)

When two firing nodes pull from the same Pool and it cannot satisfy both:

1. Pull-phase nodes execute in **topological order** over the router DAG (a node
   is processed after every upstream router it depends on).
2. Nodes at the same topological rank are ordered by **ascending node id**
   (ids are minted in creation order, so this is "first created, first served").
3. Each puller takes from the Pool's **remaining** amount
   `S[P] − taken[P]`; earlier nodes in the order have priority.
4. A `pull all` node that cannot be satisfied from the remaining amount takes
   **nothing**, leaving it for later nodes.

The **final Pool values** after a step do not depend on any other iteration
order (I7); only genuine contention invokes the priority rule, and that rule is
itself deterministic. `events` are always emitted in this same fixed order.

---

## 10. Capacity & back-pressure (Q3, Q4, Q5)

- **A transfer moves `min(demand, sourceAvailable, targetHeadroom)`.** Capacity
  is enforced at the moment of transfer, never by discarding an overfill.
- **Unmoved resources stay upstream** (I4): in the source Pool if the block is
  downstream; simply unproduced if the blocked node is a Source.
- **Routers never accumulate.** A Gate or Converter that cannot pass resources
  through pulls less input (`accept()` in §5). Nothing is left "inside" a
  zero-storage node between steps (I5).
- **Converter partial input → proportional output (Q4).** One fraction `f`
  scales every input edge's consumption and every output edge's production
  together. `f < 1` from either a starved input or a full output pool.
- **Gate remainder (Q5).** Deterministic split is by weight and is exact
  (`Σ branch shares = T`, real numbers, no rounding remainder). If a branch is
  capacity-blocked, `T` itself is reduced (no spill), and `demand − T` stays in
  the input Pool.

---

## 11. Invariants (the acceptance checks)

| # | Invariant |
|---|---|
| **I1** | **Conservation.** For every step: `Σ Pool(after) = Σ Pool(before) + Σ Source pushes − Σ Drain pulls − Σ Converter net loss`. No resource is created or destroyed in transit. |
| **I2** | **Converter proportionality.** Per Converter per step there is a single `f ≥ 0` with `consumedⱼ = f·inRateⱼ` and `producedₖ = f·outRateₖ` for all its edges. |
| **I3** | **Capacity.** After every step, every Pool value is within `[0, capacity]` (`[0, ∞)` if uncapped). Enforced by construction, not by lossy clamping. |
| **I4** | **Back-pressure retention.** Any amount a transfer could not move remains in the upstream Pool, or is not produced by a Source. Nothing is silently dropped. |
| **I5** | **Router zero-storage.** Gates and Converters hold `0` between steps. |
| **I6** | **Determinism.** `step` is pure and `initSim` is total. Same graph + same start ⇒ identical `state` sequence and identical `events` on every run and after every Reset. |
| **I7** | **Order independence.** Final Pool values depend on node iteration order only through the explicit, deterministic contention rule of §9. |

---

## 12. The six questions, answered

1. **push or pull first in a step?** — **Push first** (Phase 1: Sources), then
   pull (Phase 2: Gates / Converters / Drains). A resource pushed into a Pool
   this step is visible to pulls only next step; router chains still resolve
   within the step.
2. **Several nodes want the same Pool — in what order?** — Topological order
   over the router DAG, then ascending node id. Earlier = higher priority; each
   takes from what remains. `pull all` losers take nothing (§9).
3. **Capacity short — where do the resources stay?** — In the upstream Pool
   (back-pressure), or unproduced if the blocked node is a Source. Never
   discarded (I3, I4).
4. **Converter gets only part of its input — is the output proportional?** —
   Yes. A single fraction `f` scales all of its inputs and outputs together
   (I2).
5. **Gate split — what happens to the remainder?** — Deterministic split is
   exact (real-number weights, no rounding remainder). A capacity-blocked branch
   shrinks the gate's total intake (no spill); the shortfall stays in the input
   Pool.
6. **Reset then the same input — always the same result?** — Yes. No RNG, no
   hidden state; `step` is pure and `initSim` fully resets (I6).

---

## 13. Representative sample & expected results

The deterministic slice's acceptance sample. One diagram exercises supply,
storage, splitting, conversion, consumption, capacity and determinism.

```
        e1: 3            e2: all         e3: w2 / consume 2
Source ───────► Pool V ─────────► Gate ───────────────────► Converter ──► Pool P
 (auto,        (init 0,         (det.,        │                (2 in → 1 out)   (init 0,
  push any)     cap 10)          pull any)    │ e4: w1                           cap 3)
                                             ▼
                                           Drain D
```

- All nodes `automatic`. All pull nodes `pull any`.
- `e3` rate `2` is both the Gate's weight for that branch **and** the
  Converter's consume-per-activation. `e4` rate `1` is the Gate's other weight.
- `e5` (Converter → P) rate `1` = produce-per-activation.

### Variant A — flowing equilibrium

Add **Drain D2** pulling `e6: 1` from Pool P (`pull any`). P now has an outlet.

| step | V | P | Src→V | V→G | G→C | C→P | G→D | P→D2 | note |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 0 | 0 | – | – | – | – | – | – | initial |
| 1 | 3 | 0 | 3 | 0 | – | – | – | 0 | gate idle: snapshot `V = 0` |
| 2 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 0 | first full cycle |
| 3 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 1 | **equilibrium** |
| ≥3 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | 1 | steady state |

Balance at steady state: in `3` (Source); out `1` (D) + `1` (D2) + `1`
(Converter net loss: 2 consumed, 1 produced) = `3`. V: `+3 −3 = 0`. P:
`+1 −1 = 0`. ✔ I1.

### Variant B — bottleneck deadlock

Same diagram **without D2** — Pool P has no outlet.

| step | V | P | Src→V | V→G | G→C | C→P | G→D | note |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 0 | 0 | – | – | – | – | – | initial |
| 1 | 3 | 0 | 3 | 0 | – | – | – | gate idle |
| 2 | 3 | 1 | 3 | 3 | 2 | 1 | 1 | |
| 3 | 3 | 2 | 3 | 3 | 2 | 1 | 1 | |
| 4 | 3 | 3 | 3 | 3 | 2 | 1 | 1 | **P at capacity** |
| 5 | 6 | 3 | 3 | 0 | – | – | – | gate stalls; V starts backing up |
| 6 | 9 | 3 | 3 | 0 | – | – | – | |
| 7 | 10 | 3 | 1 | 0 | – | – | – | **V at capacity; Source back-pressures 3 → 1** |
| 8 | 10 | 3 | 0 | 0 | – | – | – | frozen |
| ≥8 | 10 | 3 | 0 | 0 | – | – | – | stable terminal state |

Every non-moved resource is accounted for: steps 5–7 the Gate's `demand` (3)
cannot be met by `accept(G) = 3·headroom(P) = 0`, so it pulls `0` and the 3 stay
in V; step 7 the Source can only place `1` of its `3` and the other `2` are
never created. ✔ I3, I4, I6.

### A `pull all` mini-case

Drain `D` with `pull all`, one input edge `flow 5`, from a Pool holding `4`:
`avail (4) < want (5)` ⇒ D pulls **0**; the Pool keeps its `4`. Next step the
Pool holds `≥ 5` ⇒ D pulls exactly `5`.

### A `25%` mini-case

Gate input edge `flow 25%` from a Pool with snapshot `S[P] = 10`:
`want = 0.25 · 10 = 2.5`, regardless of what else pulls from `P` this step
(the percentage is of the snapshot, not the running value).

---

## 14. Deferred to Engine B (not in this slice)

- RNG + seed reproducibility; evaluation of `1-3` and `2D6`
- Probabilistic gates; gate **round-robin** (needs discrete tokens)
- Monte-Carlo: many runs, percentile bands, end-step distribution
- State connections: label modifiers, node modifiers, **triggers**, **activators**
- `passive` / `interactive` activation
- Auto-pull / auto-push Pools
- Delay, Queue, Register (formula), Trader
- Typed / multi-colour resources
- Integer-token mode (would reintroduce split remainders and enable round-robin)

## 15. Open decisions for review

1. **Random flow in Engine A:** substitute the **minimum** (current proposal,
   diagram still previews) vs. treat the edge as **inert `0`**.
2. **Gate spill:** confirm **no spill** for Engine A (a blocked branch stalls
   the whole gate). Spill / reroute would be an Engine-B option.
3. **Real amounts vs integer tokens:** Engine A uses **real numbers**. Integer
   mode is deferred (§14) — confirm that's acceptable for the deterministic
   slice and its tests.
4. **Converter fed by a Gate:** the Converter consumes what the Gate hands it
   (Gate-driven), it does **not** separately pull. Confirm.
5. **`fired` semantics:** a node is "fired" if it **activated**, even if
   `accept`/availability left it moving `0`. Confirm (affects the firing-pulse
   cue in the UI).
