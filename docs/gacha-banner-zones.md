# 3-zone gacha Template — banner rules & Monte Carlo comparison (design doc)

**Status: approved, with round-3 and round-4 corrections (below) applied
after approval.** GS10 slice 6, the public
Template named throughout `docs/example-gacha-simulator.md` (GS's
scope-revision section) and `docs/parameter-activator.md` §PA0/§PA8 as the
reason `@parameter` activator support (`loop-state/4`, PR #187→#188→#189, all
MERGED) was built. This document fixes the three zones' odds / cost / pity /
pickup-guarantee rules and the Monte Carlo comparison metrics **before any
implementation**. Per explicit instruction, this PR stops at design
confirmation; the Template's graph, Template-catalogue entry, and tests are
their own separate, later PR — exactly the design → implementation split
already used for CSU (`docs/conditional-state-update.md` → PR #181),
label-timing (`docs/label-timing-authoring.md` → PR #182/#183), and
`@parameter` itself (`docs/parameter-activator.md` → PR #188/#189).

**Draft 2 (Hanrim/Lumi, round 1)** held draft 1's approval and required four
fixes before re-review:

1. **"Free" was mis-modelled as zero-cost.** Draft 1 reused GS4's paid-economy
   numbers verbatim for General/Free without saying what "free" spends. Lumi's
   correction: free means "no cash / no paid currency required", not "no
   simulated consumption" — the zone still spends an in-game currency or a
   free ticket, one per pull, tracked exactly like the paid zones (GZ2). The
   fairness basis across all three zones is now **the same pull count `N`**,
   not a currency amount (currencies aren't even the same unit across zones,
   so comparing raw spend was never meaningful — GZ2, GZ6).
2. **Cross-zone RNG independence was asserted, not verified.** Checked
   directly against `src/engine/rng.ts` (`loop-rng/1`, frozen,
   `SEMANTICS-B1.md` §B1.2): there is no mutable PRNG stream in this engine at
   all — every draw is `sample(seed, step, elementId, purpose, drawIndex)`, a
   pure function keyed by that element's OWN id (GZ3.2) — strengthened with a
   citation and a new acceptance test, rather than weakened.

**Draft 3 (Hanrim/Lumi, round 2)** approved draft 2's direction on points 1/3/4
and the GZ-D5 removal outright, and required two more precise fixes before
final approval — both applied below, no new engine feature needed:

1. **"Independence" overclaimed what was actually verified.** A keyed,
   domain-separated deterministic function guarantees that adding, removing,
   or reordering another zone never perturbs this zone's own draw sequence —
   that is **stream isolation**, not a mathematical proof of *statistical*
   independence between the zones' outcome distributions. GZ3.2 (and every
   other place draft 2 said "RNG independence") is reworded to this precise
   claim. The proposed regression test is unchanged — it was already testing
   the right thing (stream isolation), only the prose calling it
   "independence" overreached.
2. **The fixed horizon needed an exact, testable contract, not a "safety
   margin."** GZ3.5 now pins `steps = pulls_per_zone + 1` exactly (1 funding
   step, verified against `step.ts`'s `actOf(n) === 'onStart' && prev.step
   === 0` — the onStart push commits during step 1, so `buy_pull_<zone>`
   cannot pull until step 2, and GS1's own "at most one paid pull per step"
   rule means pulls occupy steps `2..pulls_per_zone+1` — exactly
   `pulls_per_zone` pull-steps), not "+1 funding step + a small safety
   margin." GZ8 gains five concrete horizon acceptance tests (GZ8 item 3),
   and GZ3.5 now explicitly distinguishes interactive Timeline playback
   (idles with no "ended" indicator — this Template never sets
   `SimState.ended`) from Monte Carlo (always completes at the fixed
   horizon, since `runMonteCarlo`/`runRange` never depend on `ended` to stop
   — they just run the configured `steps` count).
3. **Comparison Registers were conflated with Monte Carlo output.** `loop-mc/1`
   tracks Pools only (`resolveTracked`, verified) with no derived/ratio
   aggregation; a Register can never appear in a Monte Carlo distribution.
   GZ7 is now split into distributional Pool metrics vs. single-run display
   Registers, with the distinction stated explicitly rather than implied.
4. **Draft 1 never named a termination rule, and a naive per-zone `End` would
   have broken the whole Template.** Checked directly against
   `src/engine/step.ts` / `src/engine/montecarlo.ts`: `SimState.ended` is
   **one global boolean**, not per-node — `runRange` stops calling `step()`
   entirely, for every node in the graph, the moment `ended` is set. A
   per-zone `End` (mirroring GS2.3) would freeze the other two zones the
   instant the fastest zone finished. Fixed: this Template has **zero `End`
   nodes**; each zone just idles when its own ticket Pool empties (GZ3.5).

Also, per explicit direction, **GZ-D5 (the "pulls to first X" latch Pools) is
dropped from v1** rather than resolved — the simplest, fastest path forward
(GZ9).

**Round 3 (implementation finding, surfaced and fixed before continuing
implementation, per explicit direction to correct the doc rather than fold
a silent deviation into the implementation PR):** GZ5's relay-Pool shape
(`ssr_landed_pickup` feeding two mutually-exclusive Gates) has a real bug —
a Pool's newly-received resource is not visible to that SAME Pool's own
outgoing pulls until the FOLLOWING step (verified by tracing an actual run),
so the last pull's pickup/standard split would not be resolved at the exact
`pulls_per_zone + 1` horizon, breaking GZ8's own conservation check right at
the boundary round 2 scrutinized. **GZ5 is rewritten**: `ticket_pickup`
connects directly to four mutually-exclusive paths (one per pity-state ×
guarantee-state combination, AND-combining the existing pity activator pair
with a new guarantee activator pair on the SAME nodes — no new engine
capability), eliminating the relay Pool and its lag entirely while keeping
`pulls_per_zone + 1` exact. Extending the horizon instead of fixing the
wiring was considered and explicitly rejected (GZ5.0): it would hide the bug
and leave the very last pull's outcome feeling delayed by a step. GZ8 gains
eight new acceptance tests for the four-path structure (item 5).

**Round 4 (production finding, after #195 shipped — Hanrim noticed the step
counter climbing forever, 400+, with every ticket long spent):** GZ3.5's
"zero `End` nodes" decision was correct about the FAILURE MODE it was
avoiding (a per-zone `End` freezing the other two zones) but wrong about the
fix — the Template never signals completion at all, which reads as broken to
a first-time viewer, not "idle by design." **GZ3.5 is rewritten**: exactly
ONE global `End`, gated by all three zones having actually produced
`pulls_per_zone` results (`pulls_made_<zone> >= @pulls_per_zone`, AND-combined
directly on the `End` node — no per-zone `End`, so the "freezes the others"
failure mode GZ3.5 originally identified still cannot occur). Two real
engine-mechanics findings surfaced and were verified directly against
`step.ts` before this rewrite, in order:
1. A first attempt gated the `End` on `ticket_<zone> <= 0` (rather than
   `pulls_made`) and relayed the pulse through `Source → Pool → End`. Both
   are wrong. **A `Source`'s outgoing edge must target a Pool** — `step.ts`
   drops any push to a non-Pool outright (`"pushes to a non-Pool; ignored in
   Engine A"`), so `Source → End` directly is not constructible at all.
   Routing through an intermediate Pool doesn't fix that and adds a NEW bug:
   Pool pull-availability reads `S[]`, the previous step's already-committed
   value (`availOf(id) = S[id] - taken`), so a Pool's OWN this-step arrival
   is invisible to anything pulling from it until the FOLLOWING step — the
   exact `ssr_landed_pickup` lag GZ5 round 3 already found and fixed,
   recurring in a new spot. `Source → Pool → End` would therefore fire the
   global `End` a full step later than intended.
2. **`ticket_<zone> <= 0` is ALSO true before the Template ever starts** —
   every ticket Pool's `initial` is `0`; `fund_<zone>` (an `onStart` Source)
   only commits its funding at the END of step 1 (GZ3.5's own horizon
   derivation). An activator reads `S[source]`, the state as of the START of
   the step it gates — so at step 1, `ticket_<zone> <= 0` for all three zones
   is ALREADY satisfied, and gating the global `End` on ticket-emptiness
   would open it immediately, ending the Template before a single pull. Fixed
   by gating on `pulls_made_<zone> >= @pulls_per_zone` instead — `pulls_made`
   starts at `0` and can only reach `pulls_per_zone` after `pulls_per_zone`
   real pulls have actually resolved, so the gate cannot open before step
   `pulls_per_zone + 2` under any seed. This is also a strictly more correct
   completion signal than ticket-emptiness: it certifies each zone actually
   PRODUCED its `N` results, rather than merely that its funding is spent (a
   zone whose result-production were somehow blocked would not be
   miscounted as complete).

The corrected shape has no live pulse to relay at all: the global `End`
pulls from a small STANDING Pool (`initial: 1, capacity: 1`, untouched by
anything else in the graph) whose balance has been committed since long
before the gate could ever open — so the moment the AND-gate is first
satisfied, `availOf` already sees it, with no relay step in between. GZ8
gains four new acceptance tests (item 3): no premature termination at step
1, `ended` still `false` at `pulls_per_zone + 1`, `ended` becomes `true` at
exactly `pulls_per_zone + 2`, and every zone's `pulls_made == pulls_per_zone`
at that point.

Prefix `GZ`. Sections: **GZ0** why a fixed-pull-count economy, not "first
SSR" · **GZ1** scope · **GZ2** the three zones (fixed names/rules/currency) ·
**GZ3** structural decisions (one graph, RNG stream isolation, ONE global
`End` gated by all-zones-complete) ·
**GZ4** engine mapping — pity · **GZ5** engine mapping — pickup guarantee ·
**GZ6** Parameter tables · **GZ7** Monte Carlo comparison metrics · **GZ8**
verification · **GZ9** decisions · **GZ10** slices / work order.

---

## GZ0. Why a fixed pull count, not "first SSR"

`docs/example-gacha-simulator.md` (GS0) asks a single-banner question: *how
many pulls until the first SSR, or does the budget run out first?* That
framing makes a great single-banner narrative, but it is the wrong question
for a **three-way comparison**. "Pulls to first SSR" is itself the metric in
GS0's story; here the question is *"given the same number of pulls, how do
three different rule sets change what a player actually gets?"* — which
needs every zone to actually **run the same `N` pulls to completion**, not
stop the moment a Pool first crosses a threshold.

**Decision (GZ-D1): each zone runs the SAME fixed pull count `N` every run**
(no early stop at first SSR). Monte Carlo then reports, per zone, over that
fixed `N`: how many SSRs landed, how many of Zone 3's SSRs were the pickup,
and how often the pity ceiling actually triggered. This is the only framing
under which "General/Free has no pity" vs. "Premium Standard has an 80-pull
ceiling" is visible as a **distribution shift over the same trial count**,
not just a different stopping time — and, per draft 2's fix 1, it also
sidesteps ever needing to compare raw currency amounts across zones that
don't share a unit (GZ2).

This is a deliberate divergence from GS0/GS2.3's End-node design (`got_ssr` /
`budget_exhausted`), not an oversight — flagged here for explicit review
since it changes the narrative GS0 established for the single-banner case,
and it structurally REQUIRES no PER-ZONE `End` node exist anywhere in this
Template (`SimState.ended` is one global boolean — a per-zone `End` would
freeze the other two zones the moment the fastest one finished). A single
GLOBAL `End`, gated on all three zones' own completion together, is fine and
is what GZ3.5 (round 4) actually specifies.

## GZ1. Scope

**In:**

- Three zones in **one bundled Template** (not three separate Templates —
  GZ3), each a self-contained sub-graph with its own ticket/currency Pool,
  its own probability table, and (Zones 2–3) its own tunable hard-pity
  ceiling.
- Zone 3 additionally has a **pickup-guarantee** mechanic: within an SSR
  result, a probabilistic pickup/standard split, with a guarantee that the
  SSR immediately after a non-pickup SSR is pickup.
- A shared, neutral **comparison frame** with cross-zone, single-run display
  Registers (GZ7.2) computed from the three zones' own Pools via `@ref`
  expressions (already-shipped `docs/register-expression-authoring.md`).
- A fixed Monte Carlo tracked-Pool set (GZ7.1) and comparison-Register set
  (GZ7.2), locked in this document.
- Generic placeholder numbers only (GS8's naming/IP boundary applies
  identically here — no real banner's rates, costs, or names).

**Out (this PR):** the actual graph JSON, the Template-catalogue entry, KO/JA
label overlays, engine fixtures, e2e coverage, and any new engine primitive.
**No new `loop-state/N` or `loop-revision/N` is introduced** — GZ4/GZ5 use
only `loop-model/2` (`@param` resource flow), `loop-state/3` (CSU afterPull
labels), `loop-state/4` (`@parameter` activators), Engine B probabilistic
Gates + the keyed `loop-rng/1` draw function, `loop-mc/1` Monte Carlo,
`loop-revision/5` frames, and RXA Register expressions — all shipped. Also
out: `pity_carry_group` (shared cross-zone pity, explicitly deferred by
`docs/parameter-activator.md` §PA8), soft pity, duplicate-to-dust, live
external data, and (per draft 2, GZ-D5) the "pulls to first X" per-zone latch
metrics.

## GZ2. The three zones (names fixed by product decision; currency corrected in draft 2)

Names verbatim from the 2026-09-10 product decision
(`docs/example-gacha-simulator.md` scope-revision section):

| EN UI name (canonical) | KO | currency | rules |
|---|---|---|---|
| **General / Free** | 일반(무료) | `free_ticket` — in-game/free currency, no cash | base rates, **no pity** (GZ-D2) |
| **Premium Standard** | 프리미엄 상시 | `premium_ticket_standard` — own Pool (GZ-D3) | standing SSR pool, own tunable pity |
| **Premium Pickup** | 프리미엄 픽업 | `premium_ticket_pickup` — own Pool (GZ-D3) | SSR rate + pickup rate + pity + pickup guarantee |

"Premium Standard" is the primary UI name; "Permanent" may appear only as
secondary prose, never "Standing", per the original product decision.

**Draft-2 correction on "free" (Lumi):** "General/Free" does not mean the
simulation spends nothing — it means the player spends no cash / no paid
currency. Mechanically the zone still spends a real, tracked quantity
(`free_ticket`, an in-game currency or free-ticket Pool), exactly one unit
per pull, exactly like the two paid zones spend their own ticket. All three
zones are structurally identical funding-and-spend shapes (GZ3.4); only the
*flavour* (which currency, whether it costs cash) differs, and that
flavour difference lives entirely in the label text, never in the engine
wiring.

**The three zones do NOT share a currency unit**, so their raw spend amounts
are never directly comparable (a `free_ticket` and a `premium_ticket_pickup`
are different Pools with no declared exchange rate). The fairness basis for
comparison is instead **the same pull count `N` for every zone** (GZ0/GZ6) —
each zone's own ticket Pool is funded with exactly enough to make exactly `N`
pulls, so "how many SSRs out of `N` pulls" is directly comparable across
zones even though "how much currency was spent" is not.

**Decision (GZ-D2): General/Free has no pity at all** — it is GS0's original
model, re-based onto the ticket economy (GZ3.4) with zero pity/pickup
mechanics layered on, kept as the comparison's baseline/control. The
alternative (a very generous but present ceiling) was considered and
rejected: it would still need a Parameter and a pair of activators for a
mechanic that contributes nothing to the comparison's story (a baseline
should be the *simplest* zone, not a degenerate case of the others).

## GZ3. Structural decisions

### GZ3.1 One Template, one graph, three sub-graphs

The three zones are **not** three separate Template files. They are three
independent, non-interacting sub-graphs inside **one** `GraphDoc`, visually
separated with `loop-revision/5` frames (shipped, LGR Slice 5):

- General/Free — neutral / green frame.
- Premium Standard — violet frame.
- Premium Pickup — accent frame.
- The cross-zone comparison Registers (GZ7.2) — a separate **neutral** frame,
  not colour-matched to any zone (it is shared output, not a zone).

This lets a **single** seeded run or Monte Carlo pass simulate all three
zones simultaneously and produce per-zone results whose own draw sequences
are isolated from one another — domain-separated by id, not merely observed
side by side (GZ3.2 proves this, not just asserts it) — no "Scenario
Compare" feature is needed (that feature was deferred after v0.7.0 and
remains out of scope; nothing here depends on it). Frames are cosmetic-only
(`loop-revision/5`, no engine meaning), so this costs nothing beyond visual
organisation.

