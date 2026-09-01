# Example graphs

Graphs with different jobs:

| file | role | Import? |
|---|---|---|
| `engine-b-verification.json` | **precision instrument** — small isolated lanes, each checking one number, so a broken feature is easy to pin | yes |
| `engine-b-verification.expected.json` | test oracle for the above — read by `verification-fixture.test.ts` and by a human comparing values | **no** (not a graph) |
| `state-verification.json` | **state precision instrument** — one connected graph exercising every executable `trigger` / `activator` / `label` behaviour | yes |
| `state-verification.expected.json` | test oracle for the above — read by `state-verification.test.ts` and by a human comparing the per-step trace | **no** (not a graph) |
| `risky-factory.json` | **product demo** — one connected economy that exercises every working node kind and Engine A/B feature at once | yes |
| `model-verification.json` | **model-language precision instrument** — a `parameter`, five `register`s (DAG, `/0`, depends-on-invalid, self-cycle) and an advisory `resourceType` mismatch, in one deterministic economy | yes |
| `model-verification.expected.json` | test oracle for the above — read by `test/model-verification.test.ts` and by a human comparing `R(t)` | **no** (not a graph) |
| `playback-choreography.json` | **Simulation Playback demo** — one graph that reproduces every choreography cue at once (resource token, `trigger` bead, `activator` settle cue, signed `label` deltas), on Bézier **and** orthogonal edges, with a 65-edge fan that pushes past the 60-token budget | yes |
| `mmo-progression.json` | **product demo / Templates entry** — "Early MMO progression (levels 1–15)": a connected play economy with three zone lanes, probabilistic combat, categorised loot, a gold economy with repair / resupply costs, and a rising XP curve | yes (also in **Templates ▾**) |
| `mmo-progression.ko.json` | **Korean-language independent derived copy** of the file above — display-only node `label` / `resourceType` strings translated, everything else (ids, structure, positions, expressions, edges, `recommendedRunConfig`, schema/version) byte-identical, so it reproduces the exact same run. **Not registered in Templates ▾ or anywhere in the app** — a separate file for a Korean-labelled read of the same example, imported manually | yes (Import only — not a Templates entry) |

---

# 1 — Engine B verification fixture

`engine-b-verification.json` is a real **Export** from Loop Studio — a graph with
three independent lanes that together exercise Engine A and Engine B (seeded RNG,
Monte-Carlo). `engine-b-verification.expected.json` records the values a correct
build must reproduce.

`src/engine/verification-fixture.test.ts` re-derives every expected value from the
fixture on every `npm test`, so a regression here fails CI.

> Import `engine-b-verification.json` only. `engine-b-verification.expected.json`
> is a test oracle and is not an importable graph.

## The three lanes

| lane | wiring | what it proves |
|---|---|---|
| **Deterministic** | `Det Source ─2→ Det Pool (init 1) ─1→ Det Drain` | `Det Pool` rises by **exactly 1** every step (Engine A regression). Its Monte-Carlo band has zero spread — `p10 == p50 == p90`. |
| **Dice** | `Dice Source ─2D6→ Dice Pool ─1-3→ Dice Drain` | Same `seed` ⇒ identical trajectory; a different `seed` diverges. The Monte-Carlo `p10–p90` band **widens into a real cone** over the run. |
| **Probabilistic Gate** | `Gate In (init 1000) ─4→ Split (probabilistic) ─w1→ Gate A ; ─w3→ Gate B` | Exactly **one branch** moves per step. Over 200 × 30 runs the split lands ≈ **25 / 75** (`Gate B` share ≈ 0.75). |

There is deliberately **no End node** — it would end runs early and hide the
other lanes. End + carry-forward are covered by `step.b1.test.ts` (vector V2).

## `expected.json` contents

- `pools` — the fixture's Pool ids by role
- `deterministicLane` / `diceLane` / `gateLane` — seed-1 (and seed-2) Pool
  values for the first 10 steps, plus the per-lane assertions
- `monteCarlo` — the standard verification run: **200 runs · 30 steps ·
  baseSeed 1**, tracking all four Pools; the expected `p10/p50/p90` vectors per
  Pool; a change-detector hash of the full `MonteCarloResult` JSON; and a digest
  (completed runs, run-0 seed, final means).

## Manual check in the app

