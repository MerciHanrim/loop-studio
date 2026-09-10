# Example — "Gacha banner simulator" (non-frozen design doc — DRAFT)

**Status: design draft — for review.** No `loop-*/N` id, no `Frozen` marker;
this merges as *settled design, implementation pending* like
[`docs/example-mmo-progression.md`](example-mmo-progression.md) and
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md).

Prefix `GS`. The example is a **product demo / Templates entry** built on the
**current engine only** (Engine B probabilistic Gate + seeded RNG + Monte
Carlo + `loop-state/1` connections). It doubles as the concrete artifact that
**derives the external-table contract** (Appendix GSA) rather than that contract
being designed in the abstract first.

Sections: **GS0** why · **GS1** scope · **GS2** the model · **GS3** one pull ·
**GS4** parameters (the table) · **GS5** registers · **GS6** Monte Carlo ·
**GS7** not modelled · **GS8** naming / IP · **GS9** verification · **GS10**
slices · **GS11** open decisions · **GSA** appendix — external-table contract
(proposed).

---

## GS0. Why

A gacha banner is the archetypal **probability table + hard pity + Monte-Carlo**
question, and it is exactly the shape a reviewer (김형준, DCInside feedback)
called "가챠 시뮬레이터로 너무 매력적으로 보입니다": enter a rate table and a
ceiling rule, run it many times, read back the chance of the outcome you want,
the **average cost**, and the spread. Loop Studio already has every piece —
a probabilistic Gate for the categorical draw, `label` / `activator` state
connections for the pity counter, cumulative counter Pools for the tally, and
Monte Carlo for the distribution. Nothing new in the engine.

It is **not** a precision instrument or a test oracle. Its numbers are generic
placeholders (GS8). Its second job is to be the real Parameter table that the
data-import work (Appendix GSA, Track 2) is designed against — "표 연동을 먼저
추상적으로 설계하기보다, 실제 가챠 데이터 표 하나를 기준으로 계약을 도출."

## GS1. Scope

**In:**

- **One banner, one currency.** A wallet Pool drains a fixed cost per pull.
- **One pull per step.** N steps = N pulls on the banner.
- **A categorical rarity roll** — `SSR` / `SR` / `R` — by a **probabilistic
  Gate** whose branch weights are Parameters.
- **A hard pity** — a counted "pulls since the last SSR"; at `pity_cap` the pull
  is a guaranteed SSR and the counter resets.
- **Cumulative tallies** — total pulls, SSR / SR / R counts, currency spent.
- **Monte Carlo** — K seeded runs of the same N pulls → the distribution of
  "SSR obtained in N pulls", "pull index of the first SSR", "currency spent".

**Out (GS7 expands):** soft pity / a rising rate near the ceiling, the 50-50
featured-vs-standard split, rate-up, multi-banner, wishlist / selector, pity
carry-over between banners, dupes → dust, and any real game's names or numbers.

## GS2. The model — element → node

All nodes use only shipped kinds. Labels below are the English canonical (the
Template opens localized through the label overlay, GS10).

### GS2.1 The pull

| element | node(s) |
|---|---|
| currency on hand | `wallet` **Pool**, `initial` = `@budget` |
| cost of one pull | `pull_cost` **Parameter** |
| a pull happening | `wallet` → `pulls_made` **resource edge**, `flow` = `@pull_cost` amount, into `pulls_made` **Pool** (a cumulative counter — every pull ever, §GS2.4) |

One unit of "pull demand" per step is produced by a `pull_tick` **Source**
(`activation: automatic`, `flow` = `1`) into a transient `pull` **Pool** that is
fully consumed the same step by the routing in GS2.2. When `wallet <
@pull_cost` the pull edge is back-pressured and the run naturally stops pulling
(the banner "runs out of money") — a real readable end condition, not an error.

### GS2.2 The roll — pity-aware routing

A pull is resolved by **two mutually-exclusive passive routes**, each a Gate
gated by an `activator` state connection reading the `pity` Pool
(`loop-state/1`: an `activator` source must be a Pool; its test is `S[pity]`):

```
pull ──▶ roll_gate      (passive, activator  pity  <  @pity_cap − 1)   probabilistic
     └─▶ forced_ssr     (passive, activator  pity  >= @pity_cap − 1)   deterministic → SSR
```

- **`roll_gate`** — `distribution: 'probabilistic'`. Outgoing edges in `edge.id`
  order carry the branch weights `w_ssr` / `w_sr` / `w_r` (§GS4). Per §B4 the
  Gate moves **exactly one** branch per step, chosen by inverse-CDF sampling of
  `pⱼ = wⱼ / Σw`. So `p(SSR) = w_ssr / (w_ssr + w_sr + w_r)`.
