# SEMANTICS-R14 — the kinds table, the step length and the timetables as chosen units

Spec ID: loop-revision/14

A proposal can change three things that belong to the whole document and that the run reads:
the kinds table (with its units), the step length and the timetables. Until this document
only a whole Apply took them. "Choose changes" took a line that reads a table without the
table, a value without the unit it is written in, and phase names without the timing they
name. This document makes each of the three a unit of the three-way plan and of a chosen
Apply, and says what the review tells before such an Apply. A behavioural change after this
is a new spec id in a new document.

**No projection changes.** The canonical content, its bytes and its digest are those of
`loop-revision/13` for every document (R14-INV-1). No side is ever inferred as `/14`: the
label of a side still comes from its content, `/13` at most (§R13-1). What changes is what
an Apply can take, what counts as a conflict, and what the review says first.

**`loop-workspace/1`, the engine digest and `loop-studio/graph/N` are NOT touched.**

Issue #558. Supersedes §R13-5 ("No hunk is added for them") and the default of §R13-6.

---

## R14-1. The declared semantics of a record

Every revision and proposal header written from this document on carries
`"semantics": "loop-revision/14"` (§R10-6 posture: not content, no digest covers it). A
build before this one reads such a file as it reads its own: the declaration alone refuses
nothing (§R11-6), and the digest it checks is unchanged.

## R14-2. The three units in a three-way plan

`ThreeWayPlan.kinds`, `ThreeWayPlan.time` and `ThreeWayPlan.timetables` are each ONE atomic
unit with the mechanics of the `frames` unit (§R5-6):

- present only when base and proposed differ in that key of the canonical content
  (`kinds`, `time`, `timetables`; an absent key is `null`);
- `noop` when the live target already holds the proposed value, `clean` when it still holds
  the base value, `conflict` when it holds a third value;
- a conflict counts in `nConf`. A whole Apply over a kinds table, a step length or
  timetables the user changed differently is therefore `divergent` and is confirmed first.
  Before this document such a target was `unknown`: confirmed too, with the general text.

There is never a choice per kind, per unit or per table. The proposal's whole value is
taken or the target's is kept.

## R14-3. A chosen Apply

`HunkSelection.kinds`, `.time` and `.timetables` are `'proposed'` or `'yours'` (absent is
`'yours'`).

- `'proposed'` takes the proposal's whole value: its kinds table (none ⇒ cleared), its step
  length (none ⇒ the document declares none; the display unit comes with it) and its
  timetables (none ⇒ cleared).
- `'yours'` keeps the target's.
- The result is one `loadDoc`, one undo entry, and the new baseline is the whole resulting
  content, as for every Apply (§R7.3). A selection that changes nothing is refused as
  `no-effective-change`.

A whole Apply is unchanged: it takes all three with everything else.

## R14-4. Phase names and timing (replaces the rule of §R13-6)

`phaseTimingSplit` is judged on the RESULT of the Apply, against the live target. The
timing of a document is its timetables and its step length. The step length alone is
timing: a phase counts steps.

- **`timing-only`** — the timing of the document changes and its phases stay as they are.
- **`phases-only`** — the proposal's phases are taken, and the resulting timing is not
  wholly the proposal's (one of the two units kept, or both).
- nothing when the resulting document has no phases.

The review shows the notice of §R13-6 for either. It is a notice only.

## R14-5. The lines "choose changes" starts with

- A `clean` kinds table, step length or timetables unit is pre-accepted. A `conflict` never
  is.
- The `phases` unit is pre-accepted only when it is `clean` AND the timing those defaults
  leave in the document is the proposal's (no `phases-only` split). A conflict in the
  timetables or the step length therefore leaves the phases with the target by default.

## R14-6. What a chosen Apply would do besides what its lines say

Computed from the open document, the proposal's own document and the document the
selection would make (`applyDiagnostics`). The review shows the findings under the list of
changes and recomputes them with every choice.

