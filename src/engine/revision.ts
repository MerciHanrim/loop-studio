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
export const ENGINE_REVISION = 5
