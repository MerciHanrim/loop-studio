# Example — "Gacha banner simulator" (non-frozen design doc — DRAFT)

**Status: design draft — for review.** No `loop-*/N` id and no `Frozen`
marker. This may merge as *settled design, implementation pending*, like
[`docs/example-mmo-progression.md`](example-mmo-progression.md) and
[`docs/example-coffee-roastery.md`](example-coffee-roastery.md).

Prefix `GS`. The example is a product demo and bundled Template built from
shipped primitives: `loop-model/2` Parameter-backed resource-edge flows,
Engine B probabilistic Gates and seeded RNG, Monte Carlo, and `loop-state/1`
connections. It also supplies the concrete Parameter table from which a later
external-table import contract can be derived (Appendix GSA).

> **v1 does not model hard or soft pity.** A guaranteed-SSR ceiling was probed
> against the current primitives and cannot be expressed with correct timing;
> see **GS7** and **GS11-D1**. v1 runs until the first SSR **or until the
> available budget is exhausted**. Hard pity remains a separate engine-design
> follow-up.

Sections: **GS0** purpose · **GS1** scope · **GS2** model · **GS3** step trace ·
**GS4** Parameters · **GS5** read-outs · **GS6** Monte Carlo · **GS7** omitted
features · **GS8** naming / IP · **GS9** verification · **GS10** slices ·
**GS11** decisions · **GSA** proposed external-table appendix.

---

## GS0. Why

This example asks:

> With this rarity table, pull cost, and budget, how many pulls and how much
> currency will it take to obtain the first SSR — and how often will the budget
> run out first?

That question makes the graph, stop condition, cost accounting, and Monte
Carlo distribution meaningful. A single-pull example would demonstrate only
one categorical draw.

A gacha banner is a compact **probability table + repeated trial + stopping
condition** model. It matches the use case identified in external feedback
(김형준, DCInside) without claiming to reproduce a real game. The same example
also gives the future table-import work a real
`key / label / value / unit / group` table to design against instead of
inventing a generic schema in isolation.

This example is explanatory, not a precision instrument or test oracle for a
commercial title.

## GS1. Scope

**In:**

- One generic banner and one currency.
- A configurable starting budget and fixed cost per pull.
- At most one paid pull per simulation step.
- A probabilistic `SSR / SR / R` categorical draw whose weights are
  Parameters.
- Cumulative Pools for pulls, spending, and rarity outcomes.
- Two terminal outcomes: first SSR, or budget exhausted before an SSR.
- Seeded replay and Monte Carlo over the resulting capped geometric process.

**Out:** hard pity, soft pity, featured / standard 50-50, rate-up guarantees,
multi-banner selection, pity carry-over, duplicates-to-dust, real game names,
real published rates, and external-table import code.

## GS2. The model — element to node

All labels below are the **canonical English labels stored in the Template
graph JSON** — English has no separate `en.ts` overlay. A fresh Template open
applies the existing KO / JA label overlays
(`src/i18n/templateLabels/{ko,ja}.ts`,
[`docs/template-label-overlay.md`](template-label-overlay.md)); catalogue name
and description strings stay localized EN / KO / JA. All Parameter-backed
resource flows require the shipped `loop-model/2` path.

### GS2.1 Funding and one atomic purchase

`budget` cannot be written directly into a Pool's `initial` field: per
`loop-model/2` a Parameter reference is valid **only** in a resource edge's
`flow` field. Funding therefore uses:

- `fund_budget` — an `onStart` Source.
- `wallet` — a currency Pool, initially `0`.
- `fund_budget → wallet`, `flow = @budget`.

The funding step is setup only; the first pull begins on the following step.

Each paid pull is one activation of `buy_pull`, an automatic Converter in
`pullAll` mode:

- `wallet → buy_pull`, `flow = @pull_cost`.
- `buy_pull → roll_gate`, `flow = 1`.
- `buy_pull → pulls_made`, `flow = 1`.
- `buy_pull → spent_total`, `flow = @pull_cost`.

`pullAll` is essential: when the wallet cannot supply the entire pull cost,
the Converter must consume nothing and produce no roll, count, or spending
entry. One activation therefore commits all four facts atomically:

1. the wallet falls by one full pull cost;
2. exactly one roll token reaches `roll_gate`;
3. `pulls_made` rises by exactly `1`; and
4. `spent_total` rises by exactly `pull_cost`.

