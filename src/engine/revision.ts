// SEMANTICS-W2.md §W2-1 — the engine revision.
//
// Raised whenever a deploy changes a number the engine computes for a document
// WHOSE MEANING DID NOT CHANGE: a correction of `step` under an existing model
// version. It is not a model version — the graph file never carries it, the
// semantic digest does not include it, and no reader refuses a graph over it.
// It is written beside a saved Monte Carlo result (`workspace.mc.engineRevision`)
// and into the Monte Carlo JSON export, so a result an app cannot reproduce is
// shown as stale, never as current. The ledger of revisions is the table in
// SEMANTICS-W2.md §W2-1; a bump and the engine change that needs it are one
// change.
//
//   absent (read as 0)  every engine before 2026-11-01
//   1                   issue #471 — a Converter plans its run fraction before
//                       it takes anything (V1, V2, V3); shared targets (V3g, V3r)
//   2                   issue #471 — a Converter fed through Gates or other
//                       Converters is planned with them as one group, at the
//                       group's first router (V2b, V4); a split that rejoins
//                       is refused before the run; a Converter whose router
//                       input delivers nothing this step does not run
//   3                   issue #476 — a Gate with two supplies (two upstream
//                       routers, or one and its own Pools) is planned with its
//                       group at a fixed priority in the existing order, with
//                       or without a Converter behind it; `all` on its input
//                       reads the Pool's available amount at plan time; a
//                       `pull all` such Gate takes its point or nothing
//   4                   issue #471 item 5 — `all` on a connection with a
//                       Converter at either end is refused (0 + a diagnostic
//                       naming the connection and the number `1`), as a
//                       percent is; a Pool a Converter group both takes from
//                       and delivers into is bounded along the group's commit
//                       order (an earlier member's take is room for a later
//                       delivery), so a loop routed through a Gate or a
//                       Converter is bounded as the direct loop is
//   5                   issue #471 — a group of Gates only that splits and
//                       rejoins is planned as one group at #476's priority,
//                       each choice the most the whole group can carry; a
//                       `pull all` Gate of it that misses its fixed demand
//                       zeroes the group; the group planners accept no value
//                       past an availability or a room (no epsilon slack),
//                       so a planned amount is never clipped at the commit
//   6                   issue #492 — a plain tree of routers outside every group
//                       that reaches one Pool by two or more paths is bounded
//                       by that Pool's room over the path-summed share, and an
//                       amount handed to a Gate is reserved once, not again at
//                       each Gate it passes
//   7                   a rate with a unit whose engine value is below 1e-6 or
//                       from 1e21 per step runs at that value: the derived
//                       graph wrote it as exponent text, which `parseFlow`
//                       cannot read, so it ran as 1
//   8                   a Gate outside every group that has two or more Pool
//                       lines takes each line up to its own amount, and lines
//                       off one Pool share what it holds; it sized its
//                       throughput from the sum of the whole Pools, pulled
//                       less, and passed the full amount on (resources from
//                       nowhere: 100 became 105 in one step)
//   9                   `pull all` Drain / End and `push all` Source ask a Pool
//                       once for all their lines that share it (two lines
//                       between the same pair passed one by one); a router
//                       below a zero-storage cycle is ordered and runs (it was
//                       taken as on the cycle)
//   10                  a tree group with several source Gates is planned over
//                       all of them: two on one Pool share it in the commit
//                       order (50 + 50 was planned from 60, 50 + 10 moved),
//                       and each one's take is room for a later delivery (a
//                       loop through the second one ran by the Gates' ids)
//   11                  the multi-supply plan: a source Gate is charged what
//                       it pulls, in the commit order (the next one was
//                       planned short of what the Pool had); a Gate held to a
//                       throughput covers it exactly (the group moved nothing,
//                       or 1e-9 too much); a `pull all` source Gate under a
//                       multi-supply Gate that is short zeroes the group (it
//                       was dropped and the rest moved)
//   12                  issue #572 — a planned group that returns to an exactly
//                       full Pool exactly what it takes from it runs (its
//                       floating-point level failed at every value the search
//                       tried and the group stood still): where floating point
//                       cannot tell, a Pool's room is tested in exact
//                       fractions, from the rates as the document states them
//   13                  issue #570 — what a planned group's source Gates are to
//                       pull is held for them from the plan to their own
//                       turns (a router outside the group that is ordered
//                       between took it: the Gate moved less than its plan and
//                       the Converter behind it ran at several fractions)
//   14                  issue #576 — a Converter's coefficient in a plan is asked
//                       `> 0`, not `> epsilon`: behind a Gate it is a fraction
//                       per amount, below 1e-9 from a rate of about 1e9 on, and
//                       the plans left the Converter out (the Gate handed it
//                       more than a run takes and the rest was gone; a
//                       multi-supply group stood still; a run target's cap
//                       was lost)
//   15                  issue #572 — a planned Gate with no Pool line of its own
//                       passes on what it was handed, and its `pull all` is not
//                       asked a second time (it moved the least of the plan's
//                       number and the hand-over, one amount in two orders: a
//                       last place was dropped at every scale, and from about
//                       1e7 a `pull all` Gate passed on nothing)
//   16                  issue #572 — a step's moves are exact fractions and are
//                       recorded (`report.moves`); a Pool is stored as the double
//                       nearest its exact level, with no clamp; no move is dropped
//                       for being at or under 1e-9, which now only decides what is
//                       shown; a rate above 0 is a live line whatever its size; a
//                       node has fired where it moved anything above 0; a Pool's
//                       capacity is tested exactly; a planned `pull all` Gate with
//                       two supplies is let through for a Pool that is short by at
//                       most 1e-9, never for room that is short; a `pull all` node
//                       that asks 1e-9 or less in all may be short by 1e-9 of what
//                       it asks; a `pull all` Drain or End that runs short takes
//                       what its Pools hold (it was recorded as taking all it
//                       asked); a Gate's reported state follows its firing
//                       (SEMANTICS-E.md)
//   17                  issue #586 — the floor of a stated run target is the
//                       group's: a planned group one of whose Converters states a
//                       target at or under 1e-9 stands still as a whole, before
//                       anything is taken (SEMANTICS-E.md §E19). The member with
//                       the target was skipped at its own turn, after its takes:
//                       the members before it ran and handed to it, and it took
//                       its inputs and made nothing, the group reading `met`
//   18                  issue #581 — a line from a Source is no input of a
//                       Converter (SEMANTICS-E.md §E20): the Converter runs as it
//                       would without the line, and a recipe of a conserved kind
//                       is read without it; a planned Converter left with no input
//                       stops its group. Counted in a full run, the line ran the
//                       Converter at a part from its Pool lines alone, lost what
//                       did not fit, and made a planned group's members disagree
//   19                  issue #582 — a Pool a Phase-0 `label` edits is pulled at the
//                       level the labels left (SEMANTICS-E.md §E21): a lowered
//                       amount cannot be taken in that step, a raised one can.
//                       Read off the step-start value, a lowered Pool was pulled of
//                       more than it held and the difference was made from nothing,
//                       outside I1′; SEMANTICS-S.md §S11 Case S-C now commits T
//                       0, 4, 4, … (0, 8, 4, … before)
//   20                  issue #572, E-open 2 and 4 — a planned `pull all` Converter
//                       reads what it received off the record, exactly (SEMANTICS-E.md
//                       §E11): it read a sum of doubles in which an amount at or
//                       under 1e-9 is 0, and so stopped, with its group, at sizes
//                       where its amounts are that small
export const ENGINE_REVISION = 20
