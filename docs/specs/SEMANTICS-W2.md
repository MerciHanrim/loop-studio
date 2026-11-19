# Workspace Export / Import — revision 2

```
Spec ID: loop-workspace/2
Status:  Frozen
```

**Frozen (2026-11-01).** Layers on [`SEMANTICS-W.md`](./SEMANTICS-W.md)
(`loop-workspace/1`) exactly as [`SEMANTICS-M2.md`](./SEMANTICS-M2.md) layers
on `loop-model/1`. It adds **one** field, `mc.engineRevision`, and **one**
reader rule for it. Everything else in `loop-workspace/1` — the file shape, the
save scope, the semantic digest, the size limits, import safety, the `view` /
`canvas` / `simulation` parts, the UI — is **inherited verbatim**.

Design record: issue #471 (the Converter defects V1, V2, V3, V3g, V3r, and the
rule that an engine correction and the marking of older saved results ship in
one deploy).

Why a new spec id: `SEMANTICS-W.md` §W5.3 makes a `loop-workspace/1` reader
restore **only** an exact `loop-workspace/1`. The engine is corrected for
documents whose meaning did not change, so a Workspace file written after the
correction may hold a distribution that an app from before it cannot reproduce.
An optional field inside `/1` would be ignored by that older app, which would
then show the newer distribution as current. A new id makes it skip the
workspace part with its existing warning (§W5.3), and the graph still opens.

---

## W2-0. What is unchanged (inherited from `loop-workspace/1`)

- The file shape (§W1), with the two values below changed, and the save scope (§W2).
- The semantic digest and its provenance (§W3, D6): minted only when a run
  completes, carried verbatim, compared on Import to decide `stale`.
- Size limits (§W4), import safety and the atomic restore order (§W5), the
  round-trip guarantees (§W6), the UI (§W8), the invariants (§W9).
- Autosave never persists the `workspace` key; a share link never carries a
  result. Neither is touched by this revision.

---

## W2-1. The engine revision

`ENGINE_REVISION` (`src/engine/revision.ts`) is an integer that is raised
whenever a deploy changes a number the engine computes for a document **whose
meaning did not change** — a correction of the step function under an existing
model version. It is **not** a model version: the graph file never carries it,
`semanticDigest` does not include it, and no reader refuses a graph over it.