### GZ3.2 Verified: cross-zone RNG stream isolation (`loop-rng/1`)

Draft 1 called this "RNG independence" without checking the engine's actual
randomness mechanism, and draft 2's verification, while correct on the
mechanism, kept that same overreaching word. **The precise claim (Hanrim/Lumi,
round 2): each zone's random draws are domain-separated by id and
deterministic — adding, removing, or reordering another zone never perturbs
this zone's own draw sequence. That is stream isolation, a guarantee of
non-interference — it is NOT a mathematical proof of statistical
independence between the zones' outcome distributions**, and this document
does not claim the latter. Checked directly, `src/engine/rng.ts`:

> There is no PRNG object threaded through a run. Every random value is a
> pure total function of a key (seed, step, elementId, purpose, drawIndex).

Concretely (`src/engine/step.ts`): a random resource-flow edge draws via
`sample(seed, curStep, e.id, purpose, i)`; a probabilistic Gate's branch pick
draws via `sample(seed, curStep, g.id, 'gate-route', 0)`. Both keys embed
that specific edge's or Gate's **own graph-authored id** — never a running
counter shared across the step, never anything about how many other draws
happen elsewhere, and never anything about node visitation order. This is
`loop-rng/1` (frozen, `SEMANTICS-B1.md` §B1.2).

