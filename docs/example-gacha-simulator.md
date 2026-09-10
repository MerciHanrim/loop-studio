# Example — "Gacha banner simulator" (non-frozen design doc — DRAFT)

**Status: design draft — for review.** No `loop-*/N` id, no `Frozen` marker;
this merges as *settled design, implementation pending* like
[`docs/example-mmo-progression.md`](example-mmo-progression.md) and
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md).

Prefix `GS`. The example is a **product demo / Templates entry** built on
**shipped engine primitives** — Engine B probabilistic Gate + seeded RNG +
Monte Carlo + `loop-state/1` connections. It doubles as the concrete artifact
that **derives the external-table contract** (Appendix GSA) rather than that
contract being designed in the abstract first.

> **v1 does not model a hard pity.** A guaranteed-SSR ceiling was probed against
> the current primitives and does **not** express with correct timing — see
> **GS11-D1** (proved) and **GS7**. v1 is *pull-until-first-SSR*; the ceiling is
> a candidate engine follow-up, evaluated on its own.

Sections: **GS0** why · **GS1** scope · **GS2** the model · **GS3** one pull ·
**GS4** parameters (the table) · **GS5** registers · **GS6** Monte Carlo ·
**GS7** not modelled · **GS8** naming / IP · **GS9** verification · **GS10**
slices · **GS11** decisions · **GSA** appendix — external-table contract
(proposed).

---

## GS0. Why

**This example simulates *pulling until your first SSR*** — not a single pull.
That framing is what makes the cost distribution and Monte Carlo compelling:
"how many pulls, and how much currency, until I hit an SSR — and how wide is
the spread?" (Hanrim's call; a single-pull demo has almost nothing to run.)

A gacha banner is the archetypal **probability table + Monte-Carlo** question,
exactly the shape a reviewer (김형준, DCInside feedback) called "가챠 시뮬레이터로
너무 매력적으로 보입니다": enter a rarity table, run it many times, read back the
chance of the outcome you want, the **average cost**, and the spread. Loop
Studio has the pieces on the shelf — a probabilistic Gate for the categorical
draw, cumulative counter Pools for the tally, an `activator`-gated `End` for the
stop condition, and Monte Carlo for the distribution.

It is **not** a precision instrument or a test oracle. Its numbers are generic
placeholders (GS8). Its second job is to be the real Parameter table that the
data-import work (Appendix GSA, Track 2) is designed against — "표 연동을 먼저
추상적으로 설계하기보다, 실제 가챠 데이터 표 하나를 기준으로 계약을 도출."

## GS1. Scope

**In:**

- **One banner, one currency.** A wallet Pool drains a fixed cost per pull.
- **One pull per step, until the first SSR** — the run pulls once per step and
  an `activator`-gated `End` stops it the step after `ssr_count` reaches 1, so a
  run's length *is* its pulls-to-first-SSR.
- **A categorical rarity roll** — `SSR` / `SR` / `R` — by a **probabilistic
  Gate** whose branch weights are Parameters.
- **Cumulative tallies** — pulls made, SSR / SR / R counts, currency spent.
- **Monte Carlo** — K seeded runs → the distribution of **pulls to the first
  SSR** (the geometric curve) and **currency spent to the first SSR**, plus the
  chance of running out of budget first.

**Out (GS7 expands):** a **hard pity / guaranteed-SSR ceiling** (not expressible
today — GS11-D1), soft pity, the 50-50 featured-vs-standard split, rate-up,
multi-banner, wishlist / selector, pity carry-over, dupes → dust, and any real
game's names or numbers.

## GS2. The model — element → node

All nodes use only shipped kinds. Labels below are the English canonical (the
Template opens localized through the label overlay, GS10).

### GS2.1 The pull

| element | node(s) |
|---|---|
| currency on hand | `wallet` **Pool**, `initial` = `@budget` |
| cost of one pull | `pull_cost` **Parameter** |
| currency leaving per pull | `wallet` → `spent` **resource edge**, `flow` = `@pull_cost`, into a `spent` **Drain** (currency drained; the wallet only falls) |
| pulls counted | `pull` → `pulls_made` **resource edge**, `flow` = `1`, into `pulls_made` **Pool** (a cumulative counter — every pull ever) |

