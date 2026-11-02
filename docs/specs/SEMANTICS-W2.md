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
| `ENGINE_REVISION` | `3` | `src/engine/revision.ts`; the ledger is W2-1 |

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
