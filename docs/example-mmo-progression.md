# Example — "Early MMO progression (levels 1–15)" (non-frozen design doc — DRAFT)

**Status: settled design — implementation pending. rev 2.** rev 1 laid out the
scope, model, and boundaries; **rev 2** applies the review decisions (§EM12,
closed): **three parallel zone lanes** (§EM4), a **win / non-fatal fail /
death** combat split (§EM2.2), **cumulative counter Pools** for every "how much
total" quantity (§EM2.3–EM2.5), `Gear wear` separated from `Gear score`
(§EM2.4), per-band Level-Converter costs (§EM2.6), and a set of **accounting
invariants** in the acceptance conditions (§EM10.1). This is a **non-frozen** design doc — no `loop-*/N` id, no `Frozen`
marker — and merges as *settled design, implementation pending*, like
[`docs/localization.md`](localization.md) and [`docs/guided-tour.md`](guided-tour.md).

The example is the **second follow-up** to the localization base (after the
guided tour, before contextual inline help). It is a **product demo / Templates
entry**, not a precision instrument and not a test oracle: it exists to show
that Loop Studio models a *play economy*, not just an XP curve — growth,
gating, rewards, cost, and probabilistic variance on one screen.

## EM0. Why

"1 → 15 in an early MMO zone" is the canonical progression story: kill things,
turn in quests, level up, buy gear, keep eating. Modelled as a **discrete-step
resource flow** it becomes a real economy question — *where does XP/hour sag,
does gear cost wall you, how wide is the levelling-time spread from drop luck?*
The existing Templates (`Flowing equilibrium`, `Bottleneck deadlock`) are tiny
teaching diagrams; this one is a **connected mid-size economy** a user can open,
run, and Monte-Carlo out of the box.

## EM1. Scope

**In**

- one runnable **`loop-studio/graph`** — `examples/mmo-progression.json` — with a
  `recommendedRunConfig`;
- a **generalised** subject: *early MMO levelling*, with the example's own
  invented numbers and generic node labels;
- the **required play-economy elements** (EM2): combat success / failure, death
  count + time & repair penalty, water & food consumption + resupply,
  categorised loot, an equip-vs-sell decision, vendor revenue, and gold spent on
  repair / consumables / training;
- **three zones** (1–5 / 5–10 / 10–15) with level-gated unlocks (EM4);
- a **Monte-Carlo config** and the tracked-quantity set (EM7);
- registration in the **Templates** menu (EN + KO name / blurb) and an
  `examples/README.md` row;
- an **acceptance E2E** — import → run → the graph is valid, deterministic, and
  round-trips (EM10).

**Out**

- **Real combat.** Each fight is abstracted to `success probability · time cost ·
  consumables spent · reward · death chance`. No per-hit, positioning, cooldown,
  threat, or party mechanics.
- **Spatial / continuous anything** — no map, movement, pathing, AI, collision
  (§EM8). Zones are gated stages, not places.
- **A test oracle.** There is **no** `mmo-progression.expected.json`; the E2E
  checks schema + reproducibility + round-trip, not specific numbers.
- **WoW-specific content** — see EM9.

## EM2. The model — play element → node

Two engine facts drive the shape:

- **Every "how much total" quantity is a cumulative counter Pool** — a Pool a
  flow only ever *adds to*, never drains. A Pool that gets both filled and
  emptied (a live balance like `Gold`, `Water`, `Food`) cannot also report its
  gross inflow / outflow, so each such balance gets a **paired `… earned` /
  `… spent` counter Pool** fed the same amounts. Registers store nothing (§M2),
  so they are never counters.
- **A derived read-out is a Register** — a pure `loop-expr/1` function of the
  committed snapshot: `+ - * /` and `@id` only; **no `floor` / `min` / `max` /
  conditionals**. So a Register can compute a *ratio* or a *sum*, but not an
  integer level or a clamp.

### EM2.1 Core progression

| Element | Node(s) | Notes |
|---|---|---|
| Time | `Elapsed time` **counter Pool** ← a clock Source adds `time_per_step` each step; the death branch adds `death_time_penalty` | terminal value across runs = the time-to-15 distribution |
| XP (live) | `XP` **Pool** — filled by the reward router, drained by whichever zone's Level Converter is active | not a counter — see `XP earned` below |
| XP earned | `XP earned` **counter Pool** — fed the same reward amounts, never drained | so `total XP = f(level path)` is verifiable |
| Level | `Level` **Pool** — raised **+1** by the zone's **`pull all` XP-meter Gate → level-up Converter** (§EM13.4); each lane has its own, with its own rising `xp_per_level[zone]` (§EM2.5) | whole number in a single run — the meter Gate pulls `xp_per_level` atomically and the Converter emits 1 |
| Reaching 15 | a `completion` Source pushes a **1-unit pulse every step** toward an **End** node; a state **`activator`** on `Level ≥ 15` **opens that route**. Before level 15 the route is closed and the pulse is discarded; at level 15 the next pulse arrives `> epsilon` and ends the run `fired` (SEMANTICS.md §8) | this is the run terminator |