The implementation slice must add a focused regression test for the Converter
`pullAll` short-input case before relying on it. If the implementation consumes
a partial input while producing no outputs, that is a bug against the frozen
pull-all contract and must be fixed separately or before the example ships; it
is not a new gacha semantic. (The bundled default keeps `budget` an exact
multiple of `pull_cost`, so the default run never reaches a partial-cost
wallet state — GS4.)

An activator `ssr_count → buy_pull`, expression `< 1`, disables purchasing on
the terminal step after an SSR. This prevents an extra charged pull while the
End node observes the previous committed snapshot.

### GS2.2 The rarity roll

`roll_gate` is an automatic probabilistic Gate. It receives exactly one unit
from `buy_pull` and routes the whole unit to exactly one of:

- `ssr_count` Pool, branch weight `@w_ssr`;
- `sr_count` Pool, branch weight `@w_sr`; or
- `r_count` Pool, branch weight `@w_r`.

The outgoing resource edges are ordered canonically by edge id. Per §B4 Engine
B draws one categorical branch with

`p(j) = w_j / (w_ssr + w_sr + w_r)`.

The result Pools are uncapped cumulative counters. Because the probabilistic
Gate moves the complete one-unit input down one branch, each paid pull adds
exactly one result and never produces a fractional rarity count.

### GS2.3 A valid End pulse