| revision | since | what changed |
|---|---|---|
| absent (read as `0`) | — | every engine before 2026-11-01 |
| `1` | 2026-11-01, issue #471 | a Converter whose inputs all come from Pools plans its run fraction before it takes anything, and each of its connections moves `f · rate` (V1, V2); two Converter outputs into one Pool or one router, and two Gate branches into one Pool, share that target's room (V3, V3g, V3r); a Pool that is both input and output of a Converter is bounded on the net amount. A Converter with an input from a Gate or another Converter is outside this guarantee until the next revision (V2b, V4) |
| `2` | 2026-11-02, issue #471 | a Converter fed through a Gate or another Converter is planned together with the routers it is joined to (a Converter group that is a tree), at the turn of the group's first router: one run fraction for the group, every connection in it at `f · rate`, the group's Pool inputs claimed at that turn (V2b, V4; SEMANTICS.md §6 erratum, part 2); a Converter whose router input delivers nothing this step does not run on its Pools alone; a split that rejoins (two forward paths from one router meeting again) is refused before the run, in every model version. A group with a Gate that has two supplies keeps the revision-1 rule and reports an amount it loses (unresolved) |
| `3` | 2026-11-02, issue #476 | a Gate with two supplies (two upstream routers, or one and its own Pools) is planned with its group at a fixed priority — the group's routers in the canonical order, then the Gate's own Pool connections in their order, each supply filled to the most the group can take with the earlier ones fixed; a `pull all` Gate with two supplies demands the sum of its supplies' solitary reaches and moves at that point or not at all, the whole group moving nothing when that demand cannot be met on a shared Pool (SEMANTICS.md §6 erratum, part 3); a group of Gates with no Converter in which a Gate has two supplies is planned the same way, and two multi-supply Gates whose downstreams meet at one Converter are planned together (the second is held to the throughput the Converter's one fraction gives it). A group of Gates only that splits and rejoins keeps the per-Gate rule |
| `4` | 2026-11-03, issue #471 item 5 | `all` on a connection whose source or target is a Converter is refused as a percent is: the connection moves `0` and one run diagnostic names it and the number `1` that keeps the rate it used to mean (SEMANTICS.md §8; a Converter whose only input or output is refused does not run); a Pool that a Converter group both takes from and delivers into is bounded along the group's commit order — an earlier member's take is room a later member's delivery may fill — so a loop routed through a Gate or a Converter is bounded on the net as the direct loop is (SEMANTICS.md §6 erratum, part 2); the direct loop's numbers do not change. The table of cases is `src/engine/all-selfloop.test.ts`; none of the bundled documents changes |
| `5` | 2026-11-04, issue #471 | a group of Gates only that splits and rejoins is planned as one group instead of the per-Gate rule, which lost the join's inflow minus its outflow whenever the join or anything after it was short: several free numbers are filled in #476's order, each to the most the whole group can carry, and a `pull all` Gate of the group that misses its fixed demand (every entry at its full amount) zeroes the whole group (SEMANTICS.md §6 erratum, part 4); the group planners accept no value past an availability or a room, so a capped Pool no longer takes `4` from an event of `4.000000001` and a Converter sharing a Pool with its source Gate runs at one fraction. The table of cases is `src/engine/gateRejoin.test.ts`; none of the 14 bundled documents changes, at full precision over 5 seeds × 300 steps |
| `6` | 2026-11-04, issue #492 | a plain tree of routers outside every group that reaches one Pool by two or more paths is bounded by that Pool's room over the path-summed share, where each branch used to read the whole room and the Gates below lost what they could not deliver; an amount handed to a Gate is reserved once, not again at each Gate it passes, so a sibling or an outside router keeps its room (SEMANTICS.md §6 erratum, part 5). The table of cases is `src/engine/gateTreeSharedPool.test.ts`; none of the 14 bundled documents changes, at full precision over 5 seeds × 300 steps |
| `7` | 2026-11-06 | a rate with a unit whose engine value is below 1e-6 or from 1e21 per step runs at that value (SEMANTICS-M4.md §M4-2, 3). The derived graph wrote such a value as exponent text, `parseFlow` could not read it, and the line ran as `1` per step with no message: `0.00002 CMD` on a 1 h step moved 1 m³ where it should move 0.00000083. The table of cases is `src/model/engineValues.test.ts`; none of the 14 bundled documents changes, at full precision over 5 seeds × 300 steps, run with their kinds, step length and tables |
| `8` | 2026-11-15 | a Gate outside every group that has two or more Pool lines takes each line up to its own amount, and lines off one Pool share what it holds, in their order (SEMANTICS.md §6 erratum, part 6). It sized its throughput from the sum of what the whole Pools held, counted once per line, pulled each line capped by that line's own amount, and passed the full throughput on: Pool A = 100 and Pool B = 0 with "5" from each took 5 and delivered 10, so the model's total went from 100 to 105 with no notice; one Pool of 8 with two "5" lines gave 10. The Gate's evidence reads the same bound (`available` 8, not 10, for those two lines). The cases and a seeded sweep are `src/engine/gateOwnBound.test.ts`; no bundled document holds a Gate with two Pool lines (33 documents, 62 Gates), and no other unit test changed |
| `9` | 2026-11-15 | two rules outside the plans (SEMANTICS.md §6 erratum on the router order, §9 erratum). **Lines between the same pair, all or nothing:** a `pull all` Drain or End and a `push all` Source ask a Pool once for all their lines that share it; asked line by line, a `pull all` Drain with two `5` lines off a Pool of 8 reported 10 taken while the Pool lost 8, and a `push all` Source with two `5` lines into a room of 8 pushed 5 + 3; both now move nothing. **A router below a zero-storage cycle is not on it:** only the routers that can reach themselves are inactive; Gates A ⇄ B, B → C, Pool P → C had C reported on the cycle and P → C moved nothing. The routers ON a cycle keep every connection inactive, as before. The cases are `src/engine/atomicParallelLines.test.ts` and `src/engine/gateChance.test.ts`; no other unit test changed, and the 33 example documents give the same states and reports as revision 8 at full precision over 5 seeds × 300 steps |
| `10` | 2026-11-15 | a tree group with several source Gates is planned over all of them (SEMANTICS.md §6 erratum, part 7); only the first was walked. Two source Gates on one Pool share it in the commit order: `50` each from a Pool of 60 into one Converter is 30 + 30 at one fraction, where 50 + 50 was planned, 50 + 10 moved and the Converter was fed at two fractions. Every source Gate's take is room for a later member's delivery: a loop into a full Pool through the group's second source Gate runs, where it moved nothing or ran by the Gates' ids. A group with one source Gate is unchanged. The cases are `src/engine/planSourceGates.test.ts`; no other unit test changed, and the 33 example documents give the same states and reports as revision 9 at full precision over 5 seeds × 300 steps. Open beside it, issue #570: a router outside a group can take what the group's source Gate was planned to pull |
| `11` | 2026-11-15 | three corrections to the multi-supply plan (SEMANTICS.md §6 erratum, part 8). **A source Gate is charged what it pulls, in the commit order:** with Pool 10, a Gate held to 2 downstream left the next one 4, not 8. An earlier supply is therefore filled first where it used to be given nothing, and on such a model less can move in total. **A Gate held to a throughput covers it exactly:** 5 to be covered by 3 and 2 moved nothing in the whole group; with enough supply it took `5.000000001`. **A `pull all` source Gate under a multi-supply Gate that cannot have its demand zeroes the whole planned group;** it was dropped at the commit and the rest moved. The cases are `src/engine/multiSupplyHeld.test.ts`; no other unit test changed, and the 33 example documents give the same states and reports as revision 10 at full precision over 5 seeds × 300 steps |
| `12` | 2026-11-16 | a planned group that returns to an exactly full Pool exactly what it takes from it runs (SEMANTICS.md §6 erratum, part 9; issue #572). The level of that Pool is 0 on paper and about `1e-16` of the flow in floating point; a positive one failed the room test at every value the search tried, and the group stood still, while a room of `1e-12` let all of it through. Pool 10 of 10, a Gate taking `3` and returning six sevenths, a Converter returning the last: nothing moved, 3 moves. Where the floating-point level is closer to the room than `2⁻³⁰` of what moves through the Pool, the walk is done again in exact fractions and that answer stands: a rate is the decimal the document states (with a unit, that decimal times the unit's exact ratio), a number the engine produced is its double. A net inflow of one unit in the last place of a rate is refused; a net outflow of as much runs. The plan's number is the largest double within the exact bound, so a Pool may end one unit in the last place below full. The cases, the bounds that must not be passed and a seeded sweep are `src/engine/fullPoolLoop.test.ts`; scale (`10⁻⁶` to `10¹²`), rates with a unit and the bounds still decided in floating point are `src/engine/exactRoom.test.ts`; no other unit test changed; the 33 example documents give the same states and reports as revision 11 at full precision over 5 seeds × 300 steps; of 5,153 random graphs 208 change: 12 groups that stood still run, and 196 differ in the last place only (at most `7.1e-15`); a step costs the same on the examples and 2 to 10 times as much where its search ends on a Pool's room (0.4 → 2 ms for 30 routers on one loop) |
| `13` | 2026-11-16 | what a planned group's source Gates are to pull is held for them from the plan to their own turns (SEMANTICS.md §6 erratum, part 10; issue #570). A router outside the group that is ordered between the group's first router and a source Gate read the Pool whole and took the Gate's planned pull: Pool `x` 5, `x →1→` Gate into a planned Converter, `x →5→` an outside Converter ordered between: the outside one took 5, the Gate 0, and the planned Converter was fed 1 and 0 and made 0.5; now the Gate takes its 1 and the outside one the 4 left. Every other router, and another group's plan, reads a Pool net of the hold. The cases are `src/engine/sourceGateHold.test.ts`; the known-defect test of `planSourceGates.test.ts` moved there, and the two seeds `exactRoom.test.ts` pinned as off one fraction are gone; no other unit test changed; the 33 example documents give the same states and reports as revision 12 at full precision over 5 seeds × 300 steps; of 5,153 random graphs 14 change: the 5 with a Converter off its one fraction (none is left), 5 where a Gate moved less than its plan with no Converter behind it to show it, 2 where the Gate had made the amount up from a later line and the outside router now gets less, and 2 in the last place only |
| `14` | 2026-11-16 | a Converter's coefficient in a plan is asked `> 0`, not `> epsilon` (SEMANTICS.md §6 erratum, part 11; issue #576). Behind a Gate the coefficient is a fraction per amount, the Gate's share over the connection's rate, and from a rate of about `10⁹` it is below `1e-9`: the tree plan skipped the bound "at most one run" and the Gate handed the Converter more than it consumes (Pool `→12→` Gate `→6→` Converter, every amount times `10⁹`: 12 taken and handed over for a run of 6, six thousand million gone with no notice); the multi-supply plan gave a piece nothing and the group stood still; the cap from run targets was lost. The cases, each at seven scales from 1 to `10¹⁵` and asked for the same result times the scale, are `src/engine/planLargeAmounts.test.ts`; no other unit test changed; the 33 example documents give the same states and reports as revision 13 at full precision over 5 seeds × 300 steps (the largest amount an example states is 21,000); of 5,153 random graphs no result changes at scales up to `10⁶`, in any place; with every amount times `10⁸`, `10⁹`, `10¹²` and `10¹⁵`, 8, 69, 70 and 69 change, and the graphs with a Converter fed at more than one fraction go from 7, 68, 69 and 69 to 0, 0, 1 and 1 (the one left is issue #572's `pull all` case) |
| `15` | 2026-11-16 | a planned Gate with no Pool line of its own passes on what it was handed, and its `pull all` is not asked a second time (SEMANTICS.md §6 erratum, part 12; issue #572). The plan's number for it and what the member before it hands over are one amount in two orders and can differ in the last place; the Gate moved the least of the two, so that last place was dropped at every scale with no notice (handed `3.5`, passed on `3.4999999999999996`), and from amounts of about `10⁷` a `pull all` Gate found itself short by more than epsilon and passed on nothing (`3.5 × 10⁹` handed over and gone). The cases are `src/engine/gateHandedOn.test.ts`; no other unit test changed; the 33 example documents give the same states, events and notices as revision 14 at full precision over 5 seeds × 300 steps; of 5,153 random graphs, at scales up to `10³` none changes by more than the last place (39 to 73 change in the last place only), and with every amount times `10⁶`, `10⁸`, `10⁹`, `10¹²` and `10¹⁵`, 1, 9, 13, 10 and 14 change by more, each moving more, and the graphs with a Gate whose intake is not its output go from 1, 10, 13, 11 and 15 to 0, 1, 0, 1 and 1 (the ones left are a chain that is not a planned group, open on issue #572) |
| `16` | 2026-11-18, issue #572 | a step's moves are exact and recorded ([`SEMANTICS-E.md`](SEMANTICS-E.md)). Every amount that moves is a fraction, the list of them is the step's record (`report.moves`), and a Pool is stored as the double nearest its exact level, with no clamp. An amount at or under `1e-9` is no longer made `0`: it moves, with no event (the threshold now only decides what is shown), a node that moves one has fired, and an End that takes one ends the run. A line whose rate is above `0` is a live line whatever its size (a rate at or under `1e-9` was read as no line by the plans and as a weight by its Gate). A Pool's capacity is tested exactly, and a net inflow of any size asks the room. A planned `pull all` Gate with two supplies is let through for a Pool that is short by at most `1e-9`, never for room that is short. A `pull all` node that asks `1e-9` or less in all may be short by `1e-9` of what it asks, where an absolute `1e-9` would let any part of it through. A `pull all` Drain or End that runs short within that allowance takes what its Pools hold: a Pool of `2.9999999995` and a line of 3 gave an event of 3, and gives one of `2.9999999995`. A Gate's reported state (issue #477) follows its firing at every size. Stored values can differ from revision 15 in the last place; a document with amounts or rates at or under `1e-9` can differ by more. |
| `17` | 2026-11-19, issue #586 | the floor of a stated run target is the group's ([`SEMANTICS-E.md`](SEMANTICS-E.md) §E19). A planned group one of whose Converters states a target at or under `1e-9` stands still as a whole, before anything is taken, and reads `stopped`, `floor`, as a Converter alone does. On revision 16 the floor was asked of that one member at its turn, after its takes: the members before it ran and handed to it, and it took its inputs and made nothing, with the group reading `met` (at a target of exactly `1e-9` revision 15 lost too). A document in that state gets other results; no bundled example is in it as it ships. |
| `18` | 2026-11-19, issue #581 | a line from a Source is no input of a Converter ([`SEMANTICS-E.md`](SEMANTICS-E.md) §E20). A Source moves nothing along it; the Converter runs as it would without the line, a `pull all` Converter runs when its other lines fill a run, and a recipe of a conserved kind is read without the line. A planned Converter left with no input line stops its group. On revision 17 the line counted in a full run: the Converter ran at a part from its Pool lines alone, took them in full when its output was short of room and lost the rest, a `pull all` Converter never ran, and a planned group's members ran at different parts with no notice. A document with such a line gets other results; no bundled example has one. |

Every later row is a deploy that changed a computed number; the row and the
bump land in the same change as the engine.

**Where it is written.** With a result, beside `resultGraphDigest`:

```jsonc
"workspace": {
  "schema": "loop-workspace/2",
  "version": 2,
  "mc": {
    "config": { /* as §W1 */ },
    "result": { /* a MonteCarloResult */ },
    "resultGraphDigest": "<sha-256 hex, §W3>",
    "engineRevision": 1,                   // the ENGINE_REVISION that produced `result`
    "stale": false
  },
  /* view, canvas, simulation as §W1 */
}
```

`engineRevision` is present exactly when `result` is. It is minted with the
result when a run completes and travels **verbatim** through export and restore,
as the digest does (§W3.2 / D6): a restored result keeps the revision that
produced it, whatever the app that re-exports it runs.

The Monte Carlo **JSON export** (`loop-studio-montecarlo-result.json`) carries
the same value as a top-level `engineRevision` key beside the `loop-mc/1`
result fields. The CSV exports are unchanged.

---

## W2-2. The reader

1. Restore the workspace part of an exact `schema === 'loop-workspace/2'` and
   `version === 2`, by the rules of §W5 and this section; **also** of an exact
   `loop-workspace/1` / `1` file, by the same rules (its result has no revision,
   so it can only be attached stale — rule 3; an `mc.engineRevision` found in a
   `/1` file is **not read**, since no `/1` writer puts one there — a `/1`
   result is stale whatever the file says). Anything else ⇒ graph only, with
   §W5.3's warning. Never throw.
2. `mc.result` passes §W3 first (shape; digest compare).
3. Then the revision: `mc.engineRevision` must be an integer **equal** to the
   app's `ENGINE_REVISION`. Missing, not an integer, or different **in either
   direction** ⇒ the result is attached with `stale: true` and one warning,
   "the saved distribution was computed by a different version of the engine
   and is marked stale; run Monte Carlo again". A result from a newer app is not
   current either: the app cannot reproduce it.
4. A stale mark from the digest (§W3.2) and one from the revision are the same
   `stale`; both warnings may be shown.
5. The stored revision is kept verbatim on the restored result (W2-1).

---

## W2-3. Old-app / forward compatibility

| reader | file | result |
|---|---|---|
| `loop-workspace/1` reader (an app from before this revision) | `loop-workspace/2` file | graph loads; workspace skipped with §W5.3's warning; no distribution shown |
| `loop-workspace/2` reader | `loop-workspace/1` file | graph and workspace load; a saved distribution is attached **stale** with the W2-2 (3) warning |
| `loop-workspace/2` reader | `loop-workspace/2` file, `engineRevision` ≠ the app's | graph and workspace load; the distribution is attached **stale** with the W2-2 (3) warning |
| `loop-workspace/2` reader | `loop-workspace/3`, or any other schema / version | graph only + §W5.3's warning (the path that keeps the next revision safe) |
| any reader | a file whose graph half is invalid | Import fails on the graph, as today |

---

## W2-4. Constants

| name | value | note |
|---|---|---|
| `WORKSPACE_SCHEMA` | `"loop-workspace/2"` | the `workspace.schema` string written |
| `WORKSPACE_VERSION` | `2` | written; the reader also restores exact `loop-workspace/1` / `1` |
| `ENGINE_REVISION` | `12` | `src/engine/revision.ts`; the ledger is W2-1 |

---

## W2-5. Acceptance vectors

Unit (`src/store/workspaceIO.test.ts`, `src/model/workspace.test.ts`):

- Export writes `loop-workspace/2`, `version: 2`, and `engineRevision` equal to the app's with the result; no `engineRevision` without a result.
- Import of a `/2` file with the app's revision: the result is current (`stale: false`), as §W6's round-trip requires.
- Import of a `/2` file with `engineRevision` missing, `0`, `"1"`, or the app's `+ 1`: the result is attached, `stale: true`, with the W2-2 (3) warning; its stored revision is kept and re-exported verbatim.
- Import of a `/1` file with a result: config / view / simulation restore; the result is attached stale with the warning.
- Import of a `/3` file, or a `/2` with `version` `1`, `0`, `-1`, `2.5`, `"2"`: graph only, §W5.3's warning.

The older app (a one-off check recorded in the pull request of the change that
introduced this revision, not a permanent test): a `/2` fixture file opened by
the code at the base commit through its `importFile`, and by its portable
single-file build in a browser — the graph opens, the workspace is skipped with
§W5.3's warning, and no distribution is shown.

---

## W2-6. Decisions

| # | decision |
|---|---|
| **W2-D1** | A new spec id, not an optional field in `/1`: the older reader must skip the workspace part, not read around the field. |
| **W2-D2** | The engine revision lives with **results and exports only**, never in the graph, the digest, the autosave record or a share link. A model version says what a document means; the revision says which engine computed a saved number. |
| **W2-D3** | Different in either direction is stale. |
| **W2-D4** | The `/2` reader restores a `/1` file's config, view and simulation; only its result is forced stale. Users lose nothing but a distribution they can re-run. |
| **W2-D5** | A revision bump and the engine change that needs it are one change; a deploy never shows an older saved result as current beside a newer computation. |