```
Import  examples/engine-b-verification.json
Step 10 times at seed 1
  → Det Pool = 2,3,4,…,11  (exactly +1 each step)
  → compare Dice Pool / Gate A / Gate B against expected.json seed-1 values
Set seed 2, Reset, Step 10 times
  → Dice Pool now differs (diceLane.seed2PoolValues)
Monte Carlo → runs 200, steps 30, base seed 1, all Pools tracked → Run
  → DISTRIBUTION: Det Pool band is a flat line; Dice Pool band is a widening cone
  → switch the Pool selector; check Gate A / Gate B bands; header "Ended 0%"
  → Export ▾ → Runs CSV: Gate B column ≈ 3× the Gate A column
Reset and Run again with the same config → identical result
```

## Regenerating

The **graph** is regenerated by rebuilding the three lanes in the app exactly as
above and using **Export** (this is what keeps the schema and handle ids on the
real serialization path). The **expected values** are regenerated from whatever
`engine-b-verification.json` currently holds:

```bash
GEN_FIXTURE=1 npx vitest run src/engine/verification-fixture.test.ts
```

---

# 2 — State verification fixture

`state-verification.json` is one connected graph that exercises **every
executable state connection** (`loop-state/1` semantics + `loop-state/2` label
reporting) in a single importable model. `state-verification.expected.json`
records the full per-step trace a correct build must reproduce —
`src/engine/state-verification.test.ts` re-derives it on every `npm test`.

> Import `state-verification.json` only. `state-verification.expected.json` is a
> test oracle, not an importable graph.

## What it wires

| cluster | wiring | what it proves |
|---|---|---|
| **Trigger + activation** | `Pulse Source ─2→ Buffer ─1→ Passive Drain` / `─1→ Interactive Drain`; `Pulse Source ┄trigger d0┄> Passive Drain` **twice** (`t_pd_a`, `t_pd_b`); `Pulse Source ┄trigger d2┄> Interactive Drain` | delay 0 delivers on `fired + 1` (step 2); delay 2 on `fired + 3` (step 4); **two pulses into one target ⇒ one execution, both edges reported**; `interactive` behaves exactly as `passive` headless |
| **Activator AND** | `Gauge Source ─1→ Gauge A` (ramps 0,1,2,3,…); `Gauge B` static 4; both `┄activator ">= 3"┄> Passive Drain` | AND of two — `Gauge B` always satisfied, `Gauge A` crosses at step 4. While the gate is shut the pulse still **arrives and is consumed as `applied:false`** (never re-held); it fires the step the gate opens |
| **Label + clamp** | `Feeder` (10, isolated) `┄"-1"┄>` and `┄"+S"┄> Tank` (cap 8) `─4→ Tank Drain`; `Feeder ┄"=7"┄> Level` (cap 5) | `+` / `-` / `=` all evaluated; each edge's `delta` is its own request; the **single per-target clamp** rides the last label event as `clampAdjustment` (`Tank`: `−1 / −9 / −5`; `Level`: `−2` every step); `Feeder` is read-only, never debited |

There is **no End node** — state never ends a run (I10-S), and an early End would
hide the later steps.

## `expected.json` contents

- `frames` — for **steps 0–6**: every Pool's committed value, the sorted `fired`
  set, the full `stateEvents` array (ascending `edgeId`), and the pending
  `triggerQueue` (canonical `deliveryStep, edgeId` order), all by node **label**
  so they are readable.
- `roundTrip` / `arrayReverse` — the trace is identical after
  `Import → Export → Import` and after reversing the node/edge arrays (I8-S).
- `monteCarlo` — state carries no RNG, so every run is identical and
  `runMonteCarlo` == cooperative == parallel == a standalone per-seed trace
  (I9-S / path invariance).

## Manual check in the app

```
Import  examples/state-verification.json

Step 1 → Buffer 2 ; Tank 8 ; Level 5 ; Passive/Interactive Drain do NOT fire
Step 2 → Tank Drain fires (Tank 8→4) ; select t_pd_a / t_pd_b — both pulse,
         labelled "blocked" (Gauge A = 1, activator shut)
Step 3 → still blocked (Gauge A = 2)
Step 4 → Passive Drain AND Interactive Drain fire ; the activator edges turn
         "on" ; the trigger pulses are no longer blocked
Steady from step 4: Buffer 6, Tank 4, Level 5

Select each state edge → the Inspector shows its mode, the delay / expression,
  and a green "ok" or red hint. The `+S` edge flashes toward Tank; the `-1`
  edge flashes away and carries a separate "clamp −n" note.
Reset → every pulse / tint / flash clears; step index returns to 0.
Export ▾ → JSON, New graph, Import it back → identical trace (delay 2 kept).
```