### EM2.2 Combat — three outcomes

`Encounters` Source pushes a fixed "encounters per step" flow into the active
zone's **`Combat` Gate** (`probabilistic`), which has **three** weighted
branches:

| Branch | weight | effect (every branch also increments its counter) |
|---|---|---|
| **Win** | `w_win[zone]` | `Combat wins` += 1; `XP` + `XP earned` (+`xp_per_kill[zone]`), `Gold` + `Gold earned` (+`gold_per_kill[zone]`), a `Recovery` converter spends `water_per_fight` + `food_per_fight` (and adds them to `Water consumed` / `Food consumed`), and the **Loot roll** fires |
| **Non-fatal fail** | `w_fail[zone]` | `Combat fails` += 1; no XP, no gold, no loot; `Gear wear` += `wear_per_fail`; a little `Elapsed time` += `fail_time_cost`. **No death.** |
| **Death** | `w_death[zone]` | `Deaths` += 1; `Elapsed time` += `death_time_penalty`; `Gear wear` += `wear_per_death`; no reward |

`Combat wins`, `Combat fails`, `Deaths` are cumulative counter Pools;
`total combats = wins + fails + deaths`. Splitting fail from death keeps the
death rate and the consumable economy honest — not every setback is a corpse
run.

### EM2.3 Loot — categorised, counted

On a **win**, a `Loot` Gate (`probabilistic`, `drop_rate[zone]`) splits
**drop** vs **nothing**. A drop feeds a `Loot category` Gate — **`probabilistic`**
(§EM13.6): one whole drop lands in **exactly one** of four category bucket Pools,
so `Items equipped` / `Items sold` / `Items consumed` are **whole numbers in a
single run** (only a Monte-Carlo average is fractional). Every drop also
increments `Items looted` (counter Pool).

| Category | routed to | counter |
|---|---|---|
| **Equip upgrade** | a `Gear` Converter → `Gear score` **Pool** (+`gear_gain`), and `Items equipped` += 1 | `Gear score` only ever rises here |
| **Vendor trash** | a `Vendor` Converter → `Gold` + `Gold earned` (+`vendor_value`), and `Vendor revenue` (counter) += `vendor_value`, `Items sold` += 1 | |
| **Consumable** | `Water` + `Food` (+`consumable_bonus`), `Items consumed` += 1 | a small free top-up |
| **Rare reward** | a lump to `Gold` + `Gold earned` (+`rare_value`), `Items sold` += 1 (a rare is sold, not equipped, in this model) | low weight, high value — the variance driver |

`Items looted = Items equipped + Items sold + Items consumed + <drops still in a
holding pool>` — see the §EM10 loot invariant.

### EM2.4 Consumables & spend — every flow counted

| Balance Pool | inflow | outflow | paired counters |
|---|---|---|---|
| `Gold` | kill / vendor / rare rewards | `Repair`, `Resupply`, `Training` Drains | `Gold earned` (in), `Repair spend` / `Resupply spend` / `Training spend` (each a counter Pool the matching Drain also feeds) |
| `Water` | `Resupply` converter (Gold → Water at `resupply_cost`), consumable drops | `Recovery` converter per win | `Water bought` (in), `Water consumed` (out) |
| `Food` | `Resupply` converter, consumable drops | `Recovery` converter per win | `Food bought` (in), `Food consumed` (out) |
| `Gear wear` | `wear_per_fail`, `wear_per_death` | the `Repair` Converter consumes `Gear wear` **and** `Gold` (a `repair_cost_per_wear` ratio), reducing wear to 0-ish; it **never touches `Gear score`** | — |
| `Gear score` | equip-upgrade drops only | — (never lowered) | — |

`Resupply` fires when `Water` or `Food` is below `restock_threshold` — a state
`activator` (`Water < restock_threshold`) opens the Gold→Water/Food converter.
`Repair` fires when `Gear wear` is above `repair_threshold` — a state
`activator` (`Gear wear > repair_threshold`).