- **`forced_ssr`** — a deterministic Gate with a single SSR out-edge. Active
  only on the pull that would be the `pity_cap`-th since the last SSR, so pull
  #`pity_cap` is a guaranteed SSR.
- The two activators partition the integer line, so exactly one route fires per
  step; the other evaluates and does nothing.

### GS2.3 Rarity tally

Each rarity branch (from either route) drains into a cumulative counter Pool:
`ssr_count`, `sr_count`, `r_count` (`activation: passive`, no capacity, `mode:
pullAny`). These only ever grow.

### GS2.4 The pity counter

`pity` **Pool** (`initial` 0), driven by two `label` state connections
(`loop-state/1`: a `label` is a declared numeric modifier on a Pool):

- **+1 each pull** — `pull_tick` (fires every step) → `pity`, `mode: label`,
  `expr` = `+ 1`.
- **reset on SSR** — `ssr_count` (fires on any step an SSR lands) → `pity`,
  `mode: label`, `expr` = *set to 0*.

> **GS11-D1 (open).** "Set a Pool to 0" is the one part not obviously in the
> shipped `label` `expr` grammar (§S6), which is built for *modifiers*
> (`+ n`, `- n`, `+ @src`). The implementation slice (GS10-2) must first
> confirm whether a reset is expressible today (e.g. `- @pity`, a self-read
> modifier — allowed?) and, if not, treat it as **signal**: a hard pity is a
> common real rule, and a minimal `label` addition (an absolute `= 0` /
> `-= @self` form) would be a small, well-scoped engine follow-up rather than a
> blocker. The example is designed so that this is the *only* engine question it
> raises.

## GS3. One pull cycle (step trace, `pity_cap` = 80)

1. `pull_tick` produces `1` into `pull`; `wallet` sends `@pull_cost` toward
   `pulls_made` (if it can afford it).
2. Routing: `pity = 12` ⇒ `roll_gate` active, `forced_ssr` inert.
3. `roll_gate` draws one branch — say `R` (p ≈ 0.943) ⇒ `r_count += 1`.
4. `label`s settle: `pity += 1` → `13`; no SSR ⇒ no reset.
5. …75 pulls later `pity = 79` ⇒ next step `forced_ssr` active ⇒ SSR guaranteed
   ⇒ `ssr_count += 1`, then the reset `label` drives `pity → 0`.

## GS4. Parameters — the table (GSA's driving artifact)

Placeholders for review; every one is a generic dial, none copied from a real
game (GS8). This table **is** the `key / label / value / unit / group` shape of
Appendix GSA.

| key | label | value | unit | group |
|---|---|---:|---|---|
| `budget` | Currency budget | 30000 | currency | Budget |
| `pull_cost` | Cost per pull | 300 | currency | Budget |
| `w_ssr` | SSR weight | 6 | weight | Rarity odds |
| `w_sr` | SR weight | 51 | weight | Rarity odds |
| `w_r` | R weight | 943 | weight | Rarity odds |
| `pity_cap` | Hard pity (guaranteed SSR) | 80 | pulls | Pity |

Weights are **relative** — `6 : 51 : 943` ⇒ `p(SSR) = 0.6 %`, `p(SR) = 5.1 %`,
`p(R) = 94.3 %`. Using weights (not probabilities) matches §B4 exactly and lets
a user retune one rarity without renormalizing the rest by hand. A `rate`
read-out is a Register (GS5), so the user still *sees* the percentages.

## GS5. Registers (derived read-outs only)

| register | expression | unit |
|---|---|---|
| `ssr_rate_shown` | `@w_ssr / (@w_ssr + @w_sr + @w_r)` | percent |
| `total_spent` | `@pulls_made * @pull_cost` | currency |
| `ssr_hit_rate` | `@ssr_count / @pulls_made` | percent |
| `spend_per_ssr` | `@total_spent / @ssr_count` | currency |
| `pity_progress` | `@pity / @pity_cap` | percent |

Registers store nothing and have no ports (`loop-expr/1`); `/0` before the first
pull just reads as invalid until `pulls_made > 0`, same as every other example.

## GS6. Monte Carlo

The whole point. `recommendedRunConfig` runs **N = 180 pulls**, **K = 2000
seeds**. The Timeline default surfaces `ssr_count`, `total_spent`,
`pity`. Monte Carlo then reports, per §B2 (`loop-mc/1`):

- **`ssr_count` at step N** — mean ≈ `N · p(SSR)` plus the pity floor, with its
  spread; "how many SSR should I expect from 180 pulls, and how unlucky can it
  get."
- **first-SSR pull index** — a derived Register `first_ssr_at` (min step where
  `ssr_count ≥ 1`); its distribution is the "pulls to your first SSR" curve
  every gacha player wants.