## Regenerating

```bash
GEN_FIXTURE=1 npx vitest run src/engine/state-verification.test.ts
```

---

# 3 — Risky Factory (feature demo)

`risky-factory.json` is one connected economy — 18 nodes — built to show every
working node kind and Engine A/B feature in a single graph you can watch run.

```
Ore Source (2D6) ─→ Ore Stock (cap 50)
      └─ Ore Router (deterministic 4 : 1) ─┬─ Refined Ore (cap 12)
                                           └─ Tailings (cap 15) ─(1-3)→ Waste Drain
Energy Source (1-3) ─→ Energy Pool (cap 20)

Refined Ore ×3  +  Energy ×1  ─ Assembly Converter ─→ Components (cap 30)  [2 Parts]
      └─ Quality Gate (probabilistic 17 : 3 : 1) ─┬─ Finished Goods (cap 25) ─(1-3)→ Sales Drain
                                                  ├─ Scrap Pool (cap 12) ─ Recycler (2 → 1) ─→ Salvage Pool (cap 10) ─(1)→ Salvage Drain
                                                  └─ Critical Defect (End)
```

| feature | where |
|---|---|
| random flow `2D6` / `1-3` | Ore Source, Energy Source, the two `1-3` drains |
| Pool capacity + back-pressure | Refined Ore and Energy Pool pin at their caps; the shortfall pushes back up the chain to Ore Stock and the Sources |
| deterministic Gate split | Ore Router sends resources **4 : 1** to Refined Ore vs Tailings every step |
| multi-input Converter, proportional scale-down | Assembly needs 3 ore + 1 energy per batch; a short input lowers the batch fraction |
| probabilistic Gate, one branch per step | Quality Gate routes the whole step to exactly one of Finished / Scrap / End |
| a second Converter on a recycling branch | Scrap Pool → Recycler (2 → 1) → Salvage Pool → Salvage Drain — a **dead-end side-channel**, not a cycle; nothing returns upstream |
| ordinary Drain vs probabilistic End | Sales / Waste / Salvage drains run every step; **Critical Defect** ends a run at random (weight 1 of 21 ≈ 5 %) |
| seed reproducibility | same seed ⇒ identical run; a different seed diverges and ends on a different step |
| Monte-Carlo bands + termination sparkline | Finished Goods shows a real `p10–p90` spread; the sparkline shows *when* the Critical Defect tends to hit |

The Scrap → Recycler → Salvage path is a **recycling branch**, not a loop back
into production — it drains to `Salvage Drain` and stops there.

## Manual check in the app

The probabilistic `Critical Defect (End)` can stop a run at any step — including
very early — so the seeds have distinct jobs:

| goal | seed / config |
|---|---|
| **watch the factory run** (steady state) | live sim, **seed 3** — survives all 40 steps |
| **reproduce an early termination** | live sim, **seed 1** — the Critical Defect fires at step 2 (`Replay` reproduces it exactly — seeded RNG) |
| **see the termination distribution** | Monte Carlo **500 × 40, base seed 1** |

This file carries a `recommendedRunConfig`, so **Import already fills the Monte
Carlo dialog** with `500 × 40, base seed 1` and the six tracked Pools below —
just open it and press Run.

```
Import  examples/risky-factory.json

Live — seed 3, Play → runs all 40 steps; Ore Stock climbs toward 50,
                      Refined Ore and Energy Pool sit pinned at capacity
Live — seed 1, Play → a Critical Defect ends it at step 2; Replay repeats it
Live — seed 4 ends ~step 25,  seed 8 ends ~step 36

Monte Carlo → dialog is pre-filled: runs 500, steps 40, base seed 1
  tracked: Ore Stock, Energy Pool, Components, Finished Goods, Scrap Pool, Salvage Pool
  Run → DISTRIBUTION:
    • Finished Goods band has a visible p10–p90 spread
    • the termination sparkline rises then flattens near ~85 % (424 / 500)
  Export ▾ → Runs CSV / JSON
Reset and Run again with the same config → identical result
```