One unit of "pull demand" per step is produced by a `pull_tick` **Source**
(`activation: automatic`, `flow` = `1`) into a transient `pull` **Pool**. Each
step that pull unit is consumed once — it feeds `roll_gate` (GS2.2), ticks
`pulls_made` by `1`, and gates the `wallet → spent` drain of `@pull_cost`. When
`wallet < @pull_cost` the drain is back-pressured and the run naturally stops
pulling (the banner "runs out of money") — a real readable end condition, not an
error. `pulls_made` therefore counts *pulls*, not currency, and
`total_spent` (GS5) is `@pulls_made * @pull_cost`.

### GS2.2 The roll

`roll_gate` — a **`distribution: 'probabilistic'` Gate**, `activation: automatic`
(one firing per step, no trigger needed). Its outgoing edges in `edge.id` order
carry the branch weights `w_ssr` / `w_sr` / `w_r` (§GS4). Per §B4 the Gate moves
**exactly one** branch per step, chosen by inverse-CDF sampling of
`pⱼ = wⱼ / Σw`. So `p(SSR) = w_ssr / (w_ssr + w_sr + w_r)`. There is no pity
route — see GS7.

### GS2.3 Rarity tally

Each rarity branch drains into a cumulative counter Pool: `ssr_count`,
`sr_count`, `r_count` (`activation: passive`, no capacity, `mode: pullAny`).
These only ever grow.

### GS2.4 Stop at the first SSR

An **`End` node** `got_ssr` with an `activator` state connection `ssr_count`
→ `got_ssr`, `expr` `>= 1`. Per `loop-state/1` I10-S a firing End ends the run;
the activator reads `S[ssr_count]` (the previous step's commit), so the run ends
**the step after** the SSR lands. Every counter is frozen at that point, and
Monte Carlo records the step index and `total_spent`.

`pulls_made` is the cumulative pull counter (the `pull → pulls_made` edge,
`flow` = `1`, §GS2.1). With "stop at first SSR" there is only ever one SSR, so no
pity counter or reset is needed in v1 — which is what keeps v1 inside the
shipped primitives (GS11-D1).

## GS3. One pull cycle (step trace)

1. `pull_tick` produces `1` into `pull`; the pull unit ticks `pulls_made` by `1`
   and drains `@pull_cost` from `wallet` (if it can afford it).
2. `roll_gate` (probabilistic) draws exactly one branch — say `R` (p ≈ 0.943)
   ⇒ `r_count += 1`.
3. Commit. `got_ssr`'s activator reads `S[ssr_count]` = `0` ⇒ run continues.
4. …some pulls later a draw lands `SSR` ⇒ `ssr_count` = `1`.
5. **Next step:** `got_ssr`'s activator reads `S[ssr_count]` = `1` ⇒ `got_ssr`
   fires ⇒ run ends. The step index and `total_spent` are the run's outputs.

## GS4. Parameters — the table (GSA's driving artifact)

Placeholders for review; every one is a generic dial, none copied from a real
game (GS8). This table **is** the `key / label / value / unit / group` shape of
Appendix GSA.

| key | label | value | unit | group |
|---|---|---:|---|---|
| `budget` | Currency budget | 60000 | currency | Budget |
| `pull_cost` | Cost per pull | 300 | currency | Budget |
| `w_ssr` | SSR weight | 6 | weight | Rarity odds |
| `w_sr` | SR weight | 51 | weight | Rarity odds |
| `w_r` | R weight | 943 | weight | Rarity odds |

Weights are **relative** — `6 : 51 : 943` ⇒ `p(SSR) = 0.6 %`, `p(SR) = 5.1 %`,
`p(R) = 94.3 %`. Using weights (not probabilities) matches §B4 exactly and lets
a user retune one rarity without renormalizing the rest by hand. A `rate`
read-out is a Register (GS5), so the user still *sees* the percentages.
`budget` is sized so a run can go ~200 pulls before the wallet empties (the
mean pulls-to-SSR at 0.6 % is ~166), so "run out of budget" is a real but not
routine outcome. `pity_cap` returns with the hard-pity follow-up (GS7).

## GS5. Registers (derived read-outs only)

| register | expression | unit |
|---|---|---|
| `ssr_rate_shown` | `@w_ssr / (@w_ssr + @w_sr + @w_r)` | percent |
| `sr_rate_shown` | `@w_sr / (@w_ssr + @w_sr + @w_r)` | percent |
| `total_spent` | `@pulls_made * @pull_cost` | currency |
| `budget_left` | `@budget - @total_spent` | currency |
| `pulls_so_far` | `@pulls_made` | pulls |

Registers store nothing and have no ports (`loop-expr/1`); `budget - spent`
reads fine from step 0. `pulls_so_far` is a plain mirror of the counter Pool so
the "pulls to first SSR" value is a named Timeline series and a Monte-Carlo
output.

## GS6. Monte Carlo

The whole point. `recommendedRunConfig` sets the horizon long enough that almost
every run reaches its first SSR before it ends (`N ≈ 260`), and **K = 2000
seeds**. The Timeline default surfaces `pulls_so_far`, `total_spent`,
`ssr_count`. Because each run **ends on the first SSR** (GS2.4), the final
committed frame of every run carries exactly what matters, and Monte Carlo
aggregates it per §B2 (`loop-mc/1`):

- **pulls to the first SSR** — the final `pulls_so_far` per run. Its
  distribution is the geometric "how many pulls until I hit SSR" curve, with the
  mean near `1 / p(SSR) ≈ 166` and a long tail.
- **currency spent to the first SSR** — the final `total_spent` (`= pulls ·
  pull_cost`); the same shape in money.
- **ran out of budget first** — the fraction of runs whose `wallet` empties
  (pulls stop, `got_ssr` never fires) before an SSR. With GS4's `budget = 60000`
  and cost `300` (~200 pulls) that is a real minority outcome, the "bad luck"
  tail made visible.

## GS7. What Loop Studio deliberately does not model here

- **A hard pity / guaranteed-SSR ceiling.** **Not expressible with the current
  primitives** — probed and confirmed, **GS11-D1**. A counter that increments
  per pull, *resets on SSR*, and forces the routing on the ceiling pull needs
  (a) a **conditional** `label` (today's `label` applies every step,
  unconditionally — a self-reset just pins the counter) and (b) the reset to be
  visible to the *next* step's routing (a `trigger → Drain` reset lands one step
  late and double-fires the forced route). Left out of v1; a candidate engine
  follow-up, designed on its own, never bolted on to ship this example.