- **`total_spent`** — deterministic given N here (`= N · pull_cost` until the
  wallet empties), but with a smaller `budget` it becomes "chance you run out
  before your first / your Nth SSR."

## GS7. What Loop Studio deliberately does not model here

- **Soft pity** (a rate that ramps from ~74). Would be a `roll_gate` whose SSR
  weight reads a Register of `@pity` — see GS11-D2 (is `@register` a legal Gate
  weight, or only `@param`?). Deferred to keep GS2 to one clean question.
- **50-50 / featured vs standard**, **rate-up**, **guaranteed-featured after a
  lost 50-50** — a second probabilistic Gate on the SSR branch; a clean slice-2
  extension, not slice 1.
- **Multi-banner, wishlist / selector, pity carry-over, dupes → dust.**
- Any real title's names, art, or published rates.

## GS8. Naming & IP boundary

Rarities are the generic `SSR` / `SR` / `R`. The banner is "Standard banner".
Numbers in GS4 are round placeholders chosen to read clearly (0.6 % SSR, 80
pity), not lifted from any game. No character names, no set names, no logos —
same rule as the MMO example (§EM9).

## GS9. Verification (acceptance — not an oracle)

With GS4's values, `N = 180`, `K = 2000`:

1. **Pity ceiling holds** — in every run, the gap between consecutive SSRs (and
   from step 0 to the first SSR) is **≤ `pity_cap`**; at least some runs hit
   exactly `pity_cap` (the forced route fires).
2. **Rate is right** — over all K runs, the pooled `ssr_count` from the
   *non-forced* pulls is within a tolerance band of `p(SSR) · (non-forced
   pulls)`; `ssr_rate_shown` reads `0.6 %`.
3. **Accounting** — `total_spent == pulls_made · pull_cost` exactly every step;
   `ssr_count + sr_count + r_count == pulls_made` exactly (every pull lands in
   exactly one rarity).
4. **Determinism** — same seed ⇒ identical run (Engine A invariant, unchanged
   by the probabilistic Gate — the draw is keyed and pure, §B4.4).
5. **Reset** — Reset returns every counter and `pity` to step-0 values; the
   `loop-revision/*` digest is unaffected by running.

A reproducible fixture (`examples/gacha-simulator.fixture.ts` +
`gacha-simulator.expected.json`) pins 1–3 as an oracle, like the Coffee and
Engine-B fixtures.

## GS10. Slices

1. **Design** — this doc. Merges as *settled design, implementation pending*.
2. **Implementation** — `examples/gacha-simulator.json` (the graph), a `TEMPLATES`
   entry in `src/model/templates.ts` (5th bundled Template), localized labels in
   `src/i18n/templateLabels/{en,ko,ja}.ts`, `recommendedRunConfig` (N/K + the
   Timeline default), the verification fixture, and e2e (§GS9). This slice
   resolves **GS11-D1** (the pity-reset `label`) — the only engine question —
   one way or the other.
3. **External-table contract** — after slice 2 ships, promote Appendix GSA to
   its own design doc (`docs/data-import.md`), split **Track 2A** (import only)
   from **Track 2B** (bind + refresh), each its own PR. Not touched before then.
4. **Model explorability (Track 1)** — decided *after* looking at the running
   gacha screen: whether a ~4-tier model (`Budget → odds → roll → tally`) needs
   true hierarchical group collapse, or whether the existing Filter panel plus a
   user-assigned "tier" axis with a pinned base tier is enough. Its own doc when
   that call is made.

## GS11. Open decisions (for the review)

| id | question | lean |
|---|---|---|
| **GS11-D1** | Can a `label` reset `pity` to 0 in the shipped `expr` grammar? | Try `- @pity` (self-read modifier) in slice 2. If disallowed, a minimal absolute-`label` form is a small scoped engine follow-up — treat as roadmap signal, not a blocker. |
| **GS11-D2** | Is `@register` a legal probabilistic-Gate branch weight, or only `@param` / literal / `range` / `dice`? | Slice 1 avoids needing it (weights are Parameters). Answer feeds the soft-pity slice-2 extension. |
| **GS11-D3** | Forced-SSR as a **second route** (GS2.2), vs a single Gate whose SSR weight jumps to a huge number at `pity_cap`? | Two routes: the pull #`pity_cap` is then *exactly* guaranteed (a huge weight is only ~guaranteed) and the intent reads on the canvas. |
| **GS11-D4** | N / K / budget defaults for `recommendedRunConfig`. | `N = 180`, `K = 2000`, `budget` large enough that the wallet never empties in the default run (so the SSR-count distribution is the headline, not a spend cliff). Tune in slice 2. |

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