> `recommendedRunConfig` is advisory metadata — the engine ignores it. It is
> written by every **Export** (your current seed / runs / steps / tracked Pools,
> plus `timelineSeries` — the series the Timeline shows by default — and
> `canvasLocked` when the Canvas edit-lock is on) and applied on **Import** /
> **Templates** / **Workspace** / **Share**. Run results and the LIVE/DISTRIBUTION
> view are not saved. A file without the Monte-Carlo fields leaves your current MC
> settings untouched; a file without `timelineSeries` shows every series, and one
> without `canvasLocked` opens unlocked — all as before.
>
> `timelineSeries` and `canvasLocked` are **display preferences only** —
> `timelineSeries` is Pool *and* Register ids, sorted, with deleted / unknown ids
> ignored; `canvasLocked` is a boolean opening the Canvas in a readable edit-lock
> (selection, the read-only Inspector, pan / zoom and the simulation still work).
> Neither touches the GraphDoc, the `loop-revision/*` digest, undo, or a
> simulation result, and the user can flip either from the UI at any time.
> Project **revisions** carry no run config (unchanged), so they carry neither
> field. Known limitation: an *older* Loop Studio that predates a field will drop
> it on re-save (there is no unknown-field preservation); current and newer builds
> round-trip both losslessly.

`src/engine/risky-factory.test.ts` builds this graph and pins only its structural
invariants (every node kind present, one branch per gate step, the 4 : 1 split,
Components/Finished actually produced, `0 % < ended < 100 %`, a populated
sparkline) — not exact values, so honest engine changes don't force a rewrite.

## Regenerating

```bash
GEN_RISKY_FACTORY=1 npx vitest run src/engine/risky-factory.test.ts
```

---

# 4 — Model language verification fixture

`model-verification.json` is one connected, **fully deterministic** economy (no
dice, no probabilistic gates) built to exercise every `loop-expr/1` +
`loop-model/1` + `loop-revision/2` behaviour in a single importable graph.
`model-verification.expected.json` records the canonical expression forms, the
per-step `S(t)` / `R(t)` trace, the advisory mismatch finding, and the
`loop-revision/2` digests a correct build must reproduce —
`test/model-verification.test.ts` re-derives it on every `npm test`, and
`e2e/model-verification.spec.ts` replays it through the app on **desktop and
mobile**.

> Import `model-verification.json` only. `model-verification.expected.json` is a
> test oracle, not an importable graph.

## What it wires

```
Mint ─3→ Gold (init 10, "Gold") ─2→ Upkeep         Gold climbs +1 / step  → 16 at step 6
              Mana (init 2, "Mana") ─1→ Upkeep      Mana: 2, 1, 0, 0, …

Reserve rate  (parameter, value 2)
Reserve   = @gold * @p_rate         valid every step   (Pool × Parameter)
Headroom  = @r_reserve + 10         valid every step   (Register → Register, a DAG)
Gold:Mana = @gold / @mana           valid t0–t1, then M_REG_EVAL (÷0 once Mana = 0)
Ratio − 1 = @r_ratio - 1            cascades: M_REG_DEPENDS_ON_INVALID from t2
Self loop = @r_loop + 1             M_REG_CYCLE at every step
```

- the edge `Gold ─→ Upkeep` is tagged `resourceType: "Mana"` while the `Gold`
  pool is `"Gold"` — one **advisory mismatch** finding; it changes nothing that
  runs.
- an invalid Register **never halts the run** — pools keep advancing after t2.
- `R(t)` is recomputed from `S(t)` each step and **stored nowhere**: the
  `loop-revision/*` content digest is byte-identical before and after a run.

## `expected.json` contents

- `canonicalExprs` — each Register's `expr` in `loop-expr/1` §X8 AST text form
- `pools` — `Gold` / `Mana` values for steps 0–6
- `registers` — `R(t)` for every Register at each of steps 0–6: a number, or
  `{ "invalid": "M_REG_*" }`
- `resourceMismatches` — the one advisory `resourceType` finding
- `revision2` — the `loop-revision/2` v2 digest; `conservativeExtension` (the
  model-stripped v1 baseline is byte-identical under either projection); and
  `advisoryDiff` — the model graph vs the same graph with only `resourceType` /
  a Register `unit` nudged: `engineAffecting: false`, `advisoryAffecting: true`