- **Soft pity** (a rising SSR rate near a threshold) — would need a Gate branch
  weight that reads a Register of the pity counter (GS11-D2), plus the same
  reset problem; deferred with the hard pity.
- **50-50 / featured vs standard**, **rate-up**, **guaranteed-featured after a
  lost 50-50** — a second probabilistic Gate on the SSR branch; a clean later
  extension.
- **Multi-banner, wishlist / selector, pity carry-over, dupes → dust.**
- Any real title's names, art, or published rates.

## GS8. Naming & IP boundary

Rarities are the generic `SSR` / `SR` / `R`. The banner is "Standard banner".
Numbers in GS4 are round placeholders chosen to read clearly (0.6 % SSR), not
lifted from any game. No character names, no set names, no logos — same rule as
the MMO example (§EM9).

## GS9. Verification (acceptance — not an oracle)

Implementation is accepted only when all of these hold. `K = 2000` seeds,
horizon `N ≈ 260` (GS6).

1. **One result per pull** — every step that pulls moves **exactly one**
   `roll_gate` branch; `ssr_count + sr_count + r_count == pulls_made` exactly at
   every step of every run.
2. **Stops on the first SSR** — the run ends the step after `ssr_count` first
   reaches `1`; no run records a second SSR; no counter changes after the end.
3. **Determinism** — same seed ⇒ byte-identical run, including the draw sequence
   (§B4.4 — the draw is keyed and pure); Reset returns every value to step 0 and
   never moves the `loop-revision/*` digest.
