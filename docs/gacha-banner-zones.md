# 3-zone gacha Template — banner rules & Monte Carlo comparison (design doc)

**Status: design draft — for review.** GS10 slice 6, the public Template
named throughout `docs/example-gacha-simulator.md` (GS's scope-revision
section) and `docs/parameter-activator.md` §PA0/§PA8 as the reason
`@parameter` activator support (`loop-state/4`, PR #187→#188→#189, all
MERGED) was built. This document fixes the three zones' odds / cost / pity /
pickup-guarantee rules and the Monte Carlo comparison metrics **before any
implementation**. Per explicit instruction, this PR stops at design
confirmation; the Template's graph, Template-catalogue entry, and tests are
their own separate, later PR — exactly the design → implementation split
already used for CSU (`docs/conditional-state-update.md` → PR #181),
label-timing (`docs/label-timing-authoring.md` → PR #182/#183), and
`@parameter` itself (`docs/parameter-activator.md` → PR #188/#189).

Prefix `GZ`. Sections: **GZ0** why a fixed-budget economy, not "first SSR" ·
**GZ1** scope · **GZ2** the three zones (fixed names/rules) · **GZ3**
structural decisions (one graph, per-zone currency, frames) · **GZ4** engine
mapping — pity · **GZ5** engine mapping — pickup guarantee · **GZ6**
Parameter tables · **GZ7** Monte Carlo comparison metrics · **GZ8**
verification · **GZ9** decisions · **GZ10** slices / work order.

---

## GZ0. Why a fixed-budget economy, not "first SSR"

`docs/example-gacha-simulator.md` (GS0) asks a single-banner question: *how
many pulls until the first SSR, or does the budget run out first?* That
framing makes a great single-banner narrative, but it is the wrong question
for a **three-way comparison**. "Pulls to first SSR" is itself the metric in
GS0's story; here the question is *"given the same spend, how do three
different rule sets change what a player actually gets?"* — which needs a
**fixed budget spent in full**, not a run that stops the moment a Pool first
crosses a threshold.

**Decision (GZ-D1): each zone spends its entire configured budget every run**
(no early stop at first SSR). Monte Carlo then reports, per zone, over that
fixed spend: how many SSRs landed, how many of Zone 3's SSRs were the
pickup, and (as a secondary, still-useful readout) how many pulls it took to
land the *first* one. This keeps GS0's original question available as one of
several readouts (GZ7) rather than the terminating condition, and it is the
only framing under which "General/Free has no pity" vs "Premium Standard has
an 80-pull ceiling" is visible as a **distribution shift**, not just a
different stopping time.

This is a deliberate divergence from GS0/GS2.3's End-node design (`got_ssr` /
`budget_exhausted`), not an oversight — flagged here for explicit review
since it changes the narrative GS0 established for the single-banner case.

## GZ1. Scope

**In:**

- Three zones in **one bundled Template** (not three separate Templates —
  GZ3), each a self-contained sub-graph with its own currency Pool, its own
  probability table, and (Zones 2–3) its own tunable hard-pity ceiling.
- Zone 3 additionally has a **pickup-guarantee** mechanic: within an SSR
  result, a probabilistic pickup/standard split, with a guarantee that the
  SSR immediately after a non-pickup SSR is pickup.
- A shared, neutral **comparison frame** with cross-zone Registers (cost per
  SSR, cost per pickup, realized pickup share) computed from the three
  zones' own Pools via `@ref` expressions (already-shipped
  `docs/register-expression-authoring.md`).
- A fixed Monte Carlo tracked-Pool set and comparison-Register set, locked in
  this document (GZ7).
- Generic placeholder numbers only (GS8's naming/IP boundary applies
  identically here — no real banner's rates, costs, or names).

**Out (this PR):** the actual graph JSON, the Template-catalogue entry, KO/JA
label overlays, engine fixtures, e2e coverage, and any new engine primitive.
**No new `loop-state/N` or `loop-revision/N` is introduced** — GZ4/GZ5 use
only `loop-model/2` (`@param` resource flow), `loop-state/3` (CSU afterPull
labels), `loop-state/4` (`@parameter` activators), Engine B probabilistic
Gates, `loop-mc/1` Monte Carlo, `loop-revision/5` frames, and RXA Register
expressions — all shipped. Also out: `pity_carry_group` (shared cross-zone
pity, explicitly deferred by `docs/parameter-activator.md` §PA8), soft pity,
duplicate-to-dust, and any live external data.

## GZ2. The three zones (names and rules fixed by product decision)

Verbatim from the 2026-09-10 product decision (`docs/example-gacha-simulator.md`
scope-revision section), restated here as the binding contract for this
Template:

| EN UI name (canonical) | KO | currency | rules |
|---|---|---|---|
| **General / Free** | 일반(무료) | free tickets | base rates, **no pity** (GZ-D2) |
| **Premium Standard** | 프리미엄 상시 | paid (own Pool, GZ-D3) | standing SSR pool, own tunable pity |
| **Premium Pickup** | 프리미엄 픽업 | paid (own Pool, GZ-D3) | SSR rate + pickup rate + pity + pickup guarantee |

"Premium Standard" is the primary UI name; "Permanent" may appear only as
secondary prose, never "Standing", per the original product decision.

**Decision (GZ-D2): General/Free has no pity at all** — it is GS0's original
model unchanged (a pure categorical roll, no ceiling), kept as the
comparison's baseline/control. The alternative (a very generous but present
ceiling) was considered and rejected: it would still need a Parameter and a
pair of activators for a mechanic that contributes nothing to the
comparison's story (a baseline should be the *simplest* zone, not a
degenerate case of the others).