- `workspaceRoundTrip` — Export a Workspace after stepping to 3: the wire id
  stays `loop-workspace/1` v1 (no `loop-workspace/2`); the saved `simulation`
  keys are pools + step + seed + fired + series only —
  `savedStateMentionsARegister: false`; re-Import restores `S(3)` and
  `registersRecomputedEqualExport: true` (R(t) from the GraphDoc + restored
  `S(t)`, identical to Export time)
- `malformedAcceptance` — the pure side of the malformed-payload guarantees: a
  string / `Infinity` Parameter value, a non-string / unparseable Register
  `expr`, and non-object `data` are all rejected with **no `0` stand-in**; an
  unseatable model node fails `readRevisionSide` at the §R2-1.1 structural gate;
  a resource edge onto a model node is refused. The **UI** side — graph opens,
  Canvas / Inspector never crash, an `unreadable` fallback is shown, and the
  `project` header is dropped so Review / Apply is unreachable — is
  `e2e/model-nodes.spec.ts`.

## Manual check in the app

```
Import  examples/model-verification.json
Step 1 → select "Reserve"   → Inspector "Value at step 1: 22  (recomputed … never stored)"
         select "Gold:Mana"  → "Value at step 1: 11"
Step to 3 → select "Gold:Mana" → "M_REG_EVAL · … — no value at step 3"
           select "Ratio − 1"  → "M_REG_DEPENDS_ON_INVALID …"
           select "Self loop"   → "M_REG_CYCLE …"   (and the run is still going)
Timeline → one dashed line per Register that has a valid run; "Gold:Mana" and
           "Ratio − 1" stop at t1 with a GAP, not a bridged line; "Self loop"
           has no line at all
Select the Gold ─→ Upkeep edge → Inspector shows "Type mismatch: Mana ↔ Gold. Advisory …"
Reset → Register values recompute for step 0; nothing about the graph changed.

Export ▾ → Workspace JSON at step 3, New graph, Import it back
  → step 3 and the Pool counts are restored; the saved file has no Register
    values (it is `loop-workspace/1`, unchanged)
  → select "Reserve" → the same "Value at step 3" as before (recomputed)
```

## Regenerating

```bash
GEN_MODEL_VERIFICATION=1 npx vitest run test/model-verification.test.ts
```

---

# 5 — Simulation Playback choreography demo

`playback-choreography.json` is one connected graph built to make **every
Simulation Playback / Event Choreography cue visible at once** when you press
Play. It is a **reproducible visual / interaction fixture, not a semantics
oracle** — Playback is a display layer over the existing engine, so there is
**no `playback-choreography.expected.json`**. Its verification of record is the
E2E suite listed below plus `e2e/playback-fixture.spec.ts`, which imports this
file and checks the cues, the budget, and the invariance assertions.

> Import `playback-choreography.json` and press **Play** (live sim, any seed —
> the graph is fully deterministic). It has no `recommendedRunConfig`; Monte
> Carlo is not the point here.

## What it wires

| cluster | wiring | the cue it shows |
|---|---|---|
| **Fan** | `Fan Source ─1→ P00 … P64` — **65 resource edges**, four of them `route: "orthogonal"` | 65 travelling **resource tokens** in one step — more than the **`MAX_PLAYBACK_TOKENS_TOTAL` = 60** budget, so ~10 edges commit their value with **no** animation |
| **Merge** | `Merge A ─3→` and `Merge B ─2→ Merge Pool` (both `orthogonal`) | two resource tokens into one pool; each edge's token is labelled with its own amount; the pool value is their sum |
| **Signal** | `Signal Source ─1→ Gate Pool` ; `Signal Source ┄trigger d0┄▷ Signal Drain` ; `Gate Pool ┄activator "≥ 1"┄▷ Signal Drain` | the **`trigger` bead** rides the real edge `d` on its delivery step; the **`activator`** never travels — its target-side cue lands on the **`arrive`** beat once `Gate Pool ≥ 1` |
| **Label** | `Feeder ┄"+5"┄▷ Tank` and `Feeder ┄"-2"┄▷ Tank` | a **signed `label` delta bead** per edge — toward the target for `+`, away for `−` — never merged into a resource token |