### R14-6.1 A value read in another unit — REFUSED

A Pool amount or a resource line written in a unit is judged by the side it came from: the
side whose element holds the same value in the same unit (a Pool: starting amount,
capacity, unit and kind; a line: rate text and unit). If the resulting document would read
that unit another way than that side does — another declaration of the name, or none, so
that the number is read in the base unit (§M4-2.2) — the Apply is refused as
`invalid-selection` and nothing changes. The reading compared is the unit's declaration
under the element's kind, never the amount per step: a rate per minute is the same rate
under another step length.

- A value taken from the proposal without the kinds table that declares its unit:
  `0.9 bag` would become 0.9 of the base unit.
- A value the user keeps while taking a kinds table that declares its unit another way.
- A value and a unit the user puts together field by field belong to neither side and are
  not judged. A value both sides hold alike is on both sides and is read as either reads it.

It is refused, where §R14-6.2 only tells, because the document would then hold another
number and nothing in it would say so (Lumi, 2026-11-14).

### R14-6.2 A run the checks would newly refuse — told, allowed

The refusals of the run (`timetableFindings`, `runFindings`, the refusing kind findings)
are computed for the open document and for the result. One the result has and the open
document has not is shown before the Apply, with the lines whose taking removes it: the
fewest of the lines not taken, tried in every combination. The Apply is allowed. The
document then states the same reason itself, and one Undo takes the Apply back.

### R14-6.3 A table read from the other side — told with both plans, allowed

A table is split when a line or a rule of one side reads it under the other side's
definition. The definition is what the run reads of a table: unit, time unit, read mode,
end, what follows the end, meaning and points. Its label and its source are not part of it.

A line reads the table its rate names (`~id`) and the table of every rule whose group it is
a line of; a node reads the table of its own rule. Which way a split runs follows from the
timetables unit alone:

- **timetables kept** — a line or a rule with a run-relevant change TAKEN from the proposal
  reads the open document's definition;
- **timetables taken** — a line or a rule the user KEEPS where the proposal holds it
  another way (a run-relevant field not taken, or a removal not accepted) reads the
  proposal's definition.

A field is run-relevant when it is `engine`-tagged or names a unit or a kind. A line both
sides hold alike is on both sides and is never a reader: taking the proposal's timetables
under lines the proposal did not touch is the proposal itself, and nothing is told.

For each split table the review gives what the table plans under each definition, in the
base unit of the reading line's kind and under the result's step length: the sum over steps
1 to the last step either definition describes (at most 2 000), and the first step at which
the two plans differ, with both amounts. Two definitions that plan the same amount at every
step compared are not told. When the amounts cannot be computed (no step length, a unit
that is no rate of the kind) the split is told without them.

The amounts are what the table asks for. What a line moves can be less: a Pool can run
short, and a rule can cut the run.

## R14-7. Invariants

- **R14-INV-1** — the canonical bytes and the digest of every document are those of
  `loop-revision/13`. A revision file written by this build differs from one written before
  it in the declared `semantics` only.
- **R14-INV-2** — a whole Apply takes what it took before this document.
- **R14-INV-3** — a chosen Apply that takes none of the three units changes none of them.

Pinned by `src/model/revision.r14.test.ts`, `test/revision-r14.test.ts` and
`test/revision-choose-units.test.ts`. R14-INV-1 was measured on every bundled example with
the reader of main before this change (`0d6f14b7`, extracted with `git archive`).

## R14-D. Settled decisions (Lumi, 2026-11-14)

- The kinds table, the step length and the timetables are each one line of "choose
  changes", taken whole or kept. Clean lines are pre-selected, conflicts are not, and the
  phases follow the timing the defaults leave.
- A selection that would read a value in another unit is refused. A selection that would
  make the run refuse is told and allowed. A table read from the other side is told with
  the amounts, both ways round, and only where a line or a rule is in fact on the other
  side.
- A mark that stays in the document after such an Apply is a later document
  (`loop-revision/15`).