### EM2.5 Quest vs hunt XP

The encounter reward is split by a deterministic **`Reward router`** Gate
(`quest_reward_share` weight) into a **Quest** route (`xp_per_quest[zone]`,
`gold_per_quest[zone]` — larger, lumpier) and a **Hunt** route (per-kill,
steady). Both routes feed `XP` **and** `XP earned`, **and** their own
never-drained counters `Quest XP` / `Hunt XP`. The final share is the Register
`@hunt_xp / (@hunt_xp + @quest_xp)` — a `/0` before the first reward yields an
invalid Register value (a real Timeline gap), never a halt (§M).

### EM2.6 Zones — three parallel lanes (decided, §EM12)

**Three lanes**, one per band, each a full copy of §EM2.2–EM2.5 with its own
Parameters and its own **XP → Level Converter** (rising `xp_per_level`):

| Zone lane | Level band | opened by (state `activator`) | closed by | `xp_per_level` | tone |
|---|---|---|---|---|---|
| **Starter** | 1–5 | run start (`Level ≥ 0`) | `Level ≥ 5` | `xp_per_level_1` (low) | high win weight, low `xp_per_kill`, cheap repair |
| **Foothills** | 5–10 | `Level ≥ 5` | `Level ≥ 10` | `xp_per_level_2` (higher) | more `w_fail` / `w_death`, higher `xp_per_kill`, a `gear_gate_5` check |
| **Highlands** | 10–15 | `Level ≥ 10` **and** `Gear score ≥ gear_gate_10` | run ends at 15 | `xp_per_level_3` (highest) | lowest win weight, highest `w_death`, highest rewards + costs |

Exactly one lane's `Encounters` flow is live at a time — each lane's
`Encounters` Source is gated by an `activator` that is **open only inside its
band** (`Level ≥ lower` and `Level < upper`, expressed as two `activator`s on
the same route, or an "open at lower, close at upper" pair). A closed lane
contributes nothing. This makes each zone's economy a **separately inspectable
block on the Timeline** — the whole point of the three-lane choice, and the
band boundaries are unambiguous under the current expression grammar (a single
level-scaled lane could not draw them cleanly).

Shared across all three lanes: `Level`, `XP` / `XP earned`, `Gold` + all its
counters, `Water` / `Food` + counters, `Gear wear`, `Gear score`, `Deaths`,
`Elapsed time`, `Items *`, `Quest XP` / `Hunt XP`, and the level-15 End.

### EM2.7 Layout

Left-to-right: **Starter lane** (top band), **Foothills lane** (middle),
**Highlands lane** (bottom), each with its own combat → loot → recovery row;
the **shared economy** (`Level`, `Gold` + counters, `Water`/`Food` + counters,
`Gear`, `Deaths`, `Elapsed time`, the Registers, the End) runs down the right
edge. Reads as three stacked economies feeding one progression column at L1.

## EM3. One combat cycle (within the active zone lane)

```
encounter (this lane's Encounters Source — per step, only while the lane is open)
  → Combat gate (probabilistic, 3 branches)
      ├─ win  → XP (+ XP earned) , Gold (+ Gold earned)
      │           → Loot gate (probabilistic: drop_rate) — on drop: Items looted +1
      │               → Loot category (probabilistic — one drop, one category)
      │                   ├─ equip upgrade  → Gear score ; Items equipped +1
      │                   ├─ vendor trash   → Vendor → Gold (+ Gold earned, + Vendor revenue) ; Items sold +1
      │                   ├─ consumable     → Water + Food ; Items consumed +1
      │                   └─ rare reward    → Gold (+ Gold earned, + Vendor revenue) ; Items sold +1
      │           → Recovery converter: Water -= water_per_fight (+ Water consumed) ;
      │                                 Food  -= food_per_fight  (+ Food consumed)
      ├─ non-fatal fail → Gear wear += wear_per_fail ; Elapsed time += fail_time_cost
      └─ death          → Deaths +1 ; Elapsed time += death_time_penalty ; Gear wear += wear_per_death
  → Reward router (deterministic): Quest route / Hunt route  →  XP (+ XP earned) , Quest XP / Hunt XP
  → Resupply activator (Water|Food < restock_threshold): Gold → Water/Food (+ counters)
  → Repair activator (Gear wear > repair_threshold): Gear wear → 0 , Gold -= repair_cost (+ Repair spend)
  → Training drain: Gold -= training_cost[zone] (+ Training spend)
  → this lane's XP → Level converter: XP -= xp_per_level[zone] → Level +1
  → completion pulse → (Level ≥ 15 activator open?) → End  [ends the run fired]
```