`Fan Source` / `Merge *` / `Signal Source` are automatic, so a plain **Play**
drives the whole thing; the `trigger` delivers on step 2 (`fired + delay + 1`).

## QA checklist — each behaviour and the test that locks it

| you should see… | when | locked by |
|---|---|---|
| a dot departs the source, travels the **exact rendered `d`**, arrives, then the value updates | Play / Step, any zoom ≥ L1 | `e2e/playback-choreography.spec.ts` "token walks the real Bézier / orthogonal edge d", "token position tracks τ" |
| **Bézier and orthogonal** edges both carry the token on their own `d` | Merge edges (orthogonal) vs Fan edges (Bézier) | `e2e/playback-fixture.spec.ts` "token walks the real d on both…", `e2e/edge-routing.spec.ts` "every path consumer reads the same d" |
| Pause **freezes** the token; Resume continues; a speed change does not jump | Pause mid-travel | `e2e/playback-choreography.spec.ts` "Pause freezes the token…" |
| several transfers on one edge ⇒ **one** token, label = the exact sum; a selected edge shows the capped `+N` breakdown | select a Merge edge | `e2e/playback-choreography.spec.ts` "several transfers on one edge…", `e2e/playback-caps-perf.spec.ts` "MAX_PLAYBACK_TOKENS … breakdown chips" |
| the **`trigger`** bead rides the edge on its delivery step; blocked ⇒ hollow | step 2 | `e2e/playback-choreography.spec.ts` "trigger rides the real … edge d", `e2e/state-ui.spec.ts` |
| the **`activator`** shows a target-side cue on **`arrive`** and never a travelling bead | once `Gate Pool ≥ 1` | `e2e/playback-choreography.spec.ts` "activator does not travel…", `e2e/playback-fixture.spec.ts` "the activator edge never renders a travelling bead" |
| a **signed `label` delta** bead per edge, by sign, never merged with the resource token | every step | `e2e/playback-choreography.spec.ts` "label — a signed-delta bead by sign…" |
| more than **60** travelling cues in a step ⇒ exactly 60 animate, the rest still commit; the chosen set is deterministic and input-order-independent; **≤ 1** travelling element per edge | the Fan | `e2e/playback-caps-perf.spec.ts` (whole file), `e2e/playback-fixture.spec.ts` "every travelling cue kind renders, and the global 60-token budget bites", `src/engine/state-one-cue-per-edge.test.ts` |
| the budget is sorted **once per transition**, not per edge or per τ frame | any run | `e2e/playback-caps-perf.spec.ts` "the budget is sorted ONCE per transition" |
| **L0** (zoom `< 0.45`): no travelling dot / state bead; the ordered depart / path-pulse / arrive cues + `settle` still play | zoom out | `e2e/playback-choreography.spec.ts` "§PB4.4 — at L0 the travelling dot is elided", `e2e/playback-fixture.spec.ts` "reduced motion and L0 both drop every travelling element" |
| **`prefers-reduced-motion: reduce`**: zero travelling elements ever; a static edge cue instead; a Paused transition never auto-settles | OS setting | `e2e/playback-choreography.spec.ts` "reduced motion ⇒ no travelling element ever", "Play settles far faster…" |
| a11y: one always-mounted polite live region announces `Step N` / `Paused at step N`; no announce on theme / selection / speed | Play / Step / Pause | `e2e/playback-a11y-background.spec.ts` (whole file) |
| `forced-colors: active`: the resource token, trigger bead, activator cue and label bead stay **distinguishable without hue** (shape tells) | forced-colors mode | `e2e/playback-visual.spec.ts` "forced-colors: active …" |

## Invariance — Playback moves nothing that belongs to the document or the engine

Play, Pause, speed changes and Reset must leave all of this **byte-for-byte**
unchanged: the GraphDoc bytes, the `loop-revision/3` content digest, the undo /
redo stack, the viewport (pan / zoom), every edge's rendered `d` (visible + hit
area), and the **committed simulation result** — a choreographed Play commits
exactly what a plain `advance()`-only run of the same length does.

- `e2e/playback-fixture.spec.ts` "playing / pausing / resetting moves no
  GraphDoc / digest / undo / viewport / edge d — and no committed value"
- `e2e/playback-invariants.spec.ts` (whole file)

## Manual check in the app

