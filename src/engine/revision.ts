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
export const ENGINE_REVISION = 1