Every step is one such cycle in whichever lane `Level` currently sits in;
`Elapsed time` advances by `time_per_step` plus any fail / death penalty.

## EM4. Zones

Fully specified in **§EM2.6** — three parallel lanes, `1–5 / 5–10 / 10–15`,
each explicitly opened and closed by state `activator`s on `Level` (and a
`Gear score` gate into Highlands). This is the decided form (§EM12 Q1); a
single level-scaled lane was rejected because the current expression grammar
(no comparisons / `floor`) can't draw clean band transitions.

## EM5. Parameters (own numbers — placeholders for review)

All tunable, all the example's own invented values (§EM9). Several are **per
zone lane** (`[1|2|3]`, Starter / Foothills / Highlands):

- **progression:** `time_per_step` · `xp_per_kill[1..3]` · `xp_per_quest[1..3]` ·
  `xp_per_level[1..3]` (rising) · `gold_per_kill[1..3]` · `gold_per_quest[1..3]`
- **combat split:** `w_win[1..3]` · `w_fail[1..3]` · `w_death[1..3]` (each lane's
  three `Combat` gate weights; win falls and death rises with the band)
- **penalties:** `death_time_penalty` · `fail_time_cost` · `wear_per_fail` ·
  `wear_per_death`
- **loot:** `drop_rate[1..3]` · loot-category weights
  `equip_w` / `vendor_w` / `consumable_w` / `rare_w` · `gear_gain` ·
  `vendor_value` · `rare_value` · `consumable_bonus`
- **consumables & spend:** `water_per_fight` · `food_per_fight` ·
  `resupply_cost` · `restock_threshold` · `repair_cost_per_wear` ·
  `repair_threshold` · `training_cost[1..3]`
- **routing & gates:** `encounters_per_step` · `quest_reward_share` ·
  `gear_gate_5` · `gear_gate_10`

Numbers are picked to the §EM10 tuning target: **median run reaches level 15 in
60–120 steps**, and **≥ 95 % of a fixed verification-seed set reach level 15
within 150 steps**, with visible XP/hour variance from drop + combat luck.

## EM6. Registers (derived read-outs only)

`loop-expr/1` gives `+ - * /` and `@id` (Pool / Parameter / Register values)
only — no `floor` / `min` / `max` / conditionals. Every Register here is
**reporting**, a pure function of the counter Pools:

- `Total income` = `@gold_earned` (the counter, not the live `@gold`).
- `Total expense` = `@repair_spend + @resupply_spend + @training_spend`.
- `Net gold check` = `@gold_earned - @repair_spend - @resupply_spend - @training_spend`
  — should track the live `@gold` minus its start value (the §EM10 gold
  invariant, shown live on the Timeline).
- `Hunt XP share` = `@hunt_xp / (@hunt_xp + @quest_xp + 0.001)` — the `+ 0.001`
  keeps the denominator non-zero so R(t) is a clean `0%` before the first reward
  instead of a `/0` diagnostic on opening (§EM13.6); the term is negligible once
  XP flows.
