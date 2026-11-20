# SEMANTICS-E — `loop-exact/1`: a step's moves are exact

```
Spec ID: loop-exact/1
Status:  Normative from engine revision 16. Every E-open is settled: 1, 2 and 4 by engine revisions, 3 and 5 as stops that are meant
Engine:  revision 16; §E19's rule for a group is of revision 17, §E20 of revision 18, §E21 of revision 19, §E11's reading of a planned `pull all` Converter of revision 20, §E22 of revision 21 (SEMANTICS-W2.md §W2-1)
```

**In force with engine revision 16 (issue #572).** The rules E1 to E19, with E11a and E11b, are what that engine does and what its tests hold (§E19's rule for a group from revision 17). §E20 holds from engine revision 18 (issue #581), §E21 from engine revision 19 (issue #582), §E11's reading of what a planned `pull all` Converter received off the record from engine revision 20 (issue #572; it settles E-open 2 and 4), and §E22 from engine revision 21 (issue #572; it settles E-open 1). E-open 3, and the remaining case of issue #572 that E-open 5 names, are stops the rules make, and they are meant: §E13, §E14 and §E11 for the first, §E5 and §E11 for the second. Their values are written below, and their tests hold them as they are. No boundary of this document is open.

This document changes how a step is **worked out and recorded**, for every model version. It does not change what a document means, what a file holds, or the digest. It extends [`SEMANTICS.md`](SEMANTICS.md) and its companions and replaces the passages listed under "What this replaces". Where it says nothing, they hold as written.

The words of `SEMANTICS.md` are kept: Pool, Gate, Converter, Source, Drain, End, `pull any`, `pull all`, the snapshot `S`, the phases of a step, the invariants I1 to I7.

Rules are numbered E1 to E22 (with E11a and E11b) and cited as `§E7`. The number E-open marks what this document did not settle when it was written; each now says how it is settled.

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

**E3. A Pool's level.** A `label` is not a move and is not in the record. What a `label` does to a Pool is unchanged (SEMANTICS-S2.md §S2-9, SEMANTICS-S3.md §S3-6): in Phase 0 the Pool's value becomes its stored value at the start plus that phase's label term (the labels' `delta` and the phase's one `clampAdjustment`), worked in doubles. **The moves start from that value**, read exactly as a double's value. At any moment of Phases 1 and 2 a Pool's level is that value, plus every move of the record into it so far, less every move out of it so far. After the last move it is the Pool's exact level of the step. The level is within `[0, capacity]` at every moment, exactly (§E13), a Pool a Phase-0 `label` has lowered included, since the pulls read the level the labels left (§E21).

**E4. What is stored.** A Pool's value after the moves is the double nearest its exact level (a tie between two doubles goes to the even one). There is no clamp: the level is within the Pool's bounds already, and so is the double nearest it. The `afterPull` labels (Phase 2.5) are then applied to that double as before, with their own `delta` and `clampAdjustment`; the result is the Pool's stored value at the end of the step.

(Until engine revision 19 there was one exception, issue #582. A Pool that a Phase-0 `label` had lowered was still pulled as it stood in the snapshot; its exact level could then go under 0 within the step, and the value stored was held at 0, an amount that §E3's bounds, §E4's "no clamp" and §E6's identity left out. §E21 removes it.)

**E5. The next step starts from what is stored.** The exact level is not carried over; the stored double is, and it is read exactly. So a step is exact from its start, and a run is a sequence of exact steps with one rounding of each Pool between them. **A run is therefore not the run of the rationals**: over many steps the stored values drift from what exact arithmetic over the whole run would give, by about a last place a step at most, as they did before.

**E6. Conservation, per step: I1′ as it is written, with the resource term exact.** The identity is the present one (SEMANTICS-S2.md §S2-9; per Pool and per label phase, SEMANTICS-S3.md §S3-6), and the label terms are in it as before, for a `label` that raises a Pool as for one that lowers it:

```
Σ Pool(after) = Σ Pool(before) + Σ Source push
              + ( Σ label delta + Σ per-target clampAdjustment )   ← both label phases, unchanged
              − Σ Drain/End pull − Σ Converter net loss
```

and for one Pool: `final − start = (Σ moves in − Σ moves out) + the Phase-0 label term + the afterPull label term`.

What changes is the resource term only: `Σ Source push`, `Σ Drain/End pull`, each Converter's recipe difference at the part of a run it made, and a Pool's `Σ moves in − Σ moves out` are sums over the record, exact. Between the value the moves start from and the exact level after the last move the identity holds with no error at all. On the stored doubles it holds to the one rounding of §E4; the two label terms are sums of doubles as before.

There is no exception since engine revision 19 (§E21). Until then the lower hold of issue #582 was one: where a Phase-0 `label` had lowered a Pool and the pulls, which read the snapshot, took more than was left, the exact level went under 0 and the stored value was 0, and the identity was off by exactly the amount of that hold (0.7 for a Pool of 1 set to 0.3 and pulled of 1).

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

**What a planned `pull all` Converter has received is read off the record.** Its part of a run, for that test, is what arrived (its own takes and what the members before it handed it) over what a full run takes, both exact (§E1, §E7). An amount at or under `1e-9` counts as what it is: the threshold is one of display (§E15). (From engine revision 20, issue #572. Until then the verdict read a sum of the doubles beside the amounts, and the double beside an amount at or under `1e-9` is 0: such a Converter read "nothing arrived" and stopped, and its group with it, at sizes where every amount is that small, E-open 2 and 4 below.)

**The edge of §E11, stated and not mended.** A little above `1e-9` the absolute allowance is still a large part of the demand: a Gate that asks `1.4e-9` of a Pool that holds `5e-10` is `9e-10` short, within the epsilon, and takes the `5e-10`. Before revision 16 an amount under `1e-9` was 0 and that Gate stopped; with `1.2e-9` in the Pool it ran, on the `1.2e-9`, then as now. A Gate that asks exactly `1e-9` is on the other side: a Pool that holds half of it leaves it short, and nothing moves.

**E11b. A node that runs short takes what its Pools hold, and no more.** Where a `pull all` node runs within its allowance, each of its lines moves what it asks or, where its Pool is short, what the Pool still holds; lines off one Pool take in their order. A Gate, a Drain and an End alike; a `push all` Source pushes the room. So the record never takes a Pool under 0 (§E3). (Before, a `pull all` Drain or End that was short within the epsilon was recorded as taking all it asked: a Pool of `2.9999999995` and a line of 3 gave an event of 3 and a level `5e-10` under 0, which the commit's clamp took. It is recorded as `2.9999999995` now.)

**E12. In the plan of a `pull all` Gate with two supplies, the allowance is for a Pool that is short, and never for room that is short.** Such a Gate (one that a router feeds and that has Pool lines of its own, or that two routers feed) has a fixed demand: every supply at its full reach. Where that does not fit, each supply is filled again as far as it goes; the group runs if, and only if,

1. what the supplies bring together is under the fixed demand by no more than the allowance of §E11 or §E11a, and
2. every supply that brings less than its full reach could not bring more even with the rooms of the Pools below left out of the question, the other supplies standing as they are.

Where a supply could bring more if the rooms were not asked, it is the room that holds it; the fixed demand is not made smaller for that, and the group moves nothing. This keeps SEMANTICS.md §6, erratum part 3 ("the group moves at exactly that point or not at all") and part 9 ("A net inflow of any size is refused") for room, and gives the allowance of §9 to a Pool that holds a hair less than its line asks.

That distinction is the rule of this path. On the other paths (the source Gate of a tree or of a piece, a Gate outside every plan, a Drain, an End, a `push all` Source) the test is on what the node brings in all, as before revision 16. Where it is room that is a last place short on such a path, the node's number is first held to the room (§E13), and then the node is tested on what it brings in all. E-open 3 is that case, and its stop is meant.

## Capacity

**E13. A Pool's capacity is tested exactly.** A move into a Pool is sized by the Pool's exact room before it is made. There is no tolerance and no clamp: where the room is under what a rule asks, by however little, the rule gets the room and no more, or, where the rule is all or nothing, nothing.

**E14. A net inflow above 0 asks the room, whatever its size.** Where a Converter makes into a Pool more than it takes from it in a run, on balance, by any amount above 0, the Pool's room bounds the run: at the Converter's own turn, for a Pool it reaches by two paths, and in a plan. Whether the balance is above 0 is read off the rates as fractions, so that rates that balance as they are written (`0.3` taken, `0.1` and `0.2` made) are not a net by the rounding of their doubles.

Three things follow and are meant. All come of one fact: a capacity and a level are doubles, and the difference of two doubles need not be the difference of the decimals a person wrote. §E13 takes the doubles' difference as the room.

- A `pull all` group puts `0.001` and `0.007` into a Pool that holds `0.001` of a capacity of `0.009`. As doubles the capacity less the level is `7e-19` under the `0.008` that the written rates ask. The room is short; by §E12 the group moves nothing. (Before, it moved: in doubles `0.009 − 0.001` is not under `0.008`.)
- A Pool holds `1.3e-11` of `1.6e-11`; as doubles that leaves `2.9999999999999993e-12`, under the `3e-12` a tree of routers needs on balance. The tree is planned at that room, and a Gate of it that pulls its lines in order does not come to its last line. No Pool leaves its bounds.
- A `pull all` Gate heads a piece of a plan with two supplies. A whole run of it puts into a Pool, on balance, exactly that Pool's room as the decimals stand. Where the doubles leave the room a last place short, the piece fits only at a number far under the Gate's demand, and the Gate moves nothing. The rest of the group runs (E-open 3).

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

**E19. The floor stays, and it is the group's.** Where a run rule gives a Converter a target, a target at or under the floor is no run (SEMANTICS-M6.md §M6-5), and a `pull all` Converter runs where it reaches its target to within the epsilon as a part of a run (`f < 1 − epsilon` stops it). These are fractions of a run, not amounts. A fraction of a run that the engine works out from a supply or a room is not held to that floor (issue #580).

A group runs at one number, so the floor is asked of the group and not of one member: **a planned group one of whose Converters states a target at or under the floor stands still as a whole.** Its number is 0 before anything is claimed, taken or handed on; no line of it moves, nobody in it fires, and it reads `stopped`, `floor`, as a Converter alone does. (Engine revision 17, issue #586. On revision 16 the floor was asked of the one member at its turn, after its takes: in `tank → a → b → store` with a target of `5e-10` on `b`, `a` ran and handed on, and `b` took that and its own line and made nothing, the group reading `met`. At a target of exactly `1e-9` revision 15 lost too.) A member that takes its inputs and makes nothing of them is never a state of a group.

A `pull all` Converter that can have all it asks runs at every size alone, behind a Gate, in front of a Gate, and (from engine revision 20, §E11) in front of another Converter.

## A line from a Source into a Converter

**E20. A line from a Source is no input of a Converter.** A Source pushes into Pools only; along a line into a Converter it moves nothing, and the step says so (SEMANTICS.md §6, the Source's diagnostic, which stays). So the line is not one of the Converter's inputs. The Converter runs as it would without the line: its other lines set its part of a run, its Pool lines give that part of their rates and no more, what it makes fits the room of its outputs, and nothing is lost. A `pull all` Converter runs where its other lines fill a run, and stands still where they do not. A Converter whose only input is such a line has no input and does not run. (Engine revision 18, issue #581.)

The same holds in a planned group, and for a member left with **no input line** at all: it cannot run, so the group stands still before anything is taken, as for a member behind a router that delivers nothing. And it holds for a recipe: the balance of a conserved kind (SEMANTICS-M3.md §M3-INV-2) is read without the line, since nothing comes in on it.

(On revision 17 the line counted in a full run. With 2 from a Source and 3 from a Pool for 5, the Converter took the 3 and made 3, three fifths of a run; with room for only 1.7 it took the 3 and lost 1.3, with a notice; a `pull all` Converter never ran; in a planned group the members ran at different parts with no notice, and a member with no input let the next one take its Pool line and make a quarter. Under a conserved kind the recipe was balanced on the 2 that never came.)

## A Pool a `label` edits before the moves

**E21. The pulls read the level the Phase-0 labels left.** Where a `label` edits a Pool in Phase 0 (SEMANTICS-S.md §S5), what a line may take of that Pool in the step is the level the labels left, after their one clamp, less what the step has taken of it (and what plans have claimed of it): the value the moves start from (§E3). So an amount a label removed cannot be taken in that step, and an amount it added can. This holds for every pull alike: a Gate, a Converter, a Drain or an End, a planned group, an `all` or `%` line, and the verdict of a `pull all` node. What a Source pushes into the Pool in Phase 1 is still not there for the pulls of the same step, as for every Pool (SEMANTICS.md §2). A Pool no Phase-0 `label` edits is read off the snapshot, as before; an `afterPull` label (Phase 2.5) comes after the moves and does not touch them. (Engine revision 19, issue #582.)

With it the pulls and a Pool's room read one level (the room already did, §E3), the level stays within the Pool's bounds at every move (§E3), nothing is held at the commit (§E4), and I1′ holds for such a Pool as for any other (§E6).

(Until engine revision 19 the pulls read the Pool as it stood in the snapshot. A Pool holding 1 that a label set to 0.3 gave a Gate that asked 1 all of it: its level went under 0, the commit held it at 0, and the 0.7 was made from nothing, outside I1′ and in no report. A Pool a label raised gave nothing of the raise in that step: in SEMANTICS-S.md §S11 Case S-C the Drain took 0 at step 1 and the Tank committed 0, 8, 4, 4, …; it now takes 4 at step 1 and the Tank commits 0, 4, 4, ….)

## A plan's number at its exact cap

**E22. Where every exact margin holds at the exact cap, the plan's number is the cap.** A planned group's number has an exact cap: each Converter's run (its stated target, 1 without one) and each source Gate's whole demand, over that member's coefficient, as fractions of the written rates. The plan's margins are the source Gates' needs, the Converters' supplies, and each capped Pool's level at every turn of the commit order against its exact room, all asked of the ledger (§E3, §E13). Where every margin holds at the cap, the cap is the largest number that fits, and the plan takes it. The search over doubles does not stop it there. Where a margin is passed at the cap, the plan is searched as before: the largest double that fits, then the exact point below it where the first margin is met. (Engine revision 21, issue #572.)

It matters for a group that fits at its cap and at no smaller number above 0. A group like that returns to a full Pool, at its cap, exactly what it takes of it. Under the cap more comes back than the Pool gave; over it the Pool's line gives no more. Where the cap is not a double, no double fits. The search ended at 0 before the cap was asked, and the group stood still.

This rule asks one point, the cap. A group whose numbers that fit include a single point under the cap, where some other margin is met exactly, is not covered by it.

## What does not change

- The order of a step: Phase 0 (state connections), Phase 1 (Sources), Phase 2 (the routers in their order), Phase 2.5, the commit; the snapshot `S`, and that a pull is measured against it and against what earlier nodes took (SEMANTICS.md §2, §10).
- Which groups are planned and how a plan is ordered; a Gate's deterministic and probabilistic shares; a Converter's one part of a run on every line (I2); that a router holds nothing between steps (I5); that a step is a pure function (I6); the priority rules (I7).
- What a `pull any` node does where an input is short.
- The refusals before a run.
- What a `label` does.
- The file formats, the digest, the model versions.

## E-open: what this document did not settle, and how each is settled

Each of these is a boundary that existed with the rules above, and none of them was resolved by revision 16. Each has a test that states it.
- E-open 2 and 4 are settled from revision 20 (§E11), and E-open 1 from revision 21 (§E22).
- E-open 3 and the remaining case of E-open 5 are settled as stops that are meant, with no change to the engine (2026-11-20).

They keep their numbers here.

### E-open 1. Settled in engine revision 21 (§E22)

A group that returns to a Pool at its capacity exactly what it takes from it fits at **one** number of its plan and at no other. Where that number was a double the group ran; where it was not, the search over doubles found no number that fits and the group was planned at 0. It had nothing to do with the epsilon, and it was so before this document, at ordinary sizes.

Pools `p0` 8, `p1` 2, `p2` 11 of a capacity of 11. `p2 →3→ g0`, `p0 →2→ g0`, `g0 →5→ c1`, `c1 →2→ p2`, `c1 →1→ p2`. The Gate pulls `p0` first. At the number 5 it takes 2 of `p0` and 3 of `p2`, and the Converter returns 3 to `p2`. At any number under 5 it takes less than 3 of `p2`, and more than that comes back.

The number 5 is the plan's exact cap (`c1`'s run, `g0`'s whole demand). Every bound of the search over doubles was the double nearest 5 times the scale. At 10⁻², 10⁻³ and 10⁻⁹ that double is above the cap, and `p2`'s line gives no more than 3 times the scale. At 10⁻⁶ and 10⁻¹² it is under the cap, and more comes back than `p2` gives. Either way the room was passed at it, and the search ended at 0. Since revision 21 the cap is asked first (§E22):

| every amount times | the number | what moved (revision 20) | what moves (revision 21) |
|---|---|---|---|
| 1 | 5, a double | 3, 2, 5, 2, 1 | the same |
| 10⁻¹ | 0.5, a double | 0.3, 0.2, 0.5, 0.2, 0.1 | the same |
| 10⁻², 10⁻³, 10⁻⁶, 10⁻⁹, 10⁻¹² | 5 times the scale, not a double | nothing | 3, 2, 5, 2, 1 times the scale |

This graph is seed 257 of the generated graphs. Seeds 0 to 9,999 of the plain graphs, of the graphs with Source lines and of those with lines of a small rate were each run at eight scales from 10⁻¹² to 10⁹ for four steps. Only seed 257 changes, as a plain graph and as a graph with Source lines.

### E-open 2. Settled in engine revision 20 (§E11)

A group with two supplies (a generated graph with Source lines, seed 777) moved a line at scale 1 and at 10⁻³ and not at 10⁻¹². The cause, found on 2026-11-19, was E-open 4's: the group's `pull all` Converter `c2`, whose amounts were all at or under `1e-9` from 10⁻¹⁰ down, read "nothing arrived" and stopped, and the part of the group that depended on it with it (with `c2` set to `pull any` the group ran at every size). Its verdict is read off the record now, and the group moves at 10⁻¹⁰ to 10⁻¹² what it moves at scale 1, times the scale.

### E-open 3. Settled: the stop is meant (§E13, §E14, §E11)

A generated graph with lines from a Source (seed 3763), step 1, planned as a plan with two supplies: the Gate `g2` takes from `g0`, from `g1` and from its own lines. The `pull all` Gate `g1` heads a piece of that plan. It takes 1 and 6 of `p1`, then 1 of `p3`, and hands half of its 8 back into `p3`. `p3` holds 11 of a capacity of 17, and a Source pushes 3 into it first, so its room is 3. That is exactly what a whole run of `g1` puts into it on balance: 4 in, 1 out. Under 7, `g1` takes nothing of `p3`, so the numbers that fit are those up to 6; at 8 it fits again.

The path that holds it, found on 2026-11-19:

1. The room is the doubles' capacity less their level less the push, tested exactly (§E13, §E14). At some scales that is a last place under 3 times the scale.
2. There, 8 does not fit. The plan searches the piece's number exactly, and the largest that fits is just under 6.
3. `g1`'s `pull all` test asks that number against its demand of 8. This is the test of a piece's `pull all` source Gate. The number is short by far more than the absolute epsilon (§E11), and the piece is planned at 0.
4. `g1` moves nothing, and the rest of the group runs: `g2` takes 7 of its own line `e7` in place of 6.

This is §E14's consequence again, on a piece of a plan with two supplies. The room, as the doubles leave it, is short of what the written rates ask, and an all-or-nothing rule gets nothing. It is meant, and the engine is not changed for it. It has nothing to do with small amounts:

| every amount times | `p3`'s room less 3 times the scale | what `g1` moves |
|---|---|---|
| 1, 10³, 10⁶, 10⁹ | 0 | 1, 6 and 1, and 4 into `p3`, times the scale |
| 10⁻², 10⁻³, 10⁻⁵, 10⁻⁶, 10⁻⁹, 10⁻¹¹, 10⁻¹³, 10⁻¹⁴ | a last place over (`1.2e-17` at 10⁻², `7.9e-25` at 10⁻⁹) | the same |
| 10⁻¹, 10⁻⁴, 10⁻⁷, 10⁻⁸, 10⁻¹⁰, 10⁻¹², 10⁻¹⁵ | a last place under (`−1.3e-16` at 10⁻¹, `−1.9e-23` at 10⁻⁸) | nothing |

(Until 2026-11-20 this was written as a boundary whose test was not found, with a test that failed as expected; the stops at 10⁻¹, 10⁻⁴ and 10⁻⁷ were not named.)

### E-open 4. Settled in engine revision 20 (§E11)

`A →8→ c0` (`pull all`) `→3→ c1 →4→ Q`, and `B →3→ c1`, the Pools holding 8 and 12, ran at scale 1 and at 10⁻⁹ and moved nothing from 10⁻¹⁰ down, where a `pull any` Converter in the place of `c0` ran. The verdict of the planned `pull all` Converter was read off a sum of doubles kept beside the exact amounts, and the double beside an amount under the display threshold is 0, so it read less than arrived and stopped. It is read off the record now (§E11), and the group runs at every size as with `pull any`; a real shortfall still stops it.

That mend had been tried once and taken out: read off the exact amounts, the verdict let such a group run into a member behind it whose stated run target was at or under the floor, which dropped what it was handed (`3.5e-4` of water over 720 steps of the desalination example with no demand). Since revision 17 such a group does not run at all (§E19), and with the mend that example's failure case keeps every unit of water: in 720 steps it runs differently from revision 19 from step 174 on, the water in its Pools is its start plus what came in less what left, and no amount is held or lost.

### E-open 5. Issues that stood apart

- **Issue #572, the remaining case** (a generated graph, seed 2950): settled as a stop that is meant (§E5, §E11), with no change to the engine.
  - The `pull all` Gate `g0` asks 5 of `p1`. After three steps `p1` holds the double nearest its exact level, a last place under 5 times the scale, and the next step starts from that double (§E5).
  - At scale 1 that last place is `8.9e-16`, within the absolute epsilon, and `g0` takes what `p1` holds (§E11b).
  - At 10⁸ and 10⁹ it is `6e-8` and `9.5e-7`, more than the epsilon. At step 4 the group moves nothing, where revision 15 moved.

### What was open in the draft of this document and is a rule now

- A `pull all` node whose whole demand is at or under `1e-9` ran on any part of what it asked, because an absolute `1e-9` could not stop it. §E11a. (Before revision 16 nothing moved in such a document at all, and a Pool value under `1e-9` was made 0 at the end of the step.)
- A `pull all` Drain or End that was short within the epsilon was recorded as taking all it asked. §E11b.
- A line from a Source into a Converter, and a planned Converter with no input line (issue #581, named in E-open 5 until revision 18). §E20.
- A Pool a `label` lowers before the moves and that is then pulled (issue #582, named in E-open 5 and as the exception of §E4 and §E6 until revision 19). §E21.
- A planned `pull all` Converter whose amounts are at or under `1e-9` (E-open 2 and 4 until revision 20). §E11, what a planned `pull all` Converter has received.
- A group that fits at its exact cap only, where the cap is not a double (E-open 1 until revision 21). §E22.
- A `pull all` Gate whose piece is held by a room a last place short (E-open 3 until 2026-11-20). A stop that is meant: §E13, §E14, §E11.
- Issue #572's remaining case, seed 2950 (E-open 5 until 2026-11-20). A stop that is meant: §E5, §E11.

## What this replaces

| the earlier text | now |
|---|---|
| SEMANTICS.md §5: "Any computed magnitude with `|x| < epsilon` is normalised to exactly `0`" | does not hold for a move (§E7). It stands for what is shown (§E15) |
| SEMANTICS.md §5 and I3: a clamp that "only ever corrects sub-`epsilon` drift" | no clamp of a move's result (§E4, §E13); I3 holds with no clamp (from revision 19 with no exception, §E21) |
| SEMANTICS.md §2: `events` are transfers with `amount > epsilon`; `fired` moved `> epsilon` | `events`: the same threshold, a matter of display (§E15). `fired`: above 0 (§E9) |
| SEMANTICS.md §6, the Gate's turn, step 5 "if `T > epsilon`"; the Converter's "`epsilon`-normalised", "if `f > epsilon`" | a throughput above 0 is moved (§E7); a part of a run is not an amount (§E19) |
| SEMANTICS.md §6 erratum part 11 (issue #576): a Converter's coefficient in a plan is asked `> 0` | made general: every rate (§E10) |
| SEMANTICS.md §7: an End, "any arrival `> epsilon` ends the run" | any arrival above 0 (§E9) |
| SEMANTICS.md §9: `pull all` | kept for a node that asks more than `1e-9` (§E11); for one that asks less the allowance is `1e-9` of its demand (§E11a); a node that runs short takes what its Pools hold (§E11b); for a planned Gate with two supplies the allowance is for a Pool that is short only (§E12) |
| SEMANTICS.md §6 and §9, a `pull all` Drain or End that runs: every line in full | where it runs short within its allowance, each line takes what its Pool holds (§E11b) |
| The Gate state of issue #477: `idle` where `available ≤ ε`, `held` where `moved = 0` at six decimals | follows the firing, at `1e-6` or `1e-6` of the Gate's own amounts (§E16) |
| SEMANTICS-M4.md §M4-3: "An engine value at or below the engine's floor of 10⁻⁹ per step moves nothing" | does not hold (§E7) |
| SEMANTICS-M4.md §M4-5: an engine value on screen | unchanged (§E18) |
| SEMANTICS.md §2: "Every pull demand is measured against `S`" | except a Pool a Phase-0 `label` edits: against the level the labels left (§E21) |
| SEMANTICS-S.md §S11 and SEMANTICS-S2.md, Case S-C: the Drain pulls `min(4, S[T])`, T 0, 8, 4, 4, … | of the level the labels left: T 0, 4, 4, … (§E21) |

## Tests

- `src/engine/exactMoves.test.ts`: on generated graphs at several scales, from the record of moves alone: a Gate's moves in equal its moves out; a Converter is at one part of a run on all its lines; every Pool's level is within its bounds after every move; every stored value is the double nearest the exact level; the events are the record above the threshold; a node has fired exactly where the record has a move of its own; a Gate's reported state says it passed something on exactly where it fired.
- `src/engine/firedSmallMoves.test.ts`: §E9 for each node kind, for an End, and for the state connections that read a firing.
- `src/engine/exactMovesCases.test.ts`: §E7, §E8, §E10 to §E14, §E20 and §E21 as hand cases (§E20 each against the same graph without its Source lines; §E21 each with I1′ per Pool).
- `src/engine/state.label.test.ts`, `src/engine/state-verification.test.ts`: §E21 on Case S-C and on the example `state-verification.json`.
- `src/engine/kinds.test.ts`: §E20 for a recipe of a conserved kind.
- `src/engine/pullAllShort.test.ts`: §E11, §E11a and §E11b: a third short stops at every size, on every kind of `pull all` node; a node that can have all it asks runs at every size; the edge of the absolute epsilon just above `1e-9`; what a Drain and an End record; a `pull all` Converter that can have all it asks, at four sizes, alone and beside a Gate.
- `src/engine/gateStateSmall.test.ts`: a Gate's reported state against its firing, at four sizes.
- `src/engine/exactMovesOpen.test.ts`: the stops that were open, pinned as they are. E-open 3 at eighteen scales, with `p3`'s room asked exactly at each; seed 2950 at step 4 at 1, 10⁸ and 10⁹; §E14's room a hair short.
- `src/engine/exactMovesCases.test.ts`, "a plan that fits at one number only, its exact cap": §E22 on E-open 1's graph at nine scales, with `pull all` members, and two controls where a margin is passed at the cap.
- `src/engine/exactMovesCases.test.ts`, "a planned `pull all` Converter reads what arrived off the record of moves": E-open 2 and 4 as settled, and a real shortfall that still stops.
- `src/model/engineValues.test.ts`: a rate with a unit under the display threshold moves.