**Consequence, provable rather than assumed:** for any two zones with
disjoint id sets (guaranteed by GZ3.4 — zones share no nodes), one zone's
entire sequence of random draws over a run is a pure function of `(seed,
step, that zone's own ids)` and is therefore **exactly** unaffected by:

- whether any other zone exists in the graph at all;
- how many draws any other zone makes, this step or any step;
- the canonical (by-id) order nodes are visited in during a step.

This is stronger than "the three zones are observed together in one run" —
it means each zone's own distribution is bit-for-bit identical to what that
same zone, alone in its own graph, would have produced for the same seed.
GZ8 adds this as a direct, checkable regression test (delete a zone, prove
the other two are unaffected) rather than leaving it as an unverified design
claim.

### GZ3.3 Zones do not share currency (Decision GZ-D3)

Even though Premium Standard and Premium Pickup are both "paid" in the
product's flavour text, each zone gets its **own** ticket Pool
(`premium_ticket_standard`, `premium_ticket_pickup`) — they do NOT draw from
one shared Pool. Sharing would couple the two zones' outcomes (spending in
one changes what's left for the other), which would confound the very
comparison this Template exists to produce. This mirrors
`docs/parameter-activator.md` §PA8's already-reviewed "separate pity Pools
per zone" decision — same reasoning, extended to currency (and, per GZ3.2,
sharing state would ALSO be the only thing that could break the RNG
stream-isolation proof above — Pools are read/write simulation state, unlike
a Parameter, so a shared Pool genuinely would let one zone's activity change
what the other zone's own Gates see as their inputs, even though it would
still not affect their draw KEYS).

### GZ3.4 The reused per-zone economy shape (ticket abstraction)

Every zone reuses the same funding-and-spend shape, simplified from GS2.1
now that "1 unit = 1 pull" replaces GS0's arbitrary currency-per-pull ratio
(draft 2 fix 1 — see GZ6 for why this simplification is safe):

- `fund_<zone>` — an `onStart` Source.
- `ticket_<zone>` — a Pool, initially `0`.
- `fund_<zone> → ticket_<zone>`, `flow = @pulls_per_zone` (ONE Parameter
  shared read-only by all three zones' funding edges — GZ6 explains why
  sharing a *Parameter* here does not reintroduce GZ3.3's coupling concern:
  a Parameter is config data, never simulation state, and never appears in
  any `sample()` key).
- `buy_pull_<zone>` — a `pullAll` Converter: `ticket_<zone> → buy_pull_<zone>`,
  `flow = 1` (a literal — "1 ticket per pull" is definitional, not a tunable
  knob); `buy_pull_<zone> → roll_gate_<zone>` (or the pity-gated pair, GZ4),
  `flow = 1`; `buy_pull_<zone> → pulls_made_<zone>`, `flow = 1`.

