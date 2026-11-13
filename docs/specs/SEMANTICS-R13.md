# SEMANTICS-R13 — the phases of a run in the revision layer

Spec ID: loop-revision/13

A document may name the phases of its run (`phases`, [`docs/run-phases.md`](../run-phases.md)):
a short name with the first and last step it covers, shown beside the current step. This
document gives that key its place in the revision layer. A behavioural change after this is
a new spec id in a new document.

**No behavioural change to `loop-revision/1` … `/12` for a document without phases.** A
graph with no surviving phase has a canonical projection, digest, three-way plan and Apply
**byte-identical** to before this document (R13-INV-1). Revision and proposal payloads
written before it keep their bytes and their digests. One thing changes for every document:
the difference summary now names a difference in the timetables, the step length or the
kinds table (§R13-5).

**`loop-workspace/1` and the engine digest are NOT touched**: a phase is the author's guide
and nothing `SimState` computes (R13-INV-2).

**`loop-studio/graph/N` is NOT bumped**: the key is optional and outside the model
semantics, and an older build must keep opening the document (§R13-7).

---

## R13-0. Why

A first version kept phases outside the revision layer: a revision file carried them, an
Apply kept the open document's. A proposal that moved the timetables then left the open
document's phase names where they were: with the coffee roasting batch and a proposal that
moves the drying / browning boundary from minute 5 to minute 7, steps 6 and 7 were named
"Browning" while every table released at the drying rate, and nothing on screen said so.
A display of the current phase that names the wrong one is wrong guidance (Lumi,
2026-11-14). Phases are therefore revision content: seen in the review, taken or kept by
an Apply, and undone with the graph.

## R13-1. Version inference

A side is `loop-revision/13` iff at least one phase survives the defensive read
(`readPhases`, §R13-1.1). It takes the highest label precedence, above `/12`; like every
label from `/2` up it is served by the one `{ modelLayer: true }` projection, so the
precedence changes the reported label only. Survival decides, as for `/5`: a `phases`
block of which every entry is dropped is no phases.

### R13-1.1 Reading rules — the stored form

`phases` is a top-level array of `{ id, label, from, to }`, written after `timetables`. A
bad entry is dropped and the document kept. An entry is kept only with an `id` that is a
non-empty string of at most 64 characters and not already used, a `label` that is not
blank (cut at 60 characters), whole numbers `from` ≤ `to` of 1 or more, and a `from` after
the `to` of the last kept entry. The kept phases are in step order and never overlap; of
two that overlap the first in the file stays. At most 64 are kept. The read is a pure
function of the file.

## R13-2. The projection

`phases` is a trailing key of the canonical content AFTER `timetables` and BEFORE
`modelSemantics`, emitted only under `{ modelLayer: true }` and only when at least one
phase survives the read. It is emitted at every model-semantics version: a phase is not
model semantics. The array is in file order, each entry with the keys `id`, `label`,
`from`, `to` in that order. The literal `loop-revision/1` projection never emits it.

## R13-3. Tag

The `phases` array is a guide: projected, diffed, dirty-tracked, carried by undo, never
`engineAffecting`, never `advisoryAffecting`, never `provenanceAffecting`.

## R13-4. Diff, three-way and Apply

The whole array is ONE atomic unit, with the mechanics of the `frames` array (§R5-6).

- **Diff.** `RevisionDiff.phases` is the before / after arrays when they differ, else
  `null`; `summary.phasesChanged` says so, and a phases-only change is not an empty diff.
- **Three-way.** `ThreeWayPlan.phases` is present only when base and proposed differ. Its
  verdict against the live target is `noop` (the target already holds the proposed
  array), `clean` (the target still holds the base array) or `conflict` (a third array).
  A conflict counts in `nConf`, so a whole Apply over phases the user changed differently
  is confirmed first.
- **Whole Apply** adopts the proposal's phases with everything else (none ⇒ cleared).
- **Chosen Apply** takes the proposal's whole array when `selection.phases` is
  `'proposed'` (an empty array clears them) and keeps the target's otherwise. There is
  never a per-phase choice.
- **Undo.** Every undo entry carries the phases. An Apply is one entry, and one Undo takes
  the graph and the phases back together.
- **Dirty.** A change of the phases moves the full revision digest and makes the open
  revision dirty. A language switch that renames a Template's phases does so too, as it
  does for a Template's node labels.

## R13-5. The graph-level engine keys in the summary