```
Import  examples/playback-choreography.json

Play (or Step) at a slow speed →
  • ~60 dots leave Fan Source and travel their edges; a handful of Fan edges
    just tick their target value up with no dot (the 60-token budget)
  • Merge A / Merge B each send a labelled dot into Merge Pool
  • step 2: a bead rides Signal Source ┄▷ Signal Drain (the trigger)
  • once Gate Pool ≥ 1: a ring lands at Signal Drain on arrival (the activator) —
    it never travels
  • Feeder ┄▷ Tank shows "+5" toward Tank and "-2" away from it every step

Zoom out below ~45% → the dots disappear; the depart / path-pulse / arrive
  cues and the value updates still play in order
OS "reduce motion" → no travelling element at all; a static edge cue instead

Pause mid-travel → every dot freezes in place; Resume continues from there
Reset → every cue clears; step index and every Pool value return to the import

Export ▾ → JSON, New graph, Import it back → identical graph (routes kept)
```

There is intentionally **no oracle file** and **no `*.test.ts` value check** for
this graph — its engine behaviour is already covered by the verification
fixtures above; here the engine is only the thing the display layer must not
disturb.

---

# 6 — Early MMO progression (levels 1–15)

`mmo-progression.json` is the third **Templates ▾** entry and a connected
**play-economy** demo — not an XP curve but the whole loop: kill things, turn in
rewards, level up, buy gear, keep eating, pay to repair. Design:
[`docs/example-mmo-progression.md`](../docs/example-mmo-progression.md).

It is **generalised** — its own invented numbers and generic labels ("Starter
encounters", "Sell to vendor", "Repair (bill)"). No World-of-Warcraft names,
tuning values, or assets; it does not present itself as official or affiliated.

`mmo-progression.ko.json` is an **independent Korean-language derived copy** —
the same graph with only its display `label` / `resourceType` strings
translated (structure, positions, expressions, edges, `recommendedRunConfig`,
schema/version, and every run result are unchanged). It is **not** part of the
Templates ▾ entry or wired into the app in any way; it exists purely as a
Korean-labelled file to `Import` directly. The app does not switch a Templates
entry's underlying file by locale (see `docs/example-mmo-progression.md`
§EM14 for why, and the longer-term single-graph-plus-translation-overlay idea
that would replace this pattern).

## How to read it

A first-time reader follows the **top spine**, left to right:

```
Character creation → Starter · Lv 1–5 → Foothills · Lv 5–10 → Highlands · Lv 10–15 → Reached level 15
```

`Character creation` is an `onStart` Source that puts one token in `Active
character`; a `>= 1` activator on the Starter encounters Source then opens the
first zone. Each zone's combat / loot / level-up hangs directly **below** its
landmark; the shared economy is a band across the middle-bottom; the seven
reporting Registers sit in a small **corner block**, off the main path.

The Timeline opens on a curated **10-series** default
(`recommendedRunConfig.timelineSeries`): Level, Elapsed time, XP earned, Gold,
Deaths, Gear score, Water/Food consumed, Items sold, and the **Net gold check**
Register. The full accounting counters are still in the graph — one **`+N more`**
click away in the legend. The Monte-Carlo `tracked` list stays wide (for the
distributions); the two are independent.

The Canvas opens **edit-locked** (`recommendedRunConfig.canvasLocked: true`): the
layout is part of this example, so a first read can't nudge a node by accident.
Selecting nodes, the read-only Inspector, pan / zoom, the minimap, the Timeline
and the simulation all still work; the Controls lock toggle (🔒 → 🔓) unlocks
editing whenever you want it.

## What it wires