- `XP pace (starter-levels)` = `@xp_earned / @xp_per_level_1` — **not** a level
  estimate (the real `Level` Pool is Converter-driven and piecewise, which an
  expression can't reproduce): total XP earned expressed in first-zone
  level-costs, a pace / effort index.
- `Items accounted` = `@items_equipped + @items_sold + @items_consumed` — vs
  `@items_looted` (the §EM10 loot invariant).
- `Consumables burned` = `@water_consumed + @food_consumed`.

## EM7. Monte Carlo

`recommendedRunConfig`: `{ baseSeed: 1, runs: 200, steps: 150 }` (§EM12 Q2),
with an **explicit `tracked` list** (§EM12 Q3), plus the two UI-only advisory
fields `timelineSeries` (§EM13.3) and `canvasLocked` (§EM13.8):

| tracked Pool | reads as |
|---|---|
| `Elapsed time` | **time to level 15** — a run that hits 15 ends early, so its terminal `Elapsed time` is its levelling time; a run that doesn't reach 15 in 150 steps contributes its LOCF terminal value |
| `Level` | did the run finish (terminal = 15) or stall (< 15) |
| `Deaths` | deaths per run |
| `Combat wins` + `Combat fails` (counter Pools) | total fights and the win/fail split (with `Deaths` = the third outcome) |
| `Water consumed` + `Food consumed` | total consumables burned |
| `Items looted` / `Items equipped` / `Items sold` / `Items consumed` | the loot breakdown |
| `Gold earned` / `Repair spend` / `Resupply spend` / `Training spend` / `Gold` | gross income, gross outflows, final balance |
| `Vendor revenue` | gold from selling specifically |
| `Gear score` | final gear |
| `Quest XP` / `Hunt XP` | the XP-source split |

**Questions it answers** (echoed in `examples/README.md`):

- average / best / worst steps to level 15, and how wide the spread is;
- which zone lane the XP curve flattens in (per-lane Timeline blocks);
- whether gear / repair cost throttles progress (`Gold` trending to zero,
  `Repair spend` climbing);
- quest vs hunt reward balance (`Hunt XP share`);
- how much drop-rate luck moves the levelling time (`Items *` spread vs
  `Elapsed time` spread).

## EM8. What Loop Studio deliberately does not model here

Real-time combat control, 3D movement, monster AI, collision / hitboxes,
line-of-sight, party/aggro. Each fight is a single probabilistic node with a
time cost and a reward. This is the honest boundary of a deterministic
discrete-step model — and the point of the example is that the *economic* shape
of levelling survives that abstraction.

## EM9. Naming & IP boundary

The shipped example is **`Early MMO progression (levels 1–15)`** — a generic
name, generic node labels ("Starter zone", "Vendor trash", "Repair Drain"), and
**the example's own invented numbers**. It contains **no** World-of-Warcraft
zone / quest / creature names, **no** official tuning values, and **no** Blizzard
assets or copied text. It does not present itself as official or affiliated.

A WoW-flavoured version, if ever made, is a **separate personal / blog artifact
derived from this file** — never the bundled Template — and carries an explicit
notice: *"Unofficial. World of Warcraft and related names are trademarks of
Blizzard Entertainment, Inc. Not affiliated with or endorsed by Blizzard
Entertainment."* This is a public-policy risk-management choice, not legal
advice.

## EM10. Verification (acceptance — not an oracle)

The implementation PR ships an E2E that:

- **imports** `examples/mmo-progression.json` and asserts it deserializes as
  `loop-studio/graph` with the expected node / edge counts;
- **runs** it (Step and Play) to completion or `steps`, asserting the run is
  **deterministic** at `baseSeed` (same trajectory on a re-run) and that a
  different seed diverges;
- confirms, over a **fixed verification-seed set**, that a run reaches
  `Level = 15` and ends `fired` with **median 60–120 steps** and **≥ 95 % within
  150 steps**;
- **round-trips**: Export → re-import is byte-identical; the `loop-revision/3`
  digest is stable;
- opens it from **Templates** on desktop and mobile — the menu **name / blurb**
  render in EN and KO, and the seeded node labels are byte-identical across
  locales (the §L3.4 rule);
- works in the **portable** build.

### EM10.1 Accounting invariants

At the end of every run (and, ideally, at every step), these must hold to a
floating-point epsilon:

```
start Gold  + Gold earned
  = final Gold + Repair spend + Resupply spend + Training spend

start Food   + Food bought
  = final Food + Food consumed

start Water  + Water bought
  = final Water + Water consumed

Items looted
  = Items equipped + Items sold + Items consumed + <items still held, if any>
```

If a run holds no items in a pending pool, the last line is
`Items looted = Items equipped + Items sold + Items consumed` exactly. The E2E
asserts each identity from the final `SimState` (Monte-Carlo `tracked` terminal
values give the same numbers across the run set). A broken counter wiring fails
here, not a numeric-oracle diff.

No numeric oracle otherwise: the example is a demo, so its exact tuning values
may be re-picked without a "regression", as long as the invariants above and the
reach-15 target still hold.

## EM11. Slices

- **This PR — the design doc.** `docs/example-mmo-progression.md` only, no code.
- **Next — implementation (its own PR):** the canonical
  `examples/mmo-progression.json` (built by constructing the graph in the app and
  exporting it); a third `TEMPLATES` entry in `src/model/templates.ts` that
  **loads that `.json`** (no inline duplicate, §EM12 Q5) + the `templateKeys.ts`
  `id` map; `templates.<id>.name` / `.blurb` in `en.ts` + `ko.ts`; an
  `examples/README.md` row + a "how to read it" section; the §EM10 E2E incl. the
  §EM10.1 accounting invariants. No engine / wire / serialized change; the two
  existing Templates and every visual snapshot unchanged.

## EM12. Decision record (closed)

1. **Zone form → three parallel lanes** (§EM2.6 / §EM4). `1–5 / 5–10 / 10–15`,
   each explicitly opened and closed by state `activator`s on `Level`, so zone
   unlocks and per-band bottlenecks are read directly off the Timeline. A single
   level-scaled lane was rejected: the current expression grammar (no
   comparisons / `floor`) can't express clean band transitions.
2. **`recommendedRunConfig.steps = 150`.** Tuning target: **median 60–120 steps**
   to level 15, and **≥ 95 %** of a fixed verification-seed set reaching 15
   within 150 steps (§EM10).
3. **Explicit `tracked` list** for Monte Carlo (§EM7), not `[]`.
4. **`resourceType` tags** on `Gold` / `Water` / `Food` / `Gear score`, applied
   consistently.
5. **Canonical = `examples/mmo-progression.json`**; the Template entry loads it.
   **No inline `templates.ts` duplicate.**

### EM12.1 §EM2 reinforcements (applied in rev 2)

- Combat has **three** outcomes — win / non-fatal fail / death (§EM2.2); not
  every loss is a death.
- **Cumulative counter Pools** added for every "how much total": `XP earned`,
  `Gold earned`, `Vendor revenue`, `Repair spend`, `Resupply spend`,
  `Training spend`, `Water bought` / `Water consumed`, `Food bought` /
  `Food consumed`, `Items looted` / `Items equipped` / `Items sold` /
  `Items consumed`, `Combat wins` / `Combat fails` (§EM2.3–EM2.5). A balance
  Pool never doubles as its own gross counter.
- **`Quest XP` / `Hunt XP` are never-drained earn counters** (§EM2.5), parallel
  to feeding the live `XP`; the final share is computable.
- **`Gear wear` is separate from `Gear score`** (§EM2.4): wear accumulates on
  fail / death; `Repair` consumes wear **and** Gold to clear it; `Gear score`
  only ever rises, from equip drops.
- **Level-15 End** is fed a **per-step 1-unit completion pulse**; a `Level ≥ 15`
  `activator` opens that route; the pulse is discarded until then (§EM2.1).
- **Rising level cost** via **per-lane `xp_per_level`** on each zone's XP → Level
  Converter (§EM2.6) — natural under the current engine.
- **Accounting invariants** (§EM10.1) are acceptance conditions.

## EM13. Implementation notes (PR #86, on the `main` graph)

The build is `src/engine/mmo-progression.fixture.ts` → `examples/mmo-progression.json`
(97 nodes / 144 edges), verified by `src/engine/mmo-progression.test.ts`
(regen: `GEN_MMO_PROGRESSION=1 npx vitest run …`). The following are settled
during implementation.

### EM13.1 Product-template layout

The graph is laid out as a **first-time reading path**, not a wiring schematic:

```
Character creation → Starter · Lv 1–5 → Foothills · Lv 5–10 → Highlands · Lv 10–15 → Reached level 15
```

- **TOP** — a spine of five evenly-spaced landmarks (`char_creation`,
  `z1_enc` / `z2_enc` / `z3_enc` renamed to the band labels, `end15`); the small
  `Active character` helper sits between creation and the first zone.
- **MIDDLE** — three **isolated zone columns**, centres **740 px apart**. Each
  column is a roomy **3-lane grid** (`L / M / R` at `cx−260 / cx−30 / cx+240`,
  rows every ~150 px, all inside `[cx−260, cx+240] × [150, 620]`): the
  `Combat → Victory → win amp → loot roll → Loot` chain runs down the **left**
  lane, the `XP-meter → level-up` pair sits on the **right** lane, encounters and
  training on the **middle** lane. No two node boxes abut and no in-column edge
  crosses a node body. Adjacent columns do not overlap in x; a column's **only
  outgoing edges** go to the shared **hub row** just below — `Drop`, `Setbacks`,
  `Deaths queue`, `XP`, `Level`, `Reward`. The hub row and the bottom economy
  bands were dropped a further 140 px (one pass over the `LAYOUT` table) so the
  widened grids keep clear air above the hub row.
- **BOTTOM-LEFT** — the loot chain: `Drop → dispatch → category →
  Equip / Sell / Consume` and the item counters.
- **BOTTOM-CENTRE** — the gold economy: `Reward router → payouts → Gold →
  Repair / Resupply / Training`, plus gear and consumables.
- **RIGHT EDGE** — the seven reporting Registers in one column (`x 2960`, past
  the right edge of every other node), at a **110 px vertical pitch** — enough
  that each Register's title + value + expression line clears the next at 100 %
  zoom without spreading the block so far it is tiring to scan. A Register has no
  ports, so **nothing wires to them**; the column sits where no resource edge
  runs, clear of `Reached level 15` / the completion block on its left.

Positions live in one `LAYOUT` table in the builder so the structural code stays
readable.

### EM13.2 `Character creation` (§EM2.1)

`Character creation` is an **`onStart` Source** — it fires once on the first
advance, putting a token in the `Active character` Pool. A `>= 1` activator on
the Starter encounters Source opens the first zone, so the run "spawns in" on
step 1 and adventuring begins on step 2. It is **not** a race / class / cosmetic
picker (out of scope); it is the graph's start marker.

### EM13.3 Timeline default (`recommendedRunConfig.timelineSeries`)

The file ships a curated **10-series** Timeline default — `Level`,
`Elapsed time`, `XP earned`, `Gold`, `Deaths`, `Gear score`, `Water consumed`,
`Food consumed`, `Items sold`, and the **`Net gold check`** Register — so a
first-run Timeline shows the story, not 47 counters. The rest are one `+N more`
click away. The Monte-Carlo `tracked` list (§EM7) stays wide for the
distributions; the two are independent (`timelineSeries` is UI-only display
state — never the GraphDoc / digest / undo). The field itself landed in a
separate prerequisite PR.

### EM13.4 Engine-shaped model choices (all conservation-safe)

Noted in the fixture header comment:

1. **INTEGER Level, via a `pull all` meter Gate.** A `pullAll` *pool-fed*
   Converter that is under-supplied **consumes its partial input without
   producing** (SEMANTICS.md §6) — it would silently destroy XP and break the
   `XP earned` counter. So the level-up per lane is a **`pull all` deterministic
   METER GATE** that pulls exactly `xp_per_level` from the shared `XP` Pool
   (atomically — nothing when XP is short) feeding a Converter that turns that
   fixed amount into exactly `+1` Level. `Level` is a **whole number in a single
   run**; XP is never destroyed. (Monte-Carlo averages of `Level` are still
   fractional, as expected.)
2. **Repair is two single-input Converters** (`Repair (wear)` clears Gear wear,
   `Repair (bill)` meters the Gold) rather than one two-input Converter — a
   single Converter couples one `f` across two inputs of unequal availability and
   can pay a Repair bill with Gold it did not actually consume. Split, each is a
   single-input metered Converter, so Gold conservation is exact. Both halves
   open together (`Gear wear > threshold` **and** `Gold ≥ 1`).
3. **`Loot category` is probabilistic** (§EM13.6) — one drop, one category, so
   item counts are integral in a single run.
4. **`Hunt XP share` denominator has a `+ 0.001` guard** so R(t) reads a clean
   `0%` from the initial state — no `/0` diagnostic when the template is opened.
5. **`XP pace (starter-levels)`** (Register id `r_efflevel`) replaces the earlier
   "Effective level" name — it is a pace / effort index (`@xp_earned /
   xp_per_level_1`), not a level estimate, since real growth cost is piecewise
   and an expression can't reproduce it.

### EM13.5.1 Layout acceptance (settled with review, revised after the spacing pass)

Full-fit-with-every-label is **not** a realistic target for a model this size —
the minimap and pan / zoom exist for that, and review explicitly retracted it.
The layout is accepted when, at the **start / middle / end** stages of a run:

- the main progression axis order is identifiable in the overall view;
- **zooming a zone, every node in it is readable and reliably clickable** — no
  node boxes abut, and no edge or value badge sits on top of a node body / port
  so as to steal its click target;
- the minimap reaches the other subsystems;
- no nodes permanently overlap or hide behind the Inspector;
- the current-step run emphasis (the active-edge cue) never fully obscures a
  node body;
- Reporting / the Timeline do not dominate the main flow.

Large-graph static **and** running-state readability at the whole-graph level
(focus view on the selected node, dimming unselected edges / badges, pointer
handling so edges never intercept a node's click area, group frames, semantic
zoom, and separating "active" from "a transfer actually happened" in the run
cue) is tracked as an explicit **follow-up readability slice**, out of scope for
this example PR.

### EM13.5 Tuning (§EM10)

Monte Carlo `base seed 1, 200 × 150`: **~99 %** of runs reach Level 15 within 150
steps; **median ≈ 95 steps** (target 60–120), with a real p10–p90 spread on
time-to-15. The §EM10.1 accounting identities hold to ≈ 1e-13 across the checked
seeds. No numeric oracle — the tuning values may be re-picked without a
"regression" as long as the identities and the reach-15 window hold.

### EM13.6 Loot category is `probabilistic` (revised)

§EM2.3 originally specified a **deterministic** `Loot category` Gate. A
deterministic Gate splits one input by weight, so a single drop is smeared
across all four categories and a single run shows fractional
`Items equipped` / `Items sold` / `Items consumed`. Review corrected this: the
`Loot category` Gate is **`probabilistic`** — one whole drop lands in **exactly
one** category bucket Pool per step. In a single seeded run
`Items looted`, `Items equipped`, `Items sold`, `Items consumed`, and each
bucket count are **whole numbers**; only a Monte-Carlo average is fractional.
Continuous quantities (`Gear score`, `Gold`, `XP`, `Elapsed time`) stay
fractional, which is fine. `mmo-progression.test.ts` asserts the item counters
are integral for six seeds. (Weights re-tuned with the change:
`drop_rate` 38 / 38 / 44, category odds 38 : 40 : 18 : 4, `gear_gate_10` 4 —
100 % of the verification-seed set now reaches Level 15, median ≈ 88.)

### EM13.7 `Loot category` gate count

With §EM13.6 the graph has **seven probabilistic Gates** (three `Combat`, three
`Loot`, one `Loot category`) and **four deterministic** Gates — the `Reward
router` plus the three `pull all` XP-meter Gates (§EM13.4 #1), one per zone.

### EM13.8 `recommendedRunConfig.canvasLocked` — opens in a readable edit-lock

The template ships `recommendedRunConfig.canvasLocked: true`. On load the Canvas
opens **edit-locked**: nodes don't move / connect, nothing deletes, the Inspector
is read-only — but selecting a node, reading its Inspector, pan / zoom, the
minimap, the Timeline and the simulation all still work. The layout *is* part of
this example's explanation (§EM13.1), so it shouldn't be nudged by accident on a
first read; the Controls lock toggle (🔒 → 🔓) unlocks editing at any time. Like
`timelineSeries`, `canvasLocked` is UI-only advisory metadata — never the
GraphDoc, the `loop-revision/*` digest, undo, or `simulationRev` — and it is
preserved across Graph / Workspace / Share round-trips. Absent (every older file)
⇒ unlocked, unchanged. The Canvas view-lock itself landed in a separate
prerequisite PR (#89); this template only opts in.

### EM14 `mmo-progression.ko.json` — an independent Korean-language derived file

A Korean-labelled copy of `mmo-progression.json` exists at
`examples/mmo-progression.ko.json` (PR #92) — only the display `label` on every
node and the advisory `resourceType` on `Gold` / `Water` / `Food` / `Gear score`
are translated. Confirmed before translating: `resourceType` is **computation-
neutral, advisory-only** (`src/model/model/resourceType.ts` — normalised,
case-sensitive match against a small built-in styled set for colour, any other
string is "a valid custom type" with a generic swatch; §M4.2 "changes no number,
deletes no connection, blocks no run"). The MMO fixture's values (`currency`,
`supply`, `power`) are not in the built-in set in either language, so
translating them changes no styling and no behaviour. Everything else — node
ids/kinds/positions, every expression, the full `edges` array,
`recommendedRunConfig`, `schema`/`version` — is byte-identical to the English
file; a fresh run of either file with the same seed produces the identical
result (Level 15 at step 88).

It is **not** registered anywhere in the app — not in `templateKeys.ts` /
`TEMPLATES`, no i18n catalog entry, no CI coverage beyond existing generically-
scanned example checks. It is a file to `Import` directly, kept only because the
app cannot currently do this the "right" way:

**Why the Templates entry doesn't switch file by locale (Lumi, 2026-09-02).**
Loading a different JSON for the same Templates entry per active locale was
considered and rejected for now: it would make the English and Korean files two
parallel canonical copies that must be kept in sync by hand (positions,
expressions, edges, `recommendedRunConfig`) every time either is edited, blur
whether switching the app's language should replace an already-open document
(it must not — a loaded document is the user's, not re-selected by locale), and
require a full duplicate JSON for every future language. The better long-term
shape is a **single canonical graph + a per-locale label-overlay dictionary**
(`nodeId → translated display label / resourceType`, human-authored, never
machine-translated at the semantic-token level) applied only at the moment a
Templates entry is freshly opened — never retroactively to a document already
open or edited. That is template-localization, a separate feature with its own
design; `mmo-progression.ko.json` stays a manually-`Import`ed derived file until
it exists.