The timetables, the step length and the kinds table have no hunk: only a whole Apply
takes them. Before this document a proposal that changed only one of them read "No graph
changes" in the review, and Apply then changed the document. From this document on:

- `summary.timetablesChanged`, `summary.stepLengthChanged` and `summary.kindsChanged` say
  which differ between base and proposed, and the review names each;
- such a difference is not an empty diff and is `engineAffecting`;
- "choose changes" still does not take them, and says so when the proposal's timetables
  or step length differ from the open document's.

No hunk is added for them.

## R13-6. Phase names and timing from different sides

Phases name spans of steps; the timetables and the step length set what those steps do.
An Apply can leave the two on different sides (`phaseTimingSplit`, against the live
target):

- **`timing-only`** — a whole Apply of a proposal whose timetables or step length differ
  from the target's while its phases are the target's own: the timing changes and the
  names stay. This is the proposer who moved the tables and left the phases.
- **`phases-only`** — a chosen Apply that takes the `phases` hunk of a proposal whose
  timetables or step length differ from the target's: the proposal's names land on the
  target's timing, because a chosen Apply never takes the timing.

In both cases the review shows a notice before the Apply, which says the current phase
shown may differ from the real process afterwards. It is a notice only: nothing is refused
and no extra confirmation is asked (Lumi, 2026-11-14). When the proposal's timetables or
step length differ from the target's, the `phases` hunk is NOT pre-accepted in "choose
changes" even when it is clean; the default is to keep the target's.

Keeping the target's phases in a chosen Apply splits nothing, since that Apply takes no
timing either. Nothing is checked when the resulting document has no phases.

The notice compares the timetables and the step length only. A change of a node or a line
can also move when things happen; that is not detected.

## R13-7. What a build before this document does with phases

Measured with the reader and the engine of v0.32.0 (`be27518a`), extracted with
`git archive` and run on files this build writes from the coffee roasting batch.

- **A plain graph file with `phases`** opens as before. The reader ignores the key, the run
  is the same at every step, and a save from that build writes no `phases` key: the phase
  names are lost when that build saves over the file.
- **A revision or proposal file with phases** carries a content digest that includes them.
  A build before this one projects without them, so its digest check fails; because the
  header declares `semantics: "loop-revision/13"`, it reports that the file was written by
  a newer version of Loop Studio and that it cannot verify the revision history, drops the
  project data and opens the diagram itself, without the phase names. It does not open the
  file as a proposal, so it cannot apply it.
- **A revision or proposal file without phases** written by this build declares
  `semantics: "loop-revision/13"` and verifies in an older build: the declaration alone
  refuses nothing (§R11-6).

The explicit refusal of the revision data, with the diagram still opening, is the existing
rule for `/9` to `/12` and is kept (Lumi, 2026-11-14): refusing the whole file would need a
new `loop-studio/graph/N`, which would stop older builds from opening plain graph files
with phases too.

## R13-8. Invariants

- **R13-INV-1** — no surviving phase ⇒ projection, digest, three-way plan and Apply are
  byte-identical to `loop-revision/12` and earlier.
- **R13-INV-2** — `semanticDigest`, the engine digest and every simulation result are the
  same before and after any change of the phases.
- **R13-INV-3** — an Apply that changes the phases is one undo entry, and its Undo restores
  the graph and the phases together.

Pinned by `src/model/revision.r13.test.ts`, `src/model/phases.test.ts`,
`src/store/graphStore.phases.test.ts` and `test/revision-phases-apply.test.ts`.

## R13-9. The declared semantics of a record

Every revision and proposal header written from this document on carries
`"semantics": "loop-revision/13"` (§R10-6 posture: not content, no digest covers it, an
unknowing reader ignores it).

## R13-D. Settled decisions (Lumi, 2026-11-14)

- Phases are revision content: one line in the review's difference list, taken or kept by
  a whole or a chosen Apply, undone with the graph; `loop-revision/13`.
- Timing that changes while the phases are kept, and phases taken onto timing that is not:
  a notice before the Apply, no extra confirmation. In "choose changes" the phases hunk
  defaults to the target's when the proposal's timetables or step length differ.
- An older build keeps its existing behaviour: it refuses the revision data of a `/13`
  file with the newer-version message and opens the diagram, without the phase names.
- The review names a difference in the timetables (and the step length and the kinds
  table). Taking the timetables in a chosen Apply is not added.