4. **Rate is right** — pooled over all K runs, the SSR / SR / R shares are
   within a tolerance band of `0.6 % / 5.1 % / 94.3 %`; `ssr_rate_shown` reads
   `0.6 %`, `sr_rate_shown` `5.1 %`.
5. **Cost is right** — `total_spent == pulls_made · pull_cost` exactly every
   step; `budget_left == budget − total_spent`.
6. **The outputs read** — pulls-to-SSR and spend-to-SSR are named Timeline
   series and appear in the Monte-Carlo distribution; the "ran out of budget"
   fraction is reported.
7. **Geometric shape** — the mean pulls-to-SSR is `1 / p(SSR) ± tolerance`
   (`≈ 166`); the distribution has the expected right tail.

*(Not applicable in v1 — return with the hard pity, GS7: "the SSR gap never
exceeds the ceiling", "the ceiling pull is a guaranteed SSR", "pity is exactly 0
after every SSR, natural or forced", "pity only increments on a non-SSR pull".)*

A reproducible fixture (`examples/gacha-simulator.fixture.ts` +
`gacha-simulator.expected.json`) pins 1–5 as an oracle, like the Coffee and
Engine-B fixtures.

## GS10. Slices

1. **Design** — this doc. Merges as *settled design, implementation pending*.
2. **Implementation** — `examples/gacha-simulator.json` (the graph), a `TEMPLATES`
   entry in `src/model/templates.ts` (5th bundled Template), localized labels in
   `src/i18n/templateLabels/{en,ko,ja}.ts`, `recommendedRunConfig` (horizon / K
   + the Timeline default), the verification fixture, and e2e (§GS9). No engine
   change — v1 is entirely shipped primitives (GS11-D1).
3. **Hard-pity engine follow-up** — its own design pass: a **conditional
   `label`** (a `label` edge that only applies while an `activator` condition
   holds) *and* a same-step-visible reset story, so the ceiling pull's routing
   sees the post-SSR counter. Only then does the pity version of GS9 come back.
   Not part of slices 1–2.
4. **External-table contract** — after slice 2 ships, promote Appendix GSA to
   its own design doc (`docs/data-import.md`), split **Track 2A** (import only)
   from **Track 2B** (bind + refresh), each its own PR. Not touched before then.
5. **Model explorability (Track 1)** — decided *after* looking at the running
   gacha screen: whether a ~4-tier model (`Budget → odds → roll → tally`) needs
   true hierarchical group collapse, or whether the existing Filter panel plus a
   user-assigned "tier" axis with a pinned base tier is enough. Its own doc when
   that call is made.

## GS11. Decisions

### GS11-D1 — a hard pity is NOT expressible with the current primitives (**proved**)

A guaranteed-SSR ceiling needs a `pity` counter that **increments per pull,
resets on SSR, and forces the routing on the ceiling pull**. Probed directly
against the engine — the two cases run as
[`src/engine/gacha-pity-timing.probe.test.ts`](../src/engine/gacha-pity-timing.probe.test.ts),
kept as a tripwire so a future engine change that changes either result flags
the GS10-3 follow-up:

- **`label` is unconditional.** `step.ts` applies every `label` edge in Phase 0
  every step, ungated by "did the source fire". A `pity → pity` self-`label`
  with `-S` therefore subtracts the pity value *every step* — the counter can
  never climb past the single-step increment (`[0, 1, 1, 1, …]`), so a
  conditional reset is impossible. There is no `label` form that means "set to 0
  only when …".
- **A `trigger → Drain` reset lands one step late.** `pity → pity_drain`
  (passive Drain, pull-all), triggered by the SSR branch: the SSR fires at step
  *t*, the trigger delivers at *t+1*, the drain empties `pity` at *t+1* — but
  the routing at *t+1* has already read `S[pity]` committed at *t* (still at the
  ceiling). The probe fires the "forced SSR" route on **two consecutive steps**
  (`ceiling fired at steps: [6, 7]` for `cap = 5`) — i.e. **two guaranteed SSRs
  at the ceiling instead of one**.

**Conclusion:** v1 drops the hard pity and simulates *pull-until-first-SSR*
(GS0 / GS2.4), which needs no counter reset and stays entirely within shipped
primitives. The hard pity returns only with the GS10-3 engine follow-up (a
conditional `label` + a same-step reset). The phrases "current engine only" and
"not a blocker" are removed from this doc for the pity.

### GS11-D2 — `@register` as a Gate branch weight? (open, deferred)

Is `@register` legal as a probabilistic-Gate branch weight, or only `@param` /
literal / `range` / `dice`? v1 does not need it (weights are Parameters). The
answer gates the soft-pity extension (GS7).

---

## GSA. Appendix — external-table contract (**proposed**, not implemented here)

Derived from GS4. **Status: proposed.** This appendix is a sketch to be
*validated by building GS10-2*, then promoted to its own doc. Nothing in it is
built as part of this example.

### GSA0. Why snapshot, not a live connection

Loop Studio is local-first, account-less, and its runs are reproducible. A live
Google Sheets binding would pull in OAuth, private-sheet access, network
failure, and "the source changed mid-analysis" reproducibility questions all at
once. **Import a snapshot + refresh on demand** keeps every one of those out of
the execution path. Direct Sheets connection, if ever, is strictly after Track
2B.

### GSA1. Track 2A — import only (nearly schema-free)

- **Input:** a CSV file upload, or a range copied from a spreadsheet and pasted.
- **Columns:** `key`, `label`, `value`, `unit`, `group`. `key` + `value`
  required; `label` defaults to `key`; `unit` / `group` optional.
- **Effect:** each row with a finite numeric `value` becomes **one Parameter** —
  a fresh Loop-Studio node id is generated (see GSA3); `data.label` = `label`,
  `data.value` = `value`; `unit` → the advisory display unit; `group` → optional
  frame (GSA4).
- **Validation before anything changes** (a preview step, refuse on error):
  duplicate `key`, missing `key` / `value`, non-numeric / non-finite `value`,
  `key` outside an id-safe charset.
- **After import it is an ordinary model.** No source link, no `lastImported`,
  no refresh. This barely touches `serialize()` or the digest — the Parameters
  are just Parameters.

### GSA2. Track 2B — bind & refresh (a real new stored schema)

- A bound Parameter gains **`sourceId`** (which import), **`sourceKey`** (the
  row's `key`), **`lastImportedValue`** (the value at the last import). This is
  a genuine schema addition — it needs a `serialize()` allowlist entry and a
  `loop-revision/N` decision.
- **Re-import** → per `sourceKey` a three-way:
  - `base` = `lastImportedValue`
  - `local` = the Parameter's current `data.value`
  - `incoming` = the new row's `value`
- **Auto-apply** where there is no conflict (`local == base`, or `incoming ==
  base`, or `local == incoming`). **User resolves** only true conflicts
  (`local ≠ base ∧ incoming ≠ base ∧ local ≠ incoming`) — reuse the Project-
  revision three-way UI, not a new one.
- **Only the materialized `data.value` has simulation meaning and enters the
  digest.** `sourceId` / `sourceKey` / `lastImportedValue` are provenance:
  serialized, round-tripped, shown in the Inspector, but **excluded from
  execution semantics and the engine digest** (the `route` / `waypoints`
  cosmetic-field precedent). A source *URL*, if added, is provenance too.

### GSA3. `sourceKey` is not the node id

The external `key` (`gacha_ssr_rate`) is **user data**; a Loop Studio node id is
an **internal identifier**. They are kept separate: import generates the node id
its own way, matching on `sourceKey`. This means the user can rename a Parameter
freely, restructure the graph, and re-import still binds correctly; and two
different sheets can carry the same `key` for different imports without a
collision.

### GSA4. `group` → frame is optional

Auto-creating a frame per distinct `group` value is offered **as a checkbox in
the import preview**, default *ask*. A user often wants the imported Parameters
dropped into an **existing** frame instead, or none.

### GSA5. Deliberately out of this contract

- Real-time Sheets / Excel connection.
- A `value` that is an **expression** → a Register (per-level combat formulas,
  2-D stat tables). v1 is numeric `value` → Parameter only; a flattened key
  (`player_hp_lv10`) is the supported shape for now.
- Writing back to the source.
- Binding to anything other than a Parameter.