## GZ3. Structural decisions

### GZ3.1 One Template, one graph, three sub-graphs

The three zones are **not** three separate Template files. They are three
independent, non-interacting sub-graphs inside **one** `GraphDoc`, visually
separated with `loop-revision/5` frames (shipped, `docs/large-graph-...`
Slice 5):

- General/Free — neutral / green frame.
- Premium Standard — violet frame.
- Premium Pickup — accent frame.
- The cross-zone comparison Registers (GZ7) — a separate **neutral** frame,
  not colour-matched to any zone (it is shared output, not a zone).

This lets a **single** seeded run or Monte Carlo pass simulate all three
zones simultaneously and produce three independent distributions in the same
result — no "Scenario Compare" feature is needed (that feature was deferred
after v0.7.0 and remains out of scope; nothing here depends on it). Frames
are cosmetic-only (`loop-revision/5`, no engine meaning), so this costs
nothing beyond visual organisation.

### GZ3.2 Zones do not share currency (Decision GZ-D3)

Even though Premium Standard and Premium Pickup are both "paid" in the
product's flavour text, each zone gets its **own** currency Pool
(`wallet_standard`, `wallet_pickup`) and its own budget Parameter — they do
NOT draw from one shared `wallet_gems` Pool. Sharing a wallet would couple
the two zones' outcomes (spending in one changes what's left for the other),
which would confound the very comparison this Template exists to produce.
Each zone's Monte Carlo distribution must be a clean, independent
measurement of that zone's own rule set under its own fixed budget. This
mirrors `docs/parameter-activator.md` §PA8's already-reviewed "separate pity
Pools per zone" decision — same reasoning, extended to currency.

### GZ3.3 Reused per-zone economy shape (GS2.1)

Each zone reuses GS2.1's funding shape exactly: an `onStart` Source funds the
zone's wallet Pool via `flow = @budget_<zone>`; a `pullAll` Converter
(`buy_pull_<zone>`) charges `@pull_cost_<zone>` and atomically produces one
roll token, one `pulls_made_<zone>` unit, and `@pull_cost_<zone>` into
`spent_total_<zone>`. Per **GZ-D1**, there is no activator disabling
`buy_pull_<zone>` after a hit — it keeps pulling until the wallet can no
longer afford the next pull (the existing `budget_exhausted`-style
Pool-value activator, `wallet_<zone> < @pull_cost_<zone>`, gates it off, with
no upstream dependency on any roll result).

## GZ4. Engine mapping — the tunable pity ceiling (Zones 2–3)

Directly the mechanism `docs/parameter-activator.md` §PA8 already reviewed
and approved as feasible, generalising GS10-3's fixed-literal proof
(`src/engine/gacha-hard-pity.test.ts`) with a per-zone Parameter in place of
the literal `HARD_PITY`:

- `pity_<zone>` — a Pool, one per zone, starts at `0`.
- `hard_pity_<zone>` — a Parameter, one per zone (Zone 1 has neither).
- `roll_gate_<zone>` (probabilistic, the zone's own SSR/SR/R weights) and
  `forced_ssr_<zone>` (deterministic, one target: the zone's SSR result path)
  are BOTH fed by `wallet_<zone>`, gated by a mutually-exclusive pair of
  activators on `pity_<zone>`:
  - `pity_<zone> → roll_gate_<zone>`, `< @hard_pity_<zone> - 1`
  - `pity_<zone> → forced_ssr_<zone>`, `>= @hard_pity_<zone> - 1`

  (the `- 1` is GS11-D1/CSU9-D2's off-by-one convention: `pity` counts
  consecutive non-SSR pulls, so an N-pull ceiling forces on the pull where
  `pity` would otherwise reach N, i.e. compares against `N - 1`; this is
  exactly what the Inspector's live-preview offset UI, PR #189, exists to
  make legible to whoever tunes `hard_pity_<zone>`).
- Every SSR result (natural, from `roll_gate_<zone>`, or forced, from
  `forced_ssr_<zone>`) resets `pity_<zone>` to `0` the SAME step via a CSU
  `afterPull` `label` (`loop-state/3`, `timing: 'afterPull', when:
  'source-fired'`, `expr: '=0'`); every non-SSR result increments it by `1`
  the same way (`expr: '+1'`) — identical to `gacha-hard-pity.test.ts`'s
  `l_reset_natural` / `l_reset_forced` / `l_inc_sr` / `l_inc_r` edges, just
  with `<zone>`-suffixed node ids and a Parameter ceiling instead of a
  literal.

Zone 1 (General/Free) has no `pity_free` Pool and no `hard_pity_free`
Parameter at all — it is a single probabilistic `roll_gate_free`, nothing
else (GZ-D2).

## GZ5. Engine mapping — the pickup guarantee (Zone 3 only)

Not covered by `docs/parameter-activator.md` (which only reviewed the pity
ceiling) — this is this document's own contribution. It reuses the exact
same "two mutually-exclusive Gates, gated by activators on a state Pool"
shape as GZ4, one level downstream of the SSR result:

- `missed_pickup_pickup` — a Pool, values `0` or `1`, starts at `0` (an
  SSR's first-ever pickup roll is a fair, un-guaranteed split — **Decision
  GZ-D4**, stated explicitly since it is a real modelling choice, not the
  only reasonable one).
- Every SSR result (natural or forced, same as GZ4) routes its one-unit
  token into `pickup_split_pickup`'s **input buffer** — the resource edges
  from `ssr_hit_pickup`/`forced_ssr_pickup` target a relay Pool
  `ssr_landed_pickup` (mirroring GS2.3's `completion_pulse` relay pattern:
  a router's own output can't itself be gated by activator, only its
  target's *next* hop can), which then funds BOTH of:
  - `guarantee_gate_pickup` — deterministic, single target `pickup_count`,
    activator `missed_pickup_pickup → guarantee_gate_pickup`, `>= 1`.
  - `normal_split_gate_pickup` — probabilistic, two targets
    (`pickup_count` weight `@w_pickup`, `standard_count` weight
    `@w_standard`), activator `missed_pickup_pickup → normal_split_gate_pickup`,
    `< 1`.

  Exactly one of the two is enabled per step (the activators are exact
  complements over `{0, 1}`), exactly as `roll_gate`/`forced_ssr` are in
  GZ4 — this is the SAME proven pattern, not a new one.
- `missed_pickup_pickup` updates the SAME step the split resolves, via CSU
  `afterPull` labels sourced from `pickup_count`/`standard_count`/
  `guarantee_gate_pickup`:
  - a `standard_count` hit sets `missed_pickup_pickup = 1` (a miss just
    happened; the next SSR is now owed a guarantee);
  - a `pickup_count` hit (from EITHER `normal_split_gate_pickup`'s own
    probabilistic branch OR `guarantee_gate_pickup`'s forced route) sets
    `missed_pickup_pickup = 0` (the debt is paid).

This composes independently with GZ4's pity ceiling: whichever gate produces
the SSR (natural `roll_gate_pickup` or forced `forced_ssr_pickup`) is
upstream of, and irrelevant to, which pickup-split path fires — the pickup
mechanic only cares that an SSR happened, not how.

## GZ6. Parameter tables (generic placeholders, GS8 IP boundary applies)

| zone | key | value | notes |
|---|---|---:|---|
| General/Free | `budget_free` | 60000 | reuses GS4's exact numbers |
| General/Free | `pull_cost_free` | 300 | `M = 200` pulls |
| General/Free | `w_ssr_free:w_sr_free:w_r_free` | 6:51:943 | SSR 0.6 % |
| Premium Standard | `budget_standard` | 60000 | same scale, own currency |
| Premium Standard | `pull_cost_standard` | 300 | `M = 200` pulls |
| Premium Standard | `w_ssr_standard:w_sr_standard:w_r_standard` | 10:90:900 | SSR 1.0 % |
| Premium Standard | `hard_pity_standard` | 80 | ceiling well inside `M = 200`, so its effect on the tail is visible in Monte Carlo |
| Premium Pickup | `budget_pickup` | 60000 | same scale, own currency |
| Premium Pickup | `pull_cost_pickup` | 300 | `M = 200` pulls |
| Premium Pickup | `w_ssr_pickup:w_sr_pickup:w_r_pickup` | 10:90:900 | SSR 1.0 %, same as Standard (isolates the pickup mechanic's effect) |
| Premium Pickup | `hard_pity_pickup` | 80 | same ceiling as Standard (same reason) |
| Premium Pickup | `w_pickup:w_standard` | 50:50 | fair split before any guarantee applies |

Premium Standard and Premium Pickup deliberately share identical SSR
rate/cost/ceiling numbers: the ONLY variable between them is the pickup
mechanic, so GZ7's comparison isolates its effect rather than conflating it
with a rate difference. General/Free's numbers are GS4's original values,
unchanged, so it remains directly recognisable as "the same base game" with
zero pity layered on.

## GZ7. Monte Carlo comparison metrics (fixed by this document)

**Tracked Pools** (`recommendedRunConfig`, `loop-mc/1` — Pools only):

| Pool | zones | meaning |
|---|---|---|
| `spent_total_<zone>` | all 3 | total spend (near-deterministic given a fixed budget; included for completeness/sanity, not as a headline comparison) |
| `pulls_made_<zone>` | all 3 | total pulls executed under the fixed budget |
| `ssr_count_<zone>` | all 3 | total SSRs landed under the fixed budget — the headline pity-effect metric |
| `pulls_to_first_ssr_<zone>` | all 3 | latched: `-1` until the first SSR, then holds that pull's `pulls_made` snapshot — GS0's original question, kept as a secondary readout (GZ0) |
| `pickup_count_pickup` / `standard_count_pickup` | Zone 3 only | how many of Zone 3's SSRs were pickup vs not — the headline guarantee-effect metric |
| `pulls_to_first_pickup_pickup` | Zone 3 only | latched, same shape as `pulls_to_first_ssr_<zone>` |

The `pulls_to_first_*` latches use the same CSU `afterPull` shape as GZ4/GZ5:
an activator gates the label edge on `<pool> < 0` (only fires once, since
once it is set it is never `< 0` again — no reset edge, unlike `pity`), and
the label's expression is `=@pulls_made_<zone>`-shaped… **except** a `label`
expression is `+N -N =N +S -S =S` only (`SEMANTICS-S3.md`), not a Parameter
or Pool reference — a numeric-literal `label` cannot copy another Pool's
*current* value. This is a real gap, not yet resolved by this document —
see **GZ-D5** below.

**Comparison Registers** (shared neutral frame, RXA `@ref` expressions,
single-run readouts — not Monte Carlo tracked, since Registers store no
per-step state and `loop-mc/1` tracks Pools only):

| Register | expression | format |
|---|---|---|
| `cost_per_ssr_free` | `@spent_total_free / @ssr_count_free` | currency |
| `cost_per_ssr_standard` | `@spent_total_standard / @ssr_count_standard` | currency |
| `cost_per_ssr_pickup` | `@spent_total_pickup / @ssr_count_pickup` | currency |
| `cost_per_pickup_pickup` | `@spent_total_pickup / @pickup_count_pickup` | currency |
| `pickup_share_pickup` | `@pickup_count_pickup / @ssr_count_pickup` | percent |

A zero-SSR seed on a short/unlucky run makes `ssr_count_<zone>` (or
`pickup_count_pickup`) `0`, and division by zero is already a defined,
handled Register state (`regExpr.row.divZero`) — no new handling needed, but
the implementation PR must include at least one Monte Carlo fixture seed
that actually exercises it (a zero-SSR run is not vanishingly rare at
`p ≈ 0.01` over a bounded budget).

## GZ8. Verification (binds the future implementation PR)

1. **Zone independence.** No resource or state edge crosses between any two
   zones' node sets; deleting one zone's frame + nodes changes no other
   zone's Monte Carlo distribution (byte-identical seeds).
2. **Pity ceiling holds per zone**, each with its OWN `hard_pity_<zone>`
   Parameter, using GZ4's exact acceptance shape from GS9 item set (gap never
   exceeds ceiling; ceiling pull is guaranteed SSR; pity resets same-step on
   both natural and forced SSR; pity increments only on non-SSR) — run
   independently against Zone 2 and Zone 3.
3. **Pickup guarantee holds.** After any standard (non-pickup) SSR in Zone
   3, the very next SSR in Zone 3 is pickup with probability `1`, regardless
   of `w_pickup`/`w_standard`; two consecutive pickups can occur naturally
   (a pickup roll does not owe a guarantee); `missed_pickup_pickup` is
   always `0` or `1`, never anything else.
4. **Conservation**, per zone: `ssr_count + sr_count + r_count == pulls_made`
   (GS9 item 2, per-zone); Zone 3 additionally:
   `pickup_count + standard_count == ssr_count`.
5. **Currency isolation.** `wallet_standard` and `wallet_pickup` are never
   read or written by any edge outside their own zone (GZ3.2).
6. **Determinism.** Same graph + seed ⇒ byte-identical states/reports across
   all three zones simultaneously, in the one shared run.
7. **Comparison Registers compute correctly**, including the zero-SSR /
   zero-pickup divide-by-zero case (GZ7).
8. **Memory budget.** The combined three-zone graph's Monte Carlo run (all
   tracked Pools across all three zones, at whatever `K`/`steps` the
   implementation PR sets) stays under the existing `CELL_LIMIT`.

## GZ9. Decisions

- **GZ-D1** — fixed-budget-spent-in-full economy, not GS0's stop-at-first-SSR
  (GZ0). Flagged as the most consequential divergence from the existing GS
  doc; if rejected, GZ7's whole metric set needs redesigning around a
  stopping condition instead.
- **GZ-D2** — General/Free has no pity mechanic at all (GZ2).
- **GZ-D3** — no shared currency between Premium Standard and Premium Pickup,
  even though both are "paid" in flavour text (GZ3.2) — extends
  `docs/parameter-activator.md` §PA8's separate-pity-Pools precedent to
  currency.
- **GZ-D4** — Zone 3's very first SSR is a fair, un-guaranteed pickup/standard
  split (`missed_pickup_pickup` starts at `0`) — the alternative (starting
  "owed" a guarantee) was considered and rejected as less intuitive with no
  clear benefit.
- **GZ-D5 — UNRESOLVED, needs a decision before implementation.** The
  `pulls_to_first_ssr_<zone>` / `pulls_to_first_pickup_pickup` latch Pools
  (GZ7) need a `label` that copies another Pool's *current* value into
  themselves once, and today's `label` grammar (`+N -N =N +S -S =S`,
  `SEMANTICS-S3.md`) has no Pool-reference form — only `=S` (set to the
  SOURCE Pool's own value, not an arbitrary third Pool's value) or a fixed
  literal. Three options, not chosen here:
  (a) drop the two latch Pools from v1 (lose GS0's "pulls to first success"
  framing as a per-zone readout, keep it only as a coarser Monte Carlo
  post-processing exercise outside the graph);
  (b) source the label FROM the zone's own `pulls_made_<zone>` Pool itself,
  i.e. make the AFTER-PULL EDGE's source `pulls_made_<zone>` (whose value IS
  what should be copied) with expression `=S` targeting the latch Pool —
  **verified NOT to work as stated**: `src/engine/stateExpr.ts`'s
  `ROUTER_KINDS = {gate, converter, drain, end}` does not include `pool`,
  and CSU3-5 requires an `afterPull`/`source-fired` state edge's source be a
  Phase-2 router, not a Pool. A variant of (b) sourcing the label from
  whichever GATE last produced the pull (`roll_gate_<zone>` /
  `forced_ssr_<zone>`, both routers) using `=S` would copy THAT gate's own
  value, not `pulls_made_<zone>`'s — gates don't hold a numeric "value" in
  the sense `=S` needs, so this variant does not obviously work either and
  is not verified here; or
  (c) a small, separately-designed `label` grammar extension letting `=S`
  (or a new form) copy an arbitrary named Pool, not just the edge's own
  source — a real engine-contract change, its own design doc if chosen.
  **This document takes no position — the implementation PR must resolve
  GZ-D5 first**, most likely by re-verifying option (b) against
  `SEMANTICS-S3.md`'s exact router-source requirement before assuming it
  works.

## GZ10. Slices / work order

1. **This document** — zone rules, engine mapping, Parameter tables, MC
   metrics. No graph, no Template entry, no tests.
2. **Implementation** (separate PR, after this document's approval) —
   `examples/gacha-banner-zones.json` (or folded into
   `examples/gacha-simulator.json` as a second bundled Template — the
   implementation PR decides which), a `TEMPLATES` entry, KO/JA label
   overlays, `recommendedRunConfig`, an engine fixture, and e2e coverage
   against GZ8. Must resolve **GZ-D5** before writing the two latch Pools.
   No new engine semantics — GZ4/GZ5 use only shipped primitives.
