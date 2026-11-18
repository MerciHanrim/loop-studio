# SEMANTICS-E — `loop-exact/1`: a step's moves are exact

```
Spec ID: loop-exact/1
Status:  DRAFT — proposed with the pull request of issue #572; it is frozen when that pull request merges
Engine:  revision 16 (SEMANTICS-W2.md §W2-1)
```

This document changes how a step is **worked out and recorded**, for every model version. It does not change what a document means, what a file holds, or the digest. It extends [`SEMANTICS.md`](SEMANTICS.md) and its companions and replaces the passages listed under "What this replaces". Where it says nothing, they hold as written.

The words of `SEMANTICS.md` are kept: Pool, Gate, Converter, Source, Drain, End, `pull any`, `pull all`, the snapshot `S`, the phases of a step, the invariants I1 to I7.

Rules are numbered E1 to E19 (with E11a and E11b) and cited as `§E7`. The number E-open marks what this document does **not** settle; nothing here is to be read as settling it.

## The statement in one paragraph

In a step, everything that moves is an exact amount, a fraction, and the list of those moves is the record of the step. A Pool's level after the moves is the value the moves started from, plus what the record moved in, less what it moved out, exactly; what is stored is the double nearest that level, and the next step starts from the stored double. No move is left out of the record for being small, and no line is left out of the step for having a small rate. The number `1e-9` keeps two uses and loses one: it still decides what is **shown**, and it is still the shortfall a `pull all` node may have (for a node that asks less than that, the same part of what it asks); it no longer decides what is **moved**. A Pool's capacity is tested exactly, with no tolerance.

## Terms

- **A written amount**: a number the document states (a line's rate, a table's value). Where a Gate or a Converter reads a line's rate (a share's weight, a run's recipe, what a line into it asks of a Pool), the rate is read as the decimal that is written, digit for digit (`0.1` is one tenth); a rate a unit converts is the written decimal times the unit's exact ratio (SEMANTICS-M4.md §M4-2).
- **An engine value**: the double a line's rate reaches the engine as (SEMANTICS-M4.md §M4-3). What a Source pushes on a line and what a Drain or an End pulls on a line is asked as that double, read exactly, as is the amount a timetable gives a line in a step. (Reading these as the written decimals too is not part of this document.)
- **A held number**: a number the engine holds from one step to the next: a Pool's stored value. It is a double and is read as that double's exact value. A capacity and a Pool's starting amount reach the engine as doubles too and are read so.
- **The record of moves** of a step: every move of the step, in the order it was made, each with the line it is on, where it comes from, where it goes, and its exact amount (`report.moves`).
- **An event**: what is shown of a move (§E15).
- **The display threshold**: `1e-9`, an absolute amount (`EPSILON`).
- **The absolute epsilon**: `1e-9`, as the shortfall a `pull all` node may have (§E11). The same number as the display threshold; a different use.

## The record of moves, and what is stored

**E1. Every move is exact.** What a Gate takes, shares and hands on, what a Converter consumes and produces, what a plan of a group gives each of its lines, what a Source pushes and a Drain or an End pulls: each is a fraction worked from written amounts as decimals, from engine values and from held numbers as their doubles' exact values (see the terms: which is read where). Nothing is rounded between the Pool an amount leaves and the Pool it arrives in.

**E2. A move is in the record when its amount is above 0.** Its size does not matter (§E7).

**E3. A Pool's level.** A `label` is not a move and is not in the record. What a `label` does to a Pool is unchanged (SEMANTICS-S2.md §S2-9, SEMANTICS-S3.md §S3-6): in Phase 0 the Pool's value becomes its stored value at the start plus that phase's label term (the labels' `delta` and the phase's one `clampAdjustment`), worked in doubles. **The moves start from that value**, read exactly as a double's value. At any moment of Phases 1 and 2 a Pool's level is that value, plus every move of the record into it so far, less every move out of it so far. After the last move it is the Pool's exact level of the step. **In a step in which no Phase-0 `label` has lowered the Pool**, the level is within `[0, capacity]` at every moment, exactly (§E13).