An activator alone does not fire an End — a `loop-state/1` End ends the run
only on a step it actually *receives* resource (I10-S; the engine sets
`ended` only when the End's inflow `> 0`). A Source also cannot push directly
to a non-Pool target. The stop path therefore uses a stored pulse:

- `completion_tick` — automatic Source, `flow = 1`.
- `completion_pulse` — Pool with capacity `1`.
- `completion_tick → completion_pulse`.
- `completion_pulse → got_ssr`, `flow = 1`.
- `completion_pulse → budget_exhausted`, `flow = 1`.

`got_ssr` and `budget_exhausted` are automatic Ends. Their resource input is
present from the setup step onward but is retained in `completion_pulse` until
one End is enabled by its activator.

`got_ssr` has one activator:

- `ssr_count → got_ssr`, expression `>= 1`.

`budget_exhausted` has two activators, AND-combined per the existing rule:

- `wallet → budget_exhausted`, expression `<= 0`;
- `pulls_made → budget_exhausted`, expression `>= 1`.

The second condition prevents the initially empty wallet from ending the run
before `fund_budget` has populated it. The default budget is an exact multiple
of the default pull cost, so a valid default run reaches wallet `0` without a
fractional remainder.

If the last affordable pull is also an SSR, both Ends become eligible on the
next step. Their ids must give `got_ssr` deterministic priority for the shared
completion pulse. The terminal classification still comes from
`ssr_count == 1`, not merely from which End appears first in a report.

### GS2.4 What is state and what is derived

Pools recorded in simulation state:

- `wallet`
- `pulls_made`
- `spent_total`
- `ssr_count`
- `sr_count`
- `r_count`
- `completion_pulse`

Parameters and Registers store no per-step state. Monte Carlo `loop-mc/1`
aggregates **Pools only** (`resolveTracked` drops any non-Pool id), so every
quantity its final distributions need is deliberately present as a Pool, not
only as a Register.

## GS3. Step trace

Let `M = budget / pull_cost` for the default integer-multiple configuration.

1. **Setup step:** `fund_budget` puts `budget` into `wallet`; the completion
   Source fills `completion_pulse`. `buy_pull` sees the step-start wallet of `0`
   and does not pull yet.
2. **Pull step:** `buy_pull` consumes one full cost and emits one roll token,
   one pull-count unit, and one full cost into `spent_total`.
3. `roll_gate` sends the roll token to exactly one rarity Pool.
4. Commit. If the result was not SSR and money remains, the next pull proceeds.
5. If SSR landed, the next step observes `ssr_count >= 1`, disables `buy_pull`,
   and lets `got_ssr` consume the stored completion pulse and end the run.
6. If the wallet reached `0` without SSR, the next step observes both
   exhaustion activators, produces no further purchase, and lets
   `budget_exhausted` end the run.

Consequently the terminal engine step count includes one setup step and one
observation / End step. **It is not the pull count.** `pulls_made` is the sole
authoritative pulls-to-terminal value.

## GS4. Parameters — the driving table

The values are generic placeholders, not copied from a real title.

| key | label | value | unit | group |
|---|---|---:|---|---|
| `budget` | Currency budget | 60000 | currency | Budget |
| `pull_cost` | Cost per pull | 300 | currency | Budget |
| `w_ssr` | SSR weight | 6 | weight | Rarity odds |
| `w_sr` | SR weight | 51 | weight | Rarity odds |
| `w_r` | R weight | 943 | weight | Rarity odds |

Weights are relative: `6 : 51 : 943` means SSR `0.6 %`, SR `5.1 %`, and R
`94.3 %`. The default budget permits `M = 200` complete pulls.

At SSR probability `p = 0.006`, the probability of exhausting all 200 pulls
without an SSR is

`(1 - p)^M = 0.994^200 ≈ 0.3001`.

The corresponding chance of obtaining an SSR within budget is approximately
`69.99 %`. This substantial censored tail is intentional: it makes the budget
question visible in a 2,000-run Monte Carlo sample.

The default Parameter hints should keep `budget >= 0`, `pull_cost > 0`, and
weights non-negative, but hints are advisory. Invalid operational combinations
(zero pull cost, zero total weight, or a budget not divisible by the pull cost)
must remain safe and diagnosable; the bundled default and acceptance fixture use
the exact values above.

## GS5. Registers — explanatory read-outs

| register | expression | format / unit |
|---|---|---|
| `ssr_rate_shown` | `@w_ssr / (@w_ssr + @w_sr + @w_r)` | percent |
| `sr_rate_shown` | `@w_sr / (@w_ssr + @w_sr + @w_r)` | percent |
| `budget_left` | `@wallet` | currency |
| `pulls_so_far` | `@pulls_made` | pulls |
| `spent_so_far` | `@spent_total` | currency |

These Registers improve the Canvas, Summary, and Timeline presentation. They
are **not** listed as Monte Carlo tracked ids because `loop-mc/1` tracks Pool
ids only. The underlying Pools carry the Monte Carlo data.

## GS6. Monte Carlo — a capped geometric process

`recommendedRunConfig` uses `K = 2000` runs and a horizon long enough to cover:

- one funding / setup step;
- at most `M = 200` paid pulls; and
- one final observation / End step.

Use a small explicit safety margin (for example `steps = 205`), not a `260`
approximation. The tracked Pool set is:

- `pulls_made`
- `spent_total`
- `ssr_count`
- `sr_count`
- `r_count`
- `wallet`

The result is **not an uncensored geometric distribution**. Runs stop at the
first SSR or at 200 affordable pulls, so `pulls_made` follows `min(T, M)` where
`T ~ Geometric(p)` on support `1, 2, …`.

For the defaults:

- `P(exhausted) = (1 - p)^M ≈ 30.01 %`;
- `P(SSR within budget) = 1 - (1 - p)^M ≈ 69.99 %`;
- `E[min(T, M)] = (1 - (1 - p)^M) / p ≈ 116.65` pulls;
- among successful runs only, `E[T | T <= M] ≈ 80.91` pulls.

Therefore the final-pull distribution has a right-censoring spike at `200`.
The document and UI must never describe its overall mean as `1 / p ≈ 166.67`;
that is the theoretical mean of an *unlimited-budget* geometric process.

`ssr_count` is binary at termination. Its final distribution directly reports
the success / exhaustion split (`1` = SSR within budget, `0` = exhausted
first). `spent_total` gives the money distribution without asking Monte Carlo
to evaluate a Register.

## GS7. Deliberately not modelled

- **Hard pity / guaranteed SSR.** The current unconditional `label` and
  delayed-`trigger` semantics cannot reset a pity counter conditionally with
  correct next-pull timing — proved, **GS11-D1**.
- **Soft pity.** Additionally requires a dynamic branch weight derived from the
  pity counter and inherits the same reset problem.
- Featured / standard 50-50 and guaranteed-featured-after-loss.
- Rate-up characters, multiple banners, selectors, carry-over, and duplicate
  conversion.
- Live spreadsheet binding or import.
- Any real title's names, artwork, or published rates.

## GS8. Naming and IP boundary

Use only generic labels: "Standard banner", `SSR`, `SR`, and `R`. Rates and
costs are round demonstration values. No character names, game logos, set
names, screenshots, or claims that the defaults reproduce a real service —
same rule as the MMO example (§EM9).

## GS9. Verification

The implementation is accepted only when all of the following hold for the
default configuration.

1. **Atomic purchase.** Below a full pull cost, `buy_pull` consumes `0` and
   emits `0` on every output. At or above the full cost it consumes exactly
   `pull_cost` and emits all three accounting / roll outputs once.
2. **One result per paid pull.** At every committed snapshot,
   `ssr_count + sr_count + r_count == pulls_made` exactly.
3. **No terminal over-pull.** After a snapshot first reaches `ssr_count == 1`,
   the next step ends without changing wallet, spending, pull count, or rarity
   counts.
4. **Budget stop.** A no-SSR run makes exactly `200` pulls, spends exactly
   `60000`, leaves wallet `0`, and ends on the following observation step.
5. **First-SSR stop.** A successful run contains exactly one SSR and no counter
   changes after termination. A success on the 200th pull is classified as
   success, not exhaustion.
6. **Determinism.** Same graph and seed produce byte-identical states and
   reports; Reset returns to step 0 without changing revision identity (the
   `loop-revision/*` digest).
7. **Rates.** Across a fixed 2,000-seed fixture, pooled branch shares fall
   within pre-declared statistical tolerances around `0.6 % / 5.1 % / 94.3 %`.
   Tolerances are fixed *before* observing the implementation result.
8. **Censoring math.** Exhaustion share and mean final `pulls_made` are within
   fixed tolerances of `30.01 %` and `116.65`; do **not** assert an uncensored
   mean of `166.67`.
9. **Readable outputs.** Timeline defaults expose pull count, spending, wallet,
   and SSR result. Monte Carlo final distributions expose `pulls_made`,
   `spent_total`, and binary `ssr_count`.
10. **Memory budget.** The recommended run stays below the existing
    `CELL_LIMIT` for the exact runs, steps, and tracked-Pool count.

A deterministic engine fixture at `src/engine/gacha-simulator.fixture.ts`
(alongside `mmo-progression.fixture.ts` / `coffee-roastery.fixture.ts`) pins
the structural and seed-specific facts. It has **no** separate generated
`*.expected.json` unless implementation review shows a compact golden vector
adds value beyond direct fixed-seed assertions — the MMO and Coffee fixtures
deliberately have none (the `*.expected.json` files under `examples/` belong to
the frozen-semantics verification vectors, not the example Templates).

Hard-pity-only acceptance returns with its own design (GS10-3): the SSR gap
never exceeds the ceiling, the ceiling pull is a guaranteed SSR, pity resets
after both natural and forced SSR, and pity increments only after a non-SSR
pull.

## GS10. Slices

1. **Design** — this document and the negative timing probe
   ([`src/engine/gacha-pity-timing.probe.test.ts`](../src/engine/gacha-pity-timing.probe.test.ts)).
   No Template or engine feature ships here.
2. **Implementation** — `examples/gacha-simulator.json` (the graph, carrying the
   canonical English labels), a fifth `TEMPLATES` entry in
   `src/model/templates.ts`, KO / JA label overlays in
   `src/i18n/templateLabels/{ko,ja}.ts`, EN / KO / JA catalogue text,
   `recommendedRunConfig`, `src/engine/gacha-simulator.fixture.ts` + focused
   engine tests, and e2e for GS9. No new engine semantics. A genuine mismatch
   between the Converter `pullAll` implementation and its frozen contract is
   fixed and reviewed as an engine bug, not hidden in example data.
3. **Hard-pity engine design** — separately define conditional state mutation
   *and* same-step visibility before touching `loop-state/*`. Do not assume a
   "conditional `label`" alone is sufficient. Only then does the pity version of
   GS9 return. Not part of slices 1–2.
4. **External-table contract** — after the example ships, promote Appendix GSA
   into `docs/data-import.md`; Track 2A and Track 2B stay separate PRs. Not
   touched before then.
5. **Model explorability (Track 1)** — decide, after looking at the completed
   graph, whether it needs hierarchical group collapse, a lighter tier
   field / filter with a pinned base tier, or no new feature. Its own doc when
   that call is made.

## GS11. Decisions

### GS11-D1 — a hard pity is not expressible with current timing (**proved**)

The retained probe
[`src/engine/gacha-pity-timing.probe.test.ts`](../src/engine/gacha-pity-timing.probe.test.ts)
records two negative results:

- A `pity → pity` `label` with `-S` applies **every step** (Phase 0,
  unconditionally), so the counter resets every step and can never climb —
  observed `[0, 1, 1, 1, …]`. There is no `label` form meaning "set to 0 only
  when …".
- An SSR-triggered `trigger → Drain` reset lands **one step late**: the SSR
  fires at step *t*, the drain empties `pity` at *t+1*, but the routing at
  *t+1* has already read `S[pity]` committed at *t* (still at the ceiling). The
  probe fires the forced-SSR route on two consecutive steps
  (`ceiling fired at steps: [6, 7]` for `cap = 5`) — two guaranteed SSRs
  instead of one.

These are regression tripwires, not production feature tests. If later engine
work changes either result, the hard-pity design must re-evaluate the complete
ordering contract rather than merely delete the probe.

**Conclusion:** v1 drops the hard pity and runs *pull-until-first-SSR-or-budget*
(GS0 / GS2.3), which needs no counter reset and stays entirely within shipped
primitives. The phrases "current engine only" and "not a blocker" are removed
from this doc for the pity.

### GS11-D2 — dynamic Gate weights are deferred

v1 uses Parameter-backed outgoing edge flows, already supported by
`loop-model/2`. Soft pity would need a weight derived from current simulation
state or a Register; that is a separate engine amendment and is not implied by
this example. (Also open: whether `@register` is legal as a probabilistic-Gate
branch weight at all, or only `@param` / literal / `range` / `dice`.)

### GS11-D3 — the run has two terminal outcomes

"Pull until first SSR" is bounded by the configured budget. The precise v1
statement is therefore "first SSR **or** budget exhausted". All distribution
text uses capped / right-censored geometric terminology.

---

## GSA. Proposed external-table contract (**not implemented here**)

This appendix is a hypothesis derived from GS4. It is validated by *building
the example* (GS10-2) and then promoted to its own design document. Nothing
below ships with the gacha Template.

### GSA0. Snapshot first

Loop Studio is local-first and its simulations are reproducible. Start with a
CSV file or a pasted spreadsheet range. Do **not** add Google OAuth,
private-sheet access, background refresh, or network-dependent execution to
Track 2A. A direct Sheets connection, if ever, is strictly after Track 2B.

### GSA1. Track 2A — import only

- Columns: `key`, `label`, `value`, `unit`, `group`.
- `key` and `value` required; `label` defaults to `key`; `unit` and `group`
  optional.
- Each row becomes one fresh Parameter with an internally generated node id.
- `value` must be finite numeric data.
- Validate the entire preview before changing the graph: empty keys, duplicate
  keys after normalization, invalid values, oversized labels / units, and row
  limits.
- Because an external key is **not** a node id (GSA3), do **not** impose the
  node-id-safe character set on it. The future import design must instead
  specify trimming, Unicode normalization, control-character rejection, maximum
  UTF-8 length, and whether key comparison is case-sensitive.
- After import, the Parameters are ordinary model data. Track 2A stores no
  binding and offers no refresh.

### GSA2. Track 2B — binding and explicit refresh

A refreshable binding needs persisted base state. At minimum it requires:

- a document-level import-source record identified by `sourceId`;
- per bound Parameter: `sourceId`, `sourceKey`, and `lastImportedValue`.

For each normalized `sourceKey`:

- `base = lastImportedValue`
- `local = current Parameter data.value`
- `incoming = newly imported value`

Auto-apply when only one side changed, or both sides agree. Ask the user only
for a true conflict where `local` and `incoming` both differ from `base` and
from each other. The Project-revision three-way is a precedent for the
interaction; code / UI reuse is a later implementation decision.

This is a genuine stored-schema addition. It needs normalization and
serialization rules, backward compatibility, diff field tags, deletion and
missing-row behaviour, and explicit identity decisions. Do not conflate:

- `data.value` affects simulation and must bump simulation revision state;
- provenance does not affect engine evaluation or simulation results;
- serialized provenance is still user document content and will *ordinarily*
  affect document / revision identity, the way labels and positions are
  revision content without affecting the engine (the `GraphDoc.frames`
  precedent — a frame edit moves the full revision digest but not the engine
  digest).

The promoted Track 2B design must decide the canonical revision projection. It
must **not** simply state that provenance is "excluded from the digest".

Source URLs may contain sensitive identifiers. Store them only after a privacy
and portability decision; a local source label plus a content fingerprint may
be safer for file / paste imports.

### GSA3. External key is not the node id

`sourceKey` is user data used for row matching. Loop Studio generates its own
node id. Two sources may use the same key without collision, and renaming or
moving a Parameter does not break a future binding.

### GSA4. Group-to-frame is optional

The import preview offers three explicit destinations:

1. create a frame per distinct `group`;
2. place the imported nodes in one selected existing frame; or
3. create no frames.

Do not silently generate frames from `group`.

### GSA5. Deliberately out of this contract

- Live Google Sheets / Excel synchronization.
- OAuth and private-sheet access.
- Expression rows that create Registers.
- Multi-dimensional stat tables, except flattened rows such as `player_hp_lv10`.
- Write-back to the source.
- Binding to kinds other than Parameter.
