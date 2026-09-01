# Example — "Early MMO progression (levels 1–15)" (non-frozen design doc — DRAFT)

**Status: design pending review — no code.** This doc fixes the **scope, model,
and boundaries** of a shipped example graph before it is built. It is a
**non-frozen** design doc — no `loop-*/N` id, no `Frozen` marker — and merges as
*settled design, implementation pending*, like [`docs/localization.md`](localization.md)
and [`docs/guided-tour.md`](guided-tour.md).

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

Engine-accurate: an **accumulating counter is a Pool** (Registers store nothing,
§M2). A **derived read-out is a Register** (a pure `loop-expr/1` function of the
committed snapshot — `+ - * /` and `@id` only; no `floor` / `min` / `max`).

| Play element | Node(s) | Role |
|---|---|---|
| Time | `Elapsed time` **Pool** ← a "clock" Source adding `time_per_step` each step | the run's cost axis; its terminal value across runs = the time-to-15 distribution |
| XP earned | `XP` **Pool** — fed by the combat + quest reward routes | |
| Level | `Level` **Pool** — an **XP → Level Converter** (`xp_per_level` in → 1 out) drains `XP` and raises `Level` | the progression variable; End + zone gates read it |
| Combat attempt | `Combat` **Gate** (`probabilistic`), fed a fixed "encounters per step" flow from an `Encounters` Source | one branch fires per step: **win** vs **lose / die** |
| Combat win | win branch → `XP` (+`xp_per_kill`), `Gold` (+`gold_per_kill`), and the **Loot** gate | |
| Combat loss / death | lose branch → `Deaths` **Pool** (+1) and a **death penalty**: `Elapsed time` (+`death_time_penalty`) and `Gear wear` (+`durability_loss`) | |
| Death count | `Deaths` **Pool** | tracked; feeds nothing else except the penalty above |
| Water / Food | `Water`, `Food` **Pools** — a post-combat **Recovery Converter** consumes `water_per_fight` + `food_per_fight` per win; a **Resupply Converter** turns `Gold` into `Water` / `Food` at `resupply_cost` when they run low (a `passive` pool + a pull rule, or a state `activator` on `Water < restock_threshold`) | the consumable loop; total consumption is tracked |
| Loot roll | `Loot` **Gate** (`probabilistic`) on a win — `drop_rate` splits **drop** vs **nothing**; a **drop** feeds a **category** gate |
| Loot category | `Loot category` **Gate** (deterministic weights) → **Equip upgrade** / **Vendor trash** / **Consumable** / **Rare reward** pools | one categorised pool per bucket, not per item |
| Equip decision | Equip-upgrade pool → **Gear Converter** raising `Gear score` (a fraction of drops are "upgrades"; the rest route to Vendor trash) | |
| Sell | `Vendor trash` + the non-equipped share → **Vendor Converter** → `Gold` at `vendor_value` | |
| Sale revenue | folded into `Gold`; the *gross* is a Register (`@sold_count * vendor_value`) for reporting | |
| Gear score | `Gear score` **Pool** — raised by the Gear Converter, lowered by `Gear wear` (repair need) | gates harder zones; a `resourceType: "gear"` advisory tag |
| Repair / consumables / training spend | **Gold Drains** — `Repair Drain` (scaled by `Gear wear`), `Consumable Drain`, `Training Drain` (a per-level cost); each is a tracked outflow | |
| Quest vs hunt reward | a **Reward router** Gate (deterministic weights) splitting the encounter reward between a **Quest** route (`xp_per_quest`, `gold_per_quest`, higher, lumpier) and a **Hunt** route (per-kill, steady). Two XP sub-pools `Quest XP` / `Hunt XP` feed `XP` and are tracked so their ratio is observable | |
| Zone difficulty | a state **`label`** connection on the combat flow, or a per-zone `Difficulty` Parameter multiplying `success_prob` down and `xp_per_kill` up as `Level` rises (EM4) | |
| Reaching 15 | an **`activator`** state connection opens a route into an **End** node when `Level >= 15`; `> epsilon` arrival ends the run `fired` (SEMANTICS.md §8) | |

Layout: three horizontal bands (economy of XP/Level top, loot/gear middle,
consumables/gold bottom), left-to-right by phase, so it reads as one connected
graph at L1.

## EM3. One combat cycle

```
encounter (Encounters Source ─ per step)
  → Combat gate (probabilistic)
      ├─ win  → XP + Gold + Loot roll
      │           → Loot gate (probabilistic: drop_rate)
      │               └─ drop → Loot category (equip / vendor / consumable / rare)
      │                           ├─ equip upgrade → Gear score
      │                           └─ vendor trash  → Vendor → Gold
      │           → Recovery converter: spend Water + Food
      └─ lose/die → Deaths +1 ; Elapsed time += death_time_penalty ; Gear wear += durability_loss
  → Reward router (deterministic): Quest XP vs Hunt XP  →  XP
  → Resupply (when Water/Food low): Gold → Water/Food
  → Repair / Training / Consumable drains: Gold out
  → XP → Level converter ; if Level ≥ 15 → End
```

Every step is one such cycle; `Elapsed time` advances by `time_per_step` plus any
death penalty.

## EM4. Zones (stages, not places)

| Zone | Level band | Unlock | Difficulty knobs |
|---|---|---|---|
| **Starter** | 1–5 | open | high `success_prob`, low `xp_per_kill`, cheap repair |
| **Foothills** | 5–10 | `activator`: `Level ≥ 5` | `success_prob` down, `xp_per_kill` up, `gear_check` on `Gear score` |
| **Highlands** | 10–15 | `activator`: `Level ≥ 10` **and** `Gear score ≥ gear_gate_10` | lower `success_prob`, higher `death_chance`, higher `xp_per_kill`, higher costs |