**E4. What is stored.** A Pool's value after the moves is the double nearest its exact level (a tie between two doubles goes to the even one). There is no clamp (outside the exception below): the level is within the Pool's bounds already, and so is the double nearest it. The `afterPull` labels (Phase 2.5) are then applied to that double as before, with their own `delta` and `clampAdjustment`; the result is the Pool's stored value at the end of the step.

**The one exception is issue #582, and its reading is not decided here.** A Pool that a Phase-0 `label` has lowered is still pulled as it stood in the snapshot; its exact level can then go under 0 within the step, and the value stored is held at 0. The amount of that hold is the only thing that §E3's bounds, §E4's "no clamp" and §E6's identity leave out. Which reading a later specification takes there (a pull reads the lowered level, or the hold is reported as a term of its own) is for issue #582.

**E5. The next step starts from what is stored.** The exact level is not carried over; the stored double is, and it is read exactly. So a step is exact from its start, and a run is a sequence of exact steps with one rounding of each Pool between them. **A run is therefore not the run of the rationals**: over many steps the stored values drift from what exact arithmetic over the whole run would give, by about a last place a step at most, as they did before.

**E6. Conservation, per step: I1′ as it is written, with the resource term exact.** The identity is the present one (SEMANTICS-S2.md §S2-9; per Pool and per label phase, SEMANTICS-S3.md §S3-6), and the label terms are in it as before, for a `label` that raises a Pool as for one that lowers it:

```
Σ Pool(after) = Σ Pool(before) + Σ Source push
              + ( Σ label delta + Σ per-target clampAdjustment )   ← both label phases, unchanged
              − Σ Drain/End pull − Σ Converter net loss
```

and for one Pool: `final − start = (Σ moves in − Σ moves out) + the Phase-0 label term + the afterPull label term`.

What changes is the resource term only: `Σ Source push`, `Σ Drain/End pull`, each Converter's recipe difference at the part of a run it made, and a Pool's `Σ moves in − Σ moves out` are sums over the record, exact. Between the value the moves start from and the exact level after the last move the identity holds with no error at all. On the stored doubles it holds to the one rounding of §E4; the two label terms are sums of doubles as before.

**The exception is the lower hold of issue #582 and nothing else**: where a Phase-0 `label` has lowered a Pool and the pulls, which read the snapshot, take more than is left, the exact level is under 0 and the stored value is 0; the identity is then off by exactly the amount of that hold, for that Pool, in that step. A `label` that raises a Pool, or lowers one that is not then pulled under 0, is inside the identity.

## Small moves

**E7. No move is dropped for its size.** An amount above 0 that the rules of the step give a line is moved, is in the record, and changes the levels of the Pools at its ends, however small it is. This holds for every kind of line: from a Pool into a Gate, a Converter, a Drain or an End; from a Source into a Pool; between routers; from a router into a Pool; and for the amount a timetable gives a line in a step.

**E8. An amount a plan is to move is not made 0 for being at or under `1e-9`.** The searches of a plan pull what a source Gate still needs while that is above 0.

**E9. A node has fired where what it actually moved in the step is above 0.** The display threshold has no part in it: a node whose every move is at or under `1e-9`, and which therefore has no event, has fired.

| node | fired where |
|---|---|
| Source | the record has a move from it |
| Drain | the record has a move into it |
| End | as a Drain; **an End that takes an amount above 0 ends the run, however small the amount** |
| Gate | its throughput in the record is above 0 |
| Converter | the record has a move into it or out of it |

What reads a firing reads this one: the firing pulse of the interface, and a state connection that asks whether its source fired (a `trigger`, and a `label` with `when: "source-fired"`; SEMANTICS-S.md, SEMANTICS-S3.md). So a node can pulse, an End can stop a run, and a state connection can act in a step that shows no event; §E17 is what tells a user why.

**What a user sees of §E7**: a Pool's value can change in a step that shows no event. A Source that pushes `5e-10` a step fills a Pool by it (by the double of `5e-10`); a Drain that pulls about `1.157e-10` a step from a Pool of 1000 leaves `999.9999999998843`.

## Rates