```
Character creation (onStart Source) → Active character Pool
   └─ `Active character ≥ 1` activator opens the Starter lane

three parallel ZONE LANES — exactly one live at a time (Level activators):
  Starter 1–5     ·  Foothills 5–10   ·  Highlands 10–15  (also needs Gear score ≥ 4)
each lane:
  Encounters Source → Encounter Pool → Combat Gate (probabilistic, 3 branches)
     ├─ win   → Victory Pool → Win amp Converter → Reward Pool + Combat wins + a loot roll
     ├─ fail  → shared Setbacks Pool  → Setback cost  (Gear wear, Elapsed time, Combat fails)
     └─ death → shared Deaths queue   → Death cost    (Deaths, Elapsed time, Gear wear)
  Loot roll Pool → Loot Gate (probabilistic drop_rate) → shared Drops Pool
  XP → `pull all` XP-meter Gate → Level Converter (rising xp_per_level: 10 / 19 / 27,
       so Level is a whole number in a single run) ; a per-step Training gold sink

shared economy:
  Reward Pool → Reward router (deterministic hunt : quest = 3 : 1)
     → Hunt / Quest payout Converters → XP (+ XP earned), Gold (+ Gold earned),
                                        Hunt XP / Quest XP counters
  Drops Pool → Loot dispatch (tee: Items looted + a sort token)
     → Loot category Gate (probabilistic 34 : 40 : 20 : 6 — one drop, one category)
     → Equip / Vendor / Consumable / Rare bucket Pools → four Converters
        → Items equipped / sold / consumed, Gear score, Gold (+ earned + Vendor revenue),
          Water / Food (+ bought)
  Water / Food upkeep Converters → Water / Food consumed
  Resupply Converter (Gold → Water/Food + bought + Resupply spend), opened by Water < 5
  Repair: a wear-clearing Converter + a gold-metering Converter, opened by Gear wear > 6
  Clock Source → Elapsed time  ;  Completion Source → Completion Pool → End (opened by Level ≥ 15)
  seven reporting Registers (loop-expr/1: + - * / and @id only)
```

Every "how much total" quantity is a **cumulative counter Pool** a flow only
adds to. Every balance Pool that is both filled and drained (`Gold`, `Water`,
`Food`) has paired `… earned|bought` / `… spent|consumed` counters fed the same
amounts, so these **accounting identities hold to a float epsilon at every
step** (`src/engine/mmo-progression.test.ts` asserts them across six seeds):

```
start Gold  + Gold earned  = final Gold + Repair spend + Resupply spend + Training spend
start Water + Water bought  = final Water + Water consumed
start Food  + Food bought   = final Food  + Food consumed
Items looted = Items equipped + Items sold + Items consumed + <held in the loot pipeline>
```

## Manual check in the app

This file carries a `recommendedRunConfig`, so **Import (or pick it from
Templates ▾) already fills the Monte Carlo dialog** with `200 × 150, base seed 1`
and the tracked Pools below, sets the Timeline's default 10 series, and opens the
Canvas edit-locked (unlock with the Controls 🔒 toggle).

```
Templates ▾ → "Early MMO progression (levels 1–15)"   (or Import examples/mmo-progression.json)

Live — seed 1, Play → the Character-creation Source fires once; from step 2 the
                      Starter lane runs. Level climbs 1 → 5 → 10 → 15; the active
                      lane hands off at each band boundary; the run ends the step
                      after Level hits 15
Live — Replay with the same seed → identical run; a different seed ends on a different step

Monte Carlo → dialog is pre-filled: runs 200, steps 150, base seed 1
  tracked: Elapsed time, Level, Deaths, Combat wins / fails, Water / Food consumed,
           Items looted / equipped / sold / consumed, Gold earned, Repair / Resupply /
           Training spend, Gold, Vendor revenue, Gear score, Quest XP, Hunt XP
  Run → DISTRIBUTION:
    • ≥ 95 % of runs reach Level 15 inside 150 steps; the median lands ~90–100
    • Elapsed time (time-to-15) shows a real p10–p90 spread — drop luck and combat
      variance move it
    • Gold trends near zero for much of the run (repair + resupply pressure), then
      loosens; Deaths and Combat fails climb faster in the higher lanes
  Export ▾ → Runs CSV / JSON
Reset and Run again with the same config → identical result
```

`src/engine/mmo-progression.test.ts` builds this graph from
`src/engine/mmo-progression.fixture.ts`, serialises it, and checks the committed
file matches. It pins structural invariants (node-kind coverage, six
probabilistic + two deterministic gates, activator state edges, `loop-expr/1`
Registers), seed reproducibility, the accounting identities above, and the
**reach-15 tuning window** (median 60–120 steps, ≥ 95 % inside 150) — **not**
exact values. There is **no `*.expected.json`**: the tuning numbers may be
re-picked without a "regression" as long as the identities and the window hold.

## Regenerating

```bash
GEN_MMO_PROGRESSION=1 npx vitest run src/engine/mmo-progression.test.ts
```