Implementation choice for the design review (EM12): **one graph with
level-scaled Parameters via `label` connections** (a single combat lane whose
rates shift with `Level`) vs **three parallel lanes** each active in its band. The
single-lane form is smaller and reads better; the three-lane form makes each
zone's economy separately inspectable. **Recommendation: single lane** with a
`Difficulty` register/parameter, and a short note in `examples/README.md` on how
to read the bands off the Timeline.

## EM5. Parameters (own numbers — placeholders for review)

All tunable, all the example's own invented values (EM9). Indicative set:

`time_per_step` · `xp_per_kill` · `xp_per_quest` · `xp_per_level` ·
`gold_per_kill` · `gold_per_quest` · `success_prob_base` · `death_chance_base` ·
`death_time_penalty` · `durability_loss` · `drop_rate` ·
`equip_upgrade_share` · `vendor_value` · `water_per_fight` · `food_per_fight` ·
`resupply_cost` · `restock_threshold` · `repair_cost_per_wear` ·
`training_cost_per_level` · `quest_reward_share` · `gear_gate_10`.

Numbers will be picked so a **median run reaches level 15 in a plausible band of
steps** (target ≈ 60–120 steps at `recommendedRunConfig` — tuned during
implementation), with visible XP/hour variance from drop + combat luck.

## EM6. Registers (derived read-outs)

`loop-expr/1` gives `+ - * /` and `@id` (Pool / Parameter / Register values)
only. Registers here are **reporting**, computed from the snapshot:

- `Net gold` = `@gold` (the live pool) — plus, for the Timeline, `Total income` =
  `@quest_gold + @vendor_gold + @kill_gold` and `Total expense` =
  `@repair_spent + @consumable_spent + @training_spent + @resupply_spent`
  (each a small "spent" Pool a Drain also feeds, so the outflow is both drained
  *and* counted — a standard Loop Studio pattern).
- `Hunt XP share` = `@hunt_xp / (@hunt_xp + @quest_xp)` — a `/0` before the first
  reward is fine (SEMANTICS-M: a Register `/0` yields an invalid value, never
  halts the run; the Timeline shows a real gap).
- `Effective level` = `1 + @xp_total / xp_per_level` — a **continuous** read of
  progress (no `floor`); the integer `Level` Pool is the real gate.
- `Consumables burned` = `@water_spent + @food_spent`.

## EM7. Monte Carlo

`recommendedRunConfig`: `{ baseSeed: 1, runs: 200, steps: <tuned, ≈150> }`,
`tracked` = the Pools below (or `[]` to track all).

**Tracked quantities** (terminal-value distribution + per-step bands):

- `Elapsed time` — **time to level 15** (a run that hits 15 ends early; its
  terminal `Elapsed time` is its levelling time; a run that doesn't reach 15
  contributes its LOCF terminal value);
- `Combat` count and `Deaths` — total fights and deaths per run;
- `Water spent` + `Food spent` — total consumables burned;
- `Loot count` and `Sold count` (small counter Pools) — items looted vs sold;
- `Total income`, `Total expense`, `Gold` — final gold and gross flows;
- `Gear score` — final gear;
- `Quest XP` / `Hunt XP` — the XP-source split.

**Questions it answers** (to be echoed in `examples/README.md`):

- average / best / worst steps to level 15, and how wide the spread is;
- which zone band the XP curve flattens in;
- whether gear / repair cost throttles progress (Gold trending to zero);
- quest vs hunt reward balance (is one route dominating?);
- how much drop-rate luck moves the levelling time.

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
- confirms a **median-ish run reaches `Level = 15`** and ends `fired` within the
  recommended `steps`;
- **round-trips**: Export → re-import is byte-identical; the `loop-revision/3`
  digest is stable;
- opens it from **Templates** on desktop and mobile — the menu **name / blurb**
  render in EN and KO, and the seeded node labels are byte-identical across
  locales (the §L3.4 rule);
- works in the **portable** build.

No numeric oracle: the example is a demo, so its exact values may be re-tuned
without a "regression".

## EM11. Slices

- **This PR — the design doc.** `docs/example-mmo-progression.md` only, no code.
- **Next — implementation (its own PR):** `examples/mmo-progression.json`
  (hand-built or exported from a constructed graph); a third `TEMPLATES` entry in
  `src/model/templates.ts` (+ `templateKeys.ts` `id` map); `templates.<id>.name`
  / `.blurb` in `en.ts` + `ko.ts`; an `examples/README.md` row + a "how to read
  it" section; the EM10 E2E. No engine / wire / serialized change; the two
  existing Templates and every visual snapshot unchanged.

## EM12. Open questions for review

1. **Single level-scaled lane vs three parallel zone lanes** (EM4).
   Recommendation: single lane.
2. **`recommendedRunConfig.steps`** — target median-to-15 in ≈60–120 steps ⇒
   `steps ≈ 150` so most runs finish. Agree on the ballpark, exact tuning in
   implementation.
3. **`tracked` explicit list vs `[]`** — an explicit list keeps the Monte-Carlo
   result readable and bounded; `[]` (all Pools) is simpler but noisier.
   Recommendation: explicit list (EM7).
4. **`resourceType` advisory tags** — tag `Gold` / `Water` / `Food` / `Gear
   score` for the coloured legend, or leave untyped? Recommendation: tag them —
   it shows the advisory feature and reads better.
5. **Where the graph is authored** — a committed `.json` file that the Template
   entry imports at build time, or an inline `templates.ts` object like the
   existing two. The existing pattern is inline; a ~35-node graph is large for
   that. Recommendation: commit the `.json` and have `templates.ts` load it.