**E10. A rate above 0 is a line.** A line whose rate is above 0 is live for the groups the step plans, is a weight of the shares of the Gate it leaves, is an input or an output of the Converter it enters or leaves, and its target is asked what it accepts. Its size does not matter. A line whose rate is 0 is no line this step. This holds for a rate that is written, for a Parameter's value, for a percent as a Gate's weight, and for a rate a unit converts: each is read as the same rate written.

This makes general what SEMANTICS.md §6 (erratum, part 11; issue #576) says of a Converter's coefficient in a plan: it is asked `> 0`, not `> epsilon`. Before, a line whose rate was at or under `1e-9` was read two ways: it was not live for the groups and its target was not asked, and it was still a weight of its Gate's shares; a share at or under `1e-9` was then dropped without a record. It is now read one way.

What follows, each of them the rule that every other line already has:

- A Gate shares what it moves over **all** its lines of a rate above 0. Where the target of one of them cannot take its share (a Gate with no line out, a Pool at its capacity through a Gate that only passes on, a `pull all` Gate that cannot reach what its lines ask), the Gate is held, wholly or to what that target takes, as it is by a line of a rate of 1.
- A Converter needs every one of its inputs. An input of a rate of `1e-9` is an input: where it brings nothing the Converter does not run; where it brings half of what a run takes the Converter makes half a run.
- A Converter's recipe is its rates. A Converter whose only input is a line of `1e-9` and whose output is a line of 1 makes 1 from `1e-9`.
- A rate that changes during a run is a timetable's, and a timetable may stand only on a line from a Source into a Pool or from a Pool into a Drain or an End. So a rate that falls through `1e-9` during a run is an amount pushed or drained (§E7), never a Gate's weight or a Converter's input.

No bundled example has a line of a rate at or under `1e-9`, and this rule changes no result of theirs.

## `pull all`: what a node may be short of

**E11. The absolute epsilon is kept for a node that asks more than it.** A `pull all` node moves what its lines ask or nothing (SEMANTICS.md §9). For a node whose lines ask more than `1e-9` in all, "what its lines ask" is met where what the node brings is under it by no more than `1e-9`, an absolute amount: `T < demand − epsilon` is the test that stops it, as before (§6, the Gate's turn, step 4), asked on exact sums.

**E11a. A node that asks `1e-9` or less in all may be short by `1e-9` of what it asks.** An absolute `1e-9` there would be the whole of the demand: the node could never be short, and would run on any part of what it asks. So where a `pull all` node's whole demand `D` is at or under `1e-9`, the allowance is `D × 1e-9`: the test that stops it is `T < D − D × 1e-9`. That is room for a Pool whose double is a hair under the decimal its line writes (the double of `3e-13` is under `3e-13` by about one part in `10¹⁶`), and for nothing a person would call a shortage. The demand is all the node asks in the step: every line of a Gate or of a Drain or an End, every line a `push all` Source pushes, a Gate's fixed demand in a plan.

This holds at every place a `pull all` amount is tested: a `push all` Source's room; a `pull all` Drain and End; the source Gate of a tree and of a piece; the planned Gate with two supplies (§E12) and its fixed demand; a planned source Gate at its own turn; a Gate outside every plan. A `pull all` Converter is not among them: it is tested on a part of a run (`f < 1 − epsilon`, §E19), which does not depend on the size of the amounts.

**The edge of §E11, stated and not mended.** A little above `1e-9` the absolute allowance is still a large part of the demand: a Gate that asks `1.4e-9` of a Pool that holds `5e-10` is `9e-10` short, within the epsilon, and takes the `5e-10`. Before revision 16 an amount under `1e-9` was 0 and that Gate stopped; with `1.2e-9` in the Pool it ran, on the `1.2e-9`, then as now. A Gate that asks exactly `1e-9` is on the other side: a Pool that holds half of it leaves it short, and nothing moves.

**E11b. A node that runs short takes what its Pools hold, and no more.** Where a `pull all` node runs within its allowance, each of its lines moves what it asks or, where its Pool is short, what the Pool still holds; lines off one Pool take in their order. A Gate, a Drain and an End alike; a `push all` Source pushes the room. So the record never takes a Pool under 0 (§E3). (Before, a `pull all` Drain or End that was short within the epsilon was recorded as taking all it asked: a Pool of `2.9999999995` and a line of 3 gave an event of 3 and a level `5e-10` under 0, which the commit's clamp took. It is recorded as `2.9999999995` now.)

**E12. In the plan of a `pull all` Gate with two supplies, the allowance is for a Pool that is short, and never for room that is short.** Such a Gate (one that a router feeds and that has Pool lines of its own, or that two routers feed) has a fixed demand: every supply at its full reach. Where that does not fit, each supply is filled again as far as it goes; the group runs if, and only if,

1. what the supplies bring together is under the fixed demand by no more than the allowance of §E11 or §E11a, and
2. every supply that brings less than its full reach could not bring more even with the rooms of the Pools below left out of the question, the other supplies standing as they are.

Where a supply could bring more if the rooms were not asked, it is the room that holds it; the fixed demand is not made smaller for that, and the group moves nothing. This keeps SEMANTICS.md §6, erratum part 3 ("the group moves at exactly that point or not at all") and part 9 ("A net inflow of any size is refused") for room, and gives the allowance of §9 to a Pool that holds a hair less than its line asks.

On the other paths (the source Gate of a tree or of a piece, a Gate outside every plan, a Drain, an End, a `push all` Source) the allowance is asked of what the node brings in all, whatever holds it back: a Pool that is short or room that is short. That is as before revision 16, and is not changed here.

## Capacity

**E13. A Pool's capacity is tested exactly.** A move into a Pool is sized by the Pool's exact room before it is made. There is no tolerance and no clamp: where the room is under what a rule asks, by however little, the rule gets the room and no more, or, where the rule is all or nothing, nothing.

**E14. A net inflow above 0 asks the room, whatever its size.** Where a Converter makes into a Pool more than it takes from it in a run, on balance, by any amount above 0, the Pool's room bounds the run: at the Converter's own turn, for a Pool it reaches by two paths, and in a plan. Whether the balance is above 0 is read off the rates as fractions, so that rates that balance as they are written (`0.3` taken, `0.1` and `0.2` made) are not a net by the rounding of their doubles.

Two things follow and are meant. Both come of one fact: a capacity and a level are doubles, and the difference of two doubles need not be the difference of the decimals a person wrote. §E13 takes the doubles' difference as the room.

- A `pull all` group puts `0.001` and `0.007` into a Pool that holds `0.001` of a capacity of `0.009`. As doubles the capacity less the level is `7e-19` under the `0.008` that the written rates ask. The room is short; by §E12 the group moves nothing. (Before, it moved: in doubles `0.009 − 0.001` is not under `0.008`.)
- A Pool holds `1.3e-11` of `1.6e-11`; as doubles that leaves `2.9999999999999993e-12`, under the `3e-12` a tree of routers needs on balance. The tree is planned at that room, and a Gate of it that pulls its lines in order does not come to its last line. No Pool leaves its bounds.

## What is shown

**E15. An event is a move above the display threshold.** The events of a step are the moves of its record whose amount, as the double nearest it, is above `1e-9`, each shown as that double, in the record's order. A move at or under the threshold is in the record (§E2) and is not an event.

**E16. The notices' threshold is its own.** A notice that names an amount (an amount that stayed with a router, an amount a Converter could not use) is given for more than `1e-6`. That is a display threshold of the notices and has nothing to do with what is moved or with a capacity; the exact amount under it is in the record all the same. The reports that are worked from the events (a table line's moved amount, a run rule's shares, the outflow by kind) read what is shown.

**A Gate's reported state follows its firing.** The state a Gate reports for the step (issue #477: `idle`, `full`, `partial`, `held`) is given at the precision of what it reports, `1e-6`, and, where the Gate's own amounts are at or under that, at `1e-6` of them. It never contradicts §E9: a Gate that moved anything reads `full` or `partial`, and one that moved nothing reads `idle` or `held`, however small the amounts. The numbers beside it are rounded to six decimals, and an amount under that precision is given to six significant digits, so that a Gate that passed `5e-10` on does not read as having moved 0.

**E17. A move that is not shown is marked.** Because of §E7 a Pool's value can change, a node can fire and a run can end with no event. The interface says so in two places:

1. **The step.** Where the step that was just committed has moves that are not shown, the run's list of messages carries one line with their number.
2. **The Pool.** Where one of those moves reached a Pool, that Pool's panel lists the moves of the step that reached it and are not shown, each with the node at its other end, its direction and its amount, and the Pool's net change over all the step's moves, shown or not.

Both are read from `report.moves`. Neither is an event: the animation, the line labels and the events' threshold are unchanged. Where every move of a step is shown, neither appears.

**E18. A stored value on screen is read as before.** SEMANTICS-M4.md §M4-5 is unchanged: a surface that re-expresses an engine value takes the double's exact value in the unit, shows at most 15 significant digits, and says `≈` when the text is not the value. What changes is the stored double itself, in its last place now and then (§E4, §E5), and with it, where two neighbouring doubles lie on either side of a rounding of the fifteenth digit, the last digit shown.

## A Converter's stated run target

**E19. Unchanged.** Where a run rule gives a Converter a target, a target at or under the floor is no run (SEMANTICS-M6.md §M6-5), and a `pull all` Converter runs where it reaches its target to within the epsilon as a part of a run (`f < 1 − epsilon` stops it). These are fractions of a run, not amounts. A fraction of a run that the engine works out from a supply or a room is not held to that floor (issue #580).

## What does not change

- The order of a step: Phase 0 (state connections), Phase 1 (Sources), Phase 2 (the routers in their order), Phase 2.5, the commit; the snapshot `S`, and that a pull is measured against it and against what earlier nodes took (SEMANTICS.md §2, §10).
- Which groups are planned and how a plan is ordered; a Gate's deterministic and probabilistic shares; a Converter's one part of a run on every line (I2); that a router holds nothing between steps (I5); that a step is a pure function (I6); the priority rules (I7).
- What a `pull any` node does where an input is short.
- The refusals before a run.
- What a `label` does.
- The file formats, the digest, the model versions.

## E-open: what this document does not settle

Each of these is a boundary that exists with the rules above. Each has a test that states it.

### E-open 1. A loop that balances at one number only

A group that returns to a Pool at its capacity exactly what it takes from it fits at **one** number of its plan and at no other. Where that number is a double, the group runs. Where it is not, the search over doubles finds no number that fits and the group is planned at 0. It has nothing to do with the epsilon, and it was so before this document, at ordinary sizes.

Pools `p0` 8, `p1` 2, `p2` 11 of a capacity of 11. `p2 →3→ g0`, `p0 →2→ g0`, `g0 →5→ c1`, `c1 →2→ p2`, `c1 →1→ p2`. The Gate pulls `p0` first. At the number 5 it takes 2 of `p0` and 3 of `p2` and the Converter returns 3 to `p2`; at any number under 5 it takes less than 3 of `p2` and more than that comes back.

| every amount times | the number | what moves |
|---|---|---|
| 1 | 5, a double | 3, 2, 5, 2, 1 |
| 10⁻¹ | 0.5, a double | 0.3, 0.2, 0.5, 0.2, 0.1 |
| **10⁻³** | 0.005, not a double | **nothing** |
| **10⁻¹²** | 5e-12, not a double | **nothing** |

What would close it is not decided.

### E-open 2. A group with two supplies, far under `1e-9`: a line that should move does not

Not E-open 1: it runs at 10⁻³. A Converter `c0` and two Gates `g1`, `g3` are planned as one group. `g1` has a line of 6 from a Pool that holds 1 and a line of 8 from a Pool that holds 12 of 14; what `g1` moves goes through `g3` back into the second Pool. At scale 1 and at 10⁻³ the second line moves 8 times the scale. At 10⁻¹² the plan stops at what the first Pool holds and the second line moves nothing. Nothing is lost and no Pool leaves its bounds. The cause is not found.

### E-open 3. Issues that stand apart

- **Issue #581**: a line from a Source into a Converter, and a Converter with no input line above another Converter. Unchanged; §E14 touches that turn (the room is asked there for a small net) and no more. One thing about it is new to see: such a Converter runs wherever its output Pool has any room at all, and takes its Pool lines in full for it. Where every amount is under `1e-9`, a Pool that reads full can have one last place of room (its level and its capacity are two doubles), and the Converter then takes its lines for nothing made.
- **Issue #582**: a Pool that a `label` lowers before the moves (§E4, §E6).
- **Issue #572, the remaining case**: one generated graph in which a step moves less than before at amounts of 10⁸ and 10⁹; open on the issue.

### What was open in the draft of this document and is a rule now

- A `pull all` node whose whole demand is at or under `1e-9` ran on any part of what it asked, because an absolute `1e-9` could not stop it. §E11a. (Before revision 16 nothing moved in such a document at all, and a Pool value under `1e-9` was made 0 at the end of the step.)
- A `pull all` Drain or End that was short within the epsilon was recorded as taking all it asked. §E11b.

## What this replaces

| the earlier text | now |
|---|---|
| SEMANTICS.md §5: "Any computed magnitude with `|x| < epsilon` is normalised to exactly `0`" | does not hold for a move (§E7). It stands for what is shown (§E15) |
| SEMANTICS.md §5 and I3: a clamp that "only ever corrects sub-`epsilon` drift" | no clamp of a move's result (§E4, §E13); I3 holds with no clamp, issue #582's lower hold apart |
| SEMANTICS.md §2: `events` are transfers with `amount > epsilon`; `fired` moved `> epsilon` | `events`: the same threshold, a matter of display (§E15). `fired`: above 0 (§E9) |
| SEMANTICS.md §6, the Gate's turn, step 5 "if `T > epsilon`"; the Converter's "`epsilon`-normalised", "if `f > epsilon`" | a throughput above 0 is moved (§E7); a part of a run is not an amount (§E19) |
| SEMANTICS.md §6 erratum part 11 (issue #576): a Converter's coefficient in a plan is asked `> 0` | made general: every rate (§E10) |
| SEMANTICS.md §7: an End, "any arrival `> epsilon` ends the run" | any arrival above 0 (§E9) |
| SEMANTICS.md §9: `pull all` | kept for a node that asks more than `1e-9` (§E11); for one that asks less the allowance is `1e-9` of its demand (§E11a); a node that runs short takes what its Pools hold (§E11b); for a planned Gate with two supplies the allowance is for a Pool that is short only (§E12) |
| SEMANTICS.md §6 and §9, a `pull all` Drain or End that runs: every line in full | where it runs short within its allowance, each line takes what its Pool holds (§E11b) |
| The Gate state of issue #477: `idle` where `available ≤ ε`, `held` where `moved = 0` at six decimals | follows the firing, at `1e-6` or `1e-6` of the Gate's own amounts (§E16) |
| SEMANTICS-M4.md §M4-3: "An engine value at or below the engine's floor of 10⁻⁹ per step moves nothing" | does not hold (§E7) |
| SEMANTICS-M4.md §M4-5: an engine value on screen | unchanged (§E18) |

## Tests

- `src/engine/exactMoves.test.ts`: on generated graphs at several scales, from the record of moves alone: a Gate's moves in equal its moves out; a Converter is at one part of a run on all its lines; every Pool's level is within its bounds after every move; every stored value is the double nearest the exact level; the events are the record above the threshold; a node has fired exactly where the record has a move of its own; a Gate's reported state says it passed something on exactly where it fired.
- `src/engine/firedSmallMoves.test.ts`: §E9 for each node kind, for an End, and for the state connections that read a firing.
- `src/engine/exactMovesCases.test.ts`: §E7, §E8, §E10 to §E14 as hand cases.
- `src/engine/pullAllShort.test.ts`: §E11, §E11a and §E11b: a third short stops at every size, on every kind of `pull all` node; a node that can have all it asks runs at every size; the edge of the absolute epsilon just above `1e-9`; what a Drain and an End record.
- `src/engine/gateStateSmall.test.ts`: a Gate's reported state against its firing, at four sizes.
- `src/engine/exactMovesOpen.test.ts`: E-open 1 and 2, each as what runs today and as an expected failure that states what is to be.
- `src/model/engineValues.test.ts`: a rate with a unit under the display threshold moves.