Since a ticket costs exactly one ticket, `pulls_made_<zone>` already IS the
zone's own complete spend record — no separate `spent_total_<zone>` Pool is
needed (a real simplification from GS2.1's separate spend-accounting edge,
safe here only because the ticket abstraction makes cost and pull count the
same number by construction — GZ9).

`buy_pull_<zone>` naturally stops firing once `ticket_<zone>` reaches `0`
(the Converter's own `pullAll` all-or-nothing rule, SEMANTICS.md §9 — no
activator needed to gate it off). Per **GZ-D1**, nothing else stops it early
— it runs until the ticket Pool is exhausted, always after exactly `N` pulls
by construction.

### GZ3.5 One global `End`, gated by all three zones having actually completed

Checked directly, `src/engine/step.ts` (`if (k === 'end') ended = true`) and
`src/engine/montecarlo.ts`'s `runRange` (`if (!ended) { st = step(...); if
(st.ended) ended = true }`, then no further `step()` calls that run):
**`SimState.ended` is one global boolean for the entire graph**, not
per-node. The instant ANY `End` node anywhere receives inflow, the WHOLE
simulation stops advancing — every zone, not just the one whose `End` fired.

A per-zone `End` (mirroring GS2.3's `got_ssr` / `budget_exhausted`, the
obvious naive translation of "this zone is done") would therefore freeze the
other two zones the moment the fastest zone finished its `N` pulls — exactly
backwards from "all three zones complete `N` pulls for comparison." **This
failure mode is still avoided** — see round 4's changelog note above — by
using exactly ONE `End`, gated on ALL three zones' own completion together,
never a per-zone one.

**Round 4 correction (production finding — the original "zero `End` nodes"
design left the Template with no completion signal at all, which a
first-time viewer reads as broken, not idle-by-design: the step counter
climbs forever past `pulls_per_zone + 1` with every ticket long spent).**
The global `End`'s activation is gated by three activators, AND-combined
directly on the `End` node itself (the same "multiple activators on one
target AND together" mechanism GZ4/GZ5 already use — no new engine
capability):

```
pulls_made_free    >= @pulls_per_zone ─┐
pulls_made_standard >= @pulls_per_zone ─┼─ AND → global End
pulls_made_pickup   >= @pulls_per_zone ─┘
```

`pulls_made_<zone> >= @pulls_per_zone` (not `ticket_<zone> <= 0`) is the
correct completion signal, verified for two independent reasons (both found
and fixed before this was written — see the round 4 changelog note):
ticket-emptiness is ALSO true before step 1 even funds anything (an
immediate false-positive termination), and `pulls_made` more precisely means
"this zone actually produced `N` results" rather than merely "this zone's
funding is spent."

The `End` pulls from a small **standing** Pool — `all_zones_done_fuel`
(name illustrative), `initial: 1, capacity: 1`, fed by nothing and drained by
nothing else in the graph. Its balance has been committed (via `S[]`) since
step 1, long before the AND-gate can ever open, so there is no live pulse to
relay and no Pool-arrival-lag to worry about (see the round 4 changelog
note's engine-verification for why a `Source → Pool → End` relay was
rejected instead).

**The pull horizon is unchanged: `pulls_per_zone + 1`.** Checked directly,
`src/engine/step.ts`: `actOf(n) === 'onStart' && prev.step === 0` — an
`onStart` Source fires during the FIRST `step()` call (which advances state
from step 0 to step 1), so `fund_<zone>`'s push into `ticket_<zone>` commits
at the end of step 1. `buy_pull_<zone>` reads the step-START snapshot, so it
sees `ticket_<zone> == 0` at step 1 and cannot pull yet; at step 2 it sees
step 1's committed `ticket_<zone> == pulls_per_zone` and pulling begins. Per
GS1's own "at most one paid pull per simulation step" rule, pulls occupy
steps `2 .. pulls_per_zone + 1` inclusive — exactly `pulls_per_zone`
pull-steps, and every zone's `pulls_made` reaches `pulls_per_zone` by the end
of step `pulls_per_zone + 1`.

**The global `End`'s own horizon is `pulls_per_zone + 2` — one step later,
by construction.** An activator reads `S[source]`, the state as of the
START of the step it gates (verified directly, `step.ts`'s activator-eval
loop: `cmp(S[e.source] ?? 0, p.op, n)`) — so the earliest step at which
`pulls_made_<zone> >= pulls_per_zone` can be OBSERVED true for all three
zones is the step immediately after they all reach it, i.e.
`pulls_per_zone + 2`. This is the exact, minimal termination horizon, not an
approximation — asserted as four concrete acceptance tests in GZ8 item 3.

`SimState.ended` is `false` for every step through `pulls_per_zone + 1` and
becomes `true` at exactly `pulls_per_zone + 2`, for every seed. **In ordinary
interactive Timeline playback, this means Play now auto-stops** at
`pulls_per_zone + 2`, one step past the last real pull, instead of climbing
forever. **Monte Carlo's own configured `steps` must be `pulls_per_zone + 2`
now** (was `+ 1`) — `runMonteCarlo` / `runRange` run the configured count
unconditionally and never consult `ended` mid-run to decide when to stop,
but the recommended config should match the Template's own real completion
point exactly, not stop one step short of it.

## GZ4. Engine mapping — the tunable pity ceiling (Zones 2–3)

Directly the mechanism `docs/parameter-activator.md` §PA8 already reviewed
and approved as feasible, generalising GS10-3's fixed-literal proof
(`src/engine/gacha-hard-pity.test.ts`) with a per-zone Parameter in place of
the literal `HARD_PITY`:

- `pity_<zone>` — a Pool, one per zone, starts at `0`.
- `hard_pity_<zone>` — a Parameter, one per zone (Zone 1 has neither).
- `roll_gate_<zone>` (probabilistic, the zone's own SSR/SR/R weights) and
  `forced_ssr_<zone>` (deterministic, one target: the zone's SSR result path)
  are BOTH fed by `ticket_<zone>`'s roll token (via `buy_pull_<zone>`),
  gated by a mutually-exclusive pair of activators on `pity_<zone>`:
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
- `forced_ssr_<zone>` also feeds `ceiling_hits_<zone>` (`flow = 1`), a plain
  cumulative Pool counting how many pulls in this run were pity-forced
  (GZ7.1) — trivial accounting, the same shape as `ssr_count`/`sr_count`.

Zone 1 (General/Free) has no `pity_free` Pool, no `hard_pity_free`
Parameter, and no `ceiling_hits_free` Pool at all — it is a single
probabilistic `roll_gate_free`, nothing else (GZ-D2).

## GZ5. Engine mapping — the pickup guarantee (Zone 3 only)

**Corrected (round 3 — see the changelog above).** Not covered by
`docs/parameter-activator.md` (which only reviewed the pity ceiling) — this
is this document's own contribution.

### GZ5.0 Why the original relay-Pool shape (rounds 1–2) was wrong

The first two drafts routed every SSR result into a relay Pool
(`ssr_landed_pickup`), which then fed two mutually-exclusive Gates gated by
`missed_pickup_pickup`, mirroring GZ4's `pity_<zone> → {roll_gate,
forced_ssr}` shape one level downstream. That shape has a real bug, found
during implementation and confirmed by tracing an actual run: a Pool's
newly-received resource is **not visible to that same Pool's own outgoing
pulls until the following step** (the same "a router's push into a Pool
isn't visible to a further pull until next step" rule
`docs/example-gacha-simulator.md`'s GS10-3 section already hit and designed
around for the *pity* mechanism). Concretely: an SSR landing in
`ssr_landed_pickup` at step *t* was only visible to
`guarantee_gate_pickup` / `normal_split_gate_pickup` at step *t+1* — so at
the exact `pulls_per_zone + 1` horizon, the LAST step's SSR (if any) would
not yet have a resolved pickup/standard split, breaking GZ8's own
conservation identity (`pickup_count + standard_count == ssr_count`) right
at the boundary GZ3.5's round-2 review specifically scrutinized.

The relay Pool could not simply be dropped, either: an activator gates a
*node's* enablement, not one specific outgoing edge, and a Gate's own
fan-out (unlike a Pool's) splits proportionally across ALL of its outgoing
edges without consulting whether a given target is activator-disabled
(verified directly, `src/engine/step.ts`'s deterministic-Gate flow
computation) — so feeding `guarantee_gate_pickup` /
`normal_split_gate_pickup` straight from a Gate source (skipping the relay
Pool) would silently leak resource into whichever gate is disabled that
step, rather than routing it all to the enabled one. Extending the horizon
by one step instead of fixing the wiring was considered and rejected: it
would hide the bug rather than resolve it, and it leaves the LAST pull's
pickup/standard outcome unresolved for a full step — an awkward, delayed-
feeling result for the very last roll of a run, not just an internal digest
nicety.

### GZ5.1 The corrected shape — four mutually-exclusive paths, no relay Pool

`ticket_pickup` (the SAME funding Pool GZ3.4 already uses) connects
**directly** to four candidate paths, each gated by an AND-conjunction of
the SAME `pity_pickup` activator pair GZ4 already defines and a NEW pair on
`missed_pickup_pickup` — multiple activator edges on one target already
AND-combine (`SEMANTICS-S.md` §S6), so no new engine capability is needed:

| path | pity condition | guarantee condition | outcome |
|---|---|---|---|
| `roll_normal_open_pickup` | `< @hard_pity_pickup - 1` | `< 1` (not owed) | probabilistic 3-way: an SSR sub-branch, `sr_hit_pickup` (`@w_sr_pickup`), `r_hit_pickup` (`@w_r_pickup`) |
| `roll_normal_owed_pickup` | `< @hard_pity_pickup - 1` | `>= 1` (owed) | probabilistic 3-way: SSR sub-branch routes STRAIGHT to `pickup_hit_pickup` (`@w_ssr_pickup`), `sr_hit_pickup`, `r_hit_pickup` |
| `roll_forced_open_pickup` | `>= @hard_pity_pickup - 1` | `< 1` (not owed) | guaranteed SSR (the ceiling), still an ordinary probabilistic pickup/standard split |
| `roll_forced_owed_pickup` | `>= @hard_pity_pickup - 1` | `>= 1` (owed) | guaranteed SSR AND guaranteed pickup — a single deterministic route |

These four (pity-state × guarantee-state) conditions are mutually exclusive
and exhaustive (a clean 2×2 partition), so **exactly one path is active
every step** — this is now a direct, checkable acceptance property (GZ8),
not an assumption. `missed_pickup_pickup` — a Pool, values `0` or `1`,
starts at `0` (an SSR's first-ever pickup roll is a fair, un-guaranteed
split — **Decision GZ-D4**, unchanged from round 1).

The two "not owed" paths still need an ordinary probabilistic pickup/
standard split (`@w_pickup` / `@w_standard`), since a miss is possible
there — this reuses a single shared 2-way split Gate, `ssr_split_open_pickup`
(deterministic pass-through from `roll_forced_open_pickup`'s single output,
or the probabilistic SSR sub-branch of `roll_normal_open_pickup`; the two
sources are themselves mutually exclusive by the SAME pity condition, so
sharing one downstream split Gate is safe) — a pure Gate→Gate chain, no Pool
in between, so it resolves within the SAME step (`roll_gate → ssr_hit →
ssr_count`'s existing chain in GZ4 already proves multi-hop Gate chains
settle same-step; only a Pool hop introduces the lag GZ5.0 describes). The
two "owed" paths need no split at all — the SSR result routes straight to
`pickup_hit_pickup`.

Every path's SSR outcome funnels into one of two shared, single-output
deterministic Gates, `pickup_hit_pickup` / `standard_hit_pickup` (each may
have more than one upstream source, since at most one path is ever active
at a time — the same "several sources, always mutually exclusive" shape
`pulls_made_<zone>`'s four afterPull sources already use in GZ4); SR/R
results funnel into shared `sr_hit_pickup` / `r_hit_pickup`, fed by whichever
of the two "not owed"/"owed" NORMAL paths is active (the FORCED paths never
produce SR/R at all, by construction).

### GZ5.2 Bookkeeping — all same-step, all `afterPull`

- **Pity** (`pity_pickup`, GZ4's Pool): `=0` sourced from `pickup_hit_pickup`
  OR `standard_hit_pickup` (any SSR resets it, pickup or not); `+1` sourced
  from `sr_hit_pickup` OR `r_hit_pickup`.
- **Pulls made** (`pulls_made_pickup`): `+1` sourced from ALL FOUR shared hit
  Gates (`pickup_hit_pickup`, `standard_hit_pickup`, `sr_hit_pickup`,
  `r_hit_pickup`) — exactly one fires per step, so this is exactly `+1` per
  pull, never double-counted.
- **SSR count** (`ssr_count_pickup`): `+1` sourced from `pickup_hit_pickup`
  OR `standard_hit_pickup`.
- **Ceiling hits** (`ceiling_hits_pickup`, GZ4's Pool): `+1` sourced from
  `roll_forced_open_pickup` OR `roll_forced_owed_pickup` **firing**
  (a probabilistic or deterministic Gate's own `fired` status is observable
  regardless of which branch it took, so this correctly counts "this pull
  was forced" without needing to know the pickup outcome).
- **The guarantee flag** (`missed_pickup_pickup`): `=1` sourced from
  `standard_hit_pickup` (a miss just happened — the next SSR is now owed);
  `=0` sourced from `pickup_hit_pickup` (the debt is paid). No label touches
  it when `sr_hit_pickup` / `r_hit_pickup` fire — the guarantee state
  persists across any number of SR/R pulls, exactly as intended (an owed
  guarantee is not forgotten while waiting for the next SSR).

This composes cleanly with GZ4's pity ceiling by construction — the four
paths ARE the composition (pity-state × guarantee-state), not a separate
mechanism layered on top of it.

## GZ6. Parameter tables (generic placeholders, GS8 IP boundary applies)

**Shared across all three zones** (config data, read-only — sharing this
does NOT reintroduce GZ3.3's currency-coupling concern, since a Parameter is
never simulation state and never appears in a `sample()` RNG key, GZ3.2):

| key | value | notes |
|---|---:|---|
| `pulls_per_zone` | 200 | `N` — the fairness invariant (GZ0/GZ2); every zone's `ticket_<zone>` Pool is funded with exactly this many units |

**Round 4 addition — `pulls_per_zone` must be a safe positive integer
(`N >= 1`, `Number.isSafeInteger(N)`), and the global `End`'s
`pulls_made_<zone> >= @pulls_per_zone` contract (GZ3.5) depends on it:**
- **`N = 0`** funds every `ticket_<zone>` with `0`, so no zone ever pulls and
  `pulls_made_<zone>` never leaves `0` — but `0 >= 0` is already true AT
  `pulls_made_<zone>`'s starting value, so the global `End`'s AND-gate would
  be satisfied from step 1 onward (reading `S[]` from step 0, where every
  `pulls_made` is already `0`) — a premature-termination case distinct from,
  but the same FAMILY of bug as, the `ticket_<zone> <= 0` false-positive
  round 4 already rejected.
- **A non-integer `N`** (e.g. `200.5`) does NOT make a zone idle forever on
  an un-spendable fractional remainder — **this was this addendum's own
  first-draft claim, and it is wrong; corrected here after tracing the
  actual engine directly rather than reasoning from the ticket-cost
  abstraction alone.** A router's resource pull is satisfied by WHATEVER is
  available up to its want, not an exact match — the leftover `0.5` ticket
  still funds one MORE full pull, and `afterPull`'s `+1` books a whole pull
  regardless of the fractional amount that actually moved. So
  `pulls_made_<zone>` reaches `ceil(N)`, not `floor(N)` — `200.5` silently
  becomes **201 real pulls**, and the Template still terminates (at
  `ceil(N) + 2`), just at a rounded-up pull count the Parameter's displayed
  value never admits to. The real failure mode is a silently WRONG trial
  count, not a hang — still a reason `N` must be a safe integer, just not
  the reason first assumed.
- A negative `N` is nonsensical under the ticket abstraction (GZ3.4) for the
  same reason a negative budget was never modelled in GS0.

`pulls_per_zone` is an ordinary, user-editable Parameter (Inputs panel) —
the engine does not itself restrict a Parameter's value to a safe positive
integer. This is therefore a documented INPUT CONTRACT for this Template,
not an engine-enforced invariant: the shipped default (`200`) satisfies it,
and GZ8 gains an explicit acceptance test pinning the contract at a second,
smaller safe integer (so the test doesn't merely re-confirm the shipped
default), plus a regression test pinning the corrected `ceil(N)` behaviour
directly (so the wrong first-draft claim can never silently creep back) —
but a user who edits the field to `0` gets the step-1 false-positive back,
and a fractional edit gets a silently rounded-up trial count, neither
guarded against by the engine itself. Enforcing the contract in the UI
(e.g. a numeric-step/integer constraint on this specific Parameter's input)
is a possible follow-up, not in scope for the termination fix itself.

**Per zone:**

| zone | key | value | notes |
|---|---|---:|---|
| General/Free | `w_ssr_free:w_sr_free:w_r_free` | 6:51:943 | SSR 0.6 %, GS4's original weights, unchanged |
| Premium Standard | `w_ssr_standard:w_sr_standard:w_r_standard` | 10:90:900 | SSR 1.0 % |
| Premium Standard | `hard_pity_standard` | 80 | ceiling well inside `N = 200`, so its effect on the tail is visible in Monte Carlo |
| Premium Pickup | `w_ssr_pickup:w_sr_pickup:w_r_pickup` | 10:90:900 | SSR 1.0 %, same as Standard (isolates the pickup mechanic's effect) |
| Premium Pickup | `hard_pity_pickup` | 80 | same ceiling as Standard (same reason) |
| Premium Pickup | `w_pickup:w_standard` | 50:50 | fair split before any guarantee applies |

Premium Standard and Premium Pickup deliberately share identical SSR
rate/ceiling numbers: the ONLY variable between them is the pickup
mechanic, so GZ7's comparison isolates its effect rather than conflating it
with a rate difference. General/Free's roll weights are GS4's original
values, unchanged, so it remains directly recognisable as "the same base
game" with zero pity layered on — only its funding mechanism (GZ3.4) is
now expressed as tickets rather than GS4's original currency amounts.

**No `pull_cost_<zone>` or `budget_<zone>` Parameter exists.** Under the
ticket abstraction (GZ3.4), one ticket costs one ticket by definition, so
"cost per pull" is not a tunable knob for this Template — `pulls_per_zone`
alone fixes both the funding amount and the trial count for every zone. If
a later revision wants zones to cost visibly different real-money amounts
per pull (a genuine product question, not modelled here), that is new scope
for whichever slice designs it, not a gap in this one.

## GZ7. Monte Carlo comparison metrics (fixed by this document)

### GZ7.1 Distributional metrics — tracked Pools (`loop-mc/1`, Pools only)

These are the only quantities that can appear as a Monte Carlo *distribution*
(a histogram / mean / quantiles over many seeded runs) — `loop-mc/1`'s
`resolveTracked` accepts Pool ids only (verified, `src/engine/montecarlo.ts`)
and there is no derived/ratio aggregation across tracked Pools.

| Pool | zones | meaning |
|---|---|---|
| `pulls_made_<zone>` | all 3 | always exactly `pulls_per_zone` at the end of every run (GZ3.4/GZ3.5) — a determinism sanity check, not itself a comparison metric |
| `ssr_count_<zone>` | all 3 | total SSRs landed over the `N` pulls — the headline pity-effect metric |
| `ceiling_hits_<zone>` | Zones 2–3 | how many of those SSRs were pity-forced rather than natural (GZ4) |
| `pickup_count_pickup` / `standard_count_pickup` | Zone 3 only | how many of Zone 3's SSRs were pickup vs. not — the headline guarantee-effect metric |

`pulls_made_<zone>` being deterministic (always `= pulls_per_zone`) is
expected and intentional under GZ-D1/GZ3.4 — it is tracked purely so a
Monte Carlo fixture can assert the whole Template ran to completion every
seed, not because its distribution is interesting.

**Round 4 addition — the global `End`'s standing fuel Pool is explicitly
EXCLUDED from this tracked set, from `DEFAULT_TIMELINE_SERIES`, and (being
neither a Parameter nor a Register) never appears in the Inputs or Summary
panels either.** It is pure termination plumbing (GZ3.5) — always `1`,
never changes, carries no comparison meaning — and tracking it would only
add a flat, meaningless line to the Timeline / Monte Carlo distribution
list, exactly the kind of noise GZ7 exists to keep out. The `End` node
itself is not a Pool and was never eligible for tracking regardless.

### GZ7.2 Single-run display Registers — NOT Monte Carlo output

These compute a **derived, single-current-run** number for the Summary
panel (RXA `@ref` expressions, already shipped). They are display-only:
Registers store no per-step state, are never part of `loop-mc/1`'s tracked
set, and can never appear in a Monte Carlo distribution. If a future need
arises for a *distributional* view of a derived ratio (e.g. "the
distribution of hit-rate across 2,000 seeds", not just its value on the run
currently loaded), that needs a new Monte Carlo capability this document
does not propose.

| Register | expression | format | zones |
|---|---|---|---|
| `hit_rate_<zone>` | `@ssr_count_<zone> / @pulls_per_zone` | percent | all 3 |
| `pickup_rate_pickup` | `@pickup_count_pickup / @pulls_per_zone` | percent | Zone 3 only |

`spent`/currency amounts are deliberately **not** given a cross-zone
comparison Register — GZ2 already established the three zones' currencies
share no unit, so "cost per SSR" would only ever be meaningful *within* one
zone's own currency, and (per GZ3.4) it is trivially `1 / hit_rate` in
tickets, not a separate quantity worth its own Register.

**Round 4 correction (Hanrim, 2026-09-13, live-preview review of the
implementation PR):** the 4th Register was originally specified as
`pickup_share_pickup = @pickup_count_pickup / @ssr_count_pickup` — Zone 3's
*share of its own SSRs* that were pickup. That divides `0 / 0` the instant
the Template is opened, before any pull has happened, surfacing as a visible
error badge with no user action taken — this document's own "already a
defined, handled Register state" claim for that case was wrong; a `0 / 0`
evaluate-error is a defined *state*, but it is not a well-formed *value* to
show a first-time viewer at rest. Fixed to `pickup_rate_pickup =
@pickup_count_pickup / @pulls_per_zone` — pickup rate **per pull**, not per
SSR. `pulls_per_zone` is a non-zero constant, so this can never divide by
zero. This changes what the number means (a rarer, lower rate than "share of
SSRs"), not just its formula; "share of SSRs" has no well-defined value at
rest, so it is dropped rather than patched. `hit_rate_<zone>` was never
affected — it was already `/ pulls_per_zone`, well-defined (`0`) on a
zero-SSR seed, exactly as this section already described.

## GZ8. Verification (binds the future implementation PR)

1. **Zone independence, structural.** No resource or state edge crosses
   between any two zones' node sets (Pools, Parameters, Gates — nothing
   shared except the read-only `pulls_per_zone` Parameter, GZ6).
2. **Zone RNG stream isolation (GZ3.2).** Deleting any one zone's nodes and
   edges leaves the other two zones' per-step Pool values byte-identical,
   same seed, same step count — a direct, checkable regression test of the
   `loop-rng/1` keyed-draw property. This tests stream isolation (draws are
   domain-separated by id); it is not, and is not claimed to be, a proof of
   statistical independence between the zones' outcome distributions.
3. **The fixed horizon's exact contract (GZ3.5, round 4).** At `steps =
   pulls_per_zone + 1`, for every seed:
   - `pulls_made_<zone> == pulls_per_zone` for all three zones;
   - `ticket_<zone>` is exactly `0` for all three zones;
   - all three zones produced exactly `pulls_per_zone` roll results each
     (implied by the conservation identity, item 6, but asserted here as its
     own explicit horizon check);
   - `SimState.ended` is still `false` (the global `End`'s own AND-gate reads
     `S[]` from the START of this step, i.e. the PREVIOUS step's values —
     `pulls_made` only just reached `pulls_per_zone` AT this step, so the
     gate cannot yet observe it satisfied).
   At `steps = pulls_per_zone + 2` — one step later, exactly:
   - `SimState.ended` is `true`, for every seed (the AND-gate now reads
     last step's `pulls_made_<zone> == pulls_per_zone` for all three zones);
   - every zone's `pulls_made` / `ticket` / roll-result values are UNCHANGED
     from `pulls_per_zone + 1` (the `End` firing stops the run; it moves no
     resource in any zone);
   - running the simulation for additional steps past `pulls_per_zone + 2`
     changes no Pool value and produces no further event, for any zone
     (idempotent stability — nothing is still "in flight").
   - **no premature termination**: at every step `1..pulls_per_zone`,
     `SimState.ended` is `false`, for any seed — in particular NOT at step 1
     (the `ticket_<zone> <= 0` false-positive round 4 found and rejected
     would have opened the gate here, before any pull).
   In ordinary interactive Timeline playback, Play now auto-stops at
   `pulls_per_zone + 2` — one step past the last real pull — instead of
   advancing forever. Monte Carlo's own `steps` config must be
   `pulls_per_zone + 2` to match (GZ7.1's `recommendedRunConfig`); a Monte
   Carlo run always completes regardless, since `runMonteCarlo` / `runRange`
   run the configured `steps` count directly and never consult `ended`
   mid-run to decide when to stop — but a `steps` value short of
   `pulls_per_zone + 2` would never let the tracked `ended` distribution
   reflect the Template's real completion point.
4. **Pity ceiling holds per zone**, each with its OWN `hard_pity_<zone>`
   Parameter, using GZ4's exact acceptance shape from GS9's item set (gap
   never exceeds ceiling; ceiling pull is guaranteed SSR; pity resets
   same-step on both natural and forced SSR; pity increments only on
   non-SSR) — run independently against Zone 2 and Zone 3.
5. **The four-path pickup-guarantee structure holds (GZ5.1/GZ5.2), round 3.**
   For every seed, **for every pull-bearing step** (steps `2..pulls_per_zone
   + 1`, GZ3.5 — the funding step and any step beyond the horizon fire
   nothing at all, so a bare "every step" would be contractually false):
   - **exactly one of the four paths** (`roll_normal_open_pickup`,
     `roll_normal_owed_pickup`, `roll_forced_open_pickup`,
     `roll_forced_owed_pickup`) is active, for every (pity-state ×
     guarantee-state) combination — a direct combinatorial check, not an
     assumption;
   - **exactly one of the four shared hit Gates** (`pickup_hit_pickup`,
     `standard_hit_pickup`, `sr_hit_pickup`, `r_hit_pickup`) fires per
     pull-bearing step (the branch-outcome sum is exactly `1`);
   - `pickup_count + standard_count + sr_count + r_count == pulls_made`
     (Zone 3's own restatement of item 6's conservation, in terms of the
     four hit Gates specifically);
   - **the last allowed pull can be an SSR and still conserves**: forcing an
     SSR on the FINAL step (`pulls_per_zone`) still yields
     `pickup_count + standard_count == ssr_count` exactly at the horizon —
     the specific case round 3's relay-Pool bug broke;
   - after any standard (non-pickup) SSR, the very next SSR is pickup with
     probability `1`, **regardless of whether that next SSR is natural or
     ceiling-forced** (all of `roll_normal_owed_pickup` /
     `roll_forced_owed_pickup` route it to `pickup_hit_pickup`
     unconditionally);
   - **the guarantee persists across SR/R pulls**: after a miss, any number
     of intervening SR/R results leaves `missed_pickup_pickup == 1` until
     the next SSR actually resolves it;
   - **a pickup SSR clears the guarantee immediately** (same step);
   - two consecutive pickups can occur naturally (a pickup roll does not owe
     a guarantee); `missed_pickup_pickup` is always `0` or `1`, never
     anything else;
   - running additional steps past the horizon changes no value and
     produces no further event (restated here since round 1–2's relay-Pool
     shape could plausibly have failed this specifically; the four-path
     shape has no Pool in its roll path at all, so this holds by
     construction, but it is asserted as its own explicit test, not inferred).
6. **Conservation**, per zone: `ssr_count + sr_count + r_count ==
   pulls_made == pulls_per_zone` (exactly, every run — GZ7.1); Zone 3
   additionally: `pickup_count + standard_count == ssr_count`; Zones 2–3
   additionally: `ceiling_hits <= ssr_count`.
7. **Determinism.** Same graph + seed ⇒ byte-identical states/reports across
   all three zones simultaneously, in the one shared run — including a
   Reset (back to step 0) and re-run: the SAME seed reproduces both the
   SAME per-zone results AND the SAME termination step
   (`pulls_per_zone + 2`, GZ3.5 round 4), not just the same final values.
8. **Comparison Registers compute correctly**, including the zero-SSR /
   zero-pickup edge cases (GZ7.2).
9. **Memory budget.** The combined three-zone graph's Monte Carlo run (all
   tracked Pools across all three zones, at whatever `K` the implementation
   PR sets, `steps = pulls_per_zone + 2` exactly, GZ3.5 round 4) stays under
   the existing `CELL_LIMIT`.
10. **The `pulls_per_zone` input contract (GZ6 round 4 addition) holds at a
    SECOND safe positive integer**, not just the shipped default `200` — a
    smaller `N` (e.g. `5`) still reaches `pulls_made_<zone> == N` for all
    three zones by step `N + 1` and `ended === true` at exactly `N + 2`,
    confirming the termination contract scales with `N` rather than being
    pinned to the default.

## GZ9. Decisions

- **GZ-D1** — every zone runs the SAME fixed pull count `N`
  (`pulls_per_zone`), not GS0's stop-at-first-SSR (GZ0). Flagged as the most
  consequential divergence from the existing GS doc; if rejected, GZ7's
  whole metric set needs redesigning around a stopping condition instead.
- **GZ-D2** — General/Free has no pity mechanic at all (GZ2).
- **GZ-D3** — no shared ticket Pool between Premium Standard and Premium
  Pickup, even though both are "paid" in flavour text (GZ3.3) — extends
  `docs/parameter-activator.md` §PA8's separate-pity-Pools precedent to
  currency.
- **GZ-D4** — Zone 3's very first SSR is a fair, un-guaranteed pickup/standard
  split (`missed_pickup_pickup` starts at `0`) — the alternative (starting
  "owed" a guarantee) was considered and rejected as less intuitive with no
  clear benefit.
- **GZ-D5 (round 2 — REJECTED, dropped from v1 per explicit direction).**
  Draft 1 proposed `pulls_to_first_ssr_<zone>` / `pulls_to_first_pickup_pickup`
  latch Pools to keep GS0's "pulls to first success" framing as a per-zone
  readout. Building them needs a `label` form that copies an arbitrary
  Pool's current value, and today's `loop-state/3` grammar
  (`+N -N =N +S -S =S`) has none — verified against
  `src/engine/stateExpr.ts`'s `ROUTER_KINDS` that the obvious
  Pool-as-state-edge-source workaround also fails CSU3-5's router-source
  requirement. Rather than leave this unresolved into the implementation PR,
  it is dropped entirely from v1: GZ7's `ssr_count_<zone>` /
  `ceiling_hits_<zone>` / `pickup_count_pickup` already give the comparison
  its headline metrics without needing first-occurrence timing. Revisit only
  if a later slice separately designs a `label`-grammar extension that can
  copy an arbitrary Pool's value (a real engine-contract change, its own
  design doc).
- **GZ-D6** — the ticket abstraction collapses "cost" and "pull count" into
  one Pool (`pulls_made_<zone>`, GZ3.4) instead of GS2.1's separate
  `spent_total`. Safe here specifically because one ticket costs one ticket
  by definition (GZ6); not a precedent for a future version that wants
  visibly different real-money costs per pull.
- **GZ-D7 (round 3)** — GZ5's pickup-guarantee mechanism is four
  mutually-exclusive Gates fed directly by `ticket_pickup`, AND-combining
  the pity and guarantee activators on each, rather than a relay Pool
  feeding two Gates. Chosen over extending the horizon by one step (GZ5.0):
  extending the horizon would have hidden the underlying bug rather than
  fixed it, and would leave the very last pull's pickup/standard outcome
  unresolved for a full extra step — a worse result, not just a documentation
  nicety. No new engine capability either way (both shapes only ever use
  activator AND-combination and `afterPull` labels); this is a graph-wiring
  correction, not an engine-contract change.
- **GZ-D8 (round 4)** — exactly ONE global `End`, gated by
  `pulls_made_<zone> >= @pulls_per_zone` AND-combined for all three zones
  directly on the `End` node, pulling a small standing pre-funded Pool (no
  live pulse, no relay). Two alternatives were checked directly against
  `step.ts` and rejected: gating on `ticket_<zone> <= 0` false-positives at
  step 1 (every ticket Pool starts at `0`, before `fund_<zone>` ever
  commits); relaying through `Source → Pool → End` both fails outright (a
  Source may only push to a Pool — `step.ts` drops any other target) and,
  even patched to route through a Pool, reproduces GZ5 round 3's own
  Pool-arrival-lag bug (`availOf` reads `S[]`, the previous step's committed
  value — a Pool's same-step arrival is invisible to anything pulling from
  it until the FOLLOWING step). No new engine capability in the shape that
  was kept: `end` is already gated by `isEnabled`/activators exactly like a
  Gate (`ROUTER_KINDS` membership, unchanged), and a Pool with a nonzero
  `initial` is already ordinary Pool behaviour.

## GZ10. Slices / work order

1. **This document** — zone rules, engine mapping, Parameter tables, MC
   metrics. No graph, no Template entry, no tests.
2. **Implementation** (separate PR, after this document's approval) —
   `examples/gacha-banner-zones.json` (or folded into
   `examples/gacha-simulator.json` as a second bundled Template — the
   implementation PR decides which), a `TEMPLATES` entry, KO/JA label
   overlays, `recommendedRunConfig`, an engine fixture (must include GZ8's
   RNG stream-isolation and fixed-horizon regression tests), and e2e
   coverage. No new engine semantics — GZ4/GZ5 use only shipped primitives.
