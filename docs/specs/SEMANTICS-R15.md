# SEMANTICS-R15 — the mark that phase names were not checked against the timing

Spec ID: loop-revision/15

An Apply can leave the phase names of a document and the timing they describe on different
sides (`SEMANTICS-R14.md` §R14-4). The review says so before the Apply, and until this
document nothing said so afterwards: the run row showed the name as it shows any other.
This document gives a phase a mark that such an Apply sets, that stays in the document, and
that the reader takes off. A behavioural change after this is a new spec id in a new
document.

**No change for a document without the mark.** Its canonical projection, its digest and its
saved file are byte-identical to `loop-revision/14` (R15-INV-1).

**`loop-workspace/1`, the engine digest and `loop-studio/graph/N` are NOT touched**: the
mark, like the phase it is on, is nothing the run reads (R15-INV-2).

Issue #558. The mark says that the names MAY not match. The app has not compared them with
anything, before or after the reader's check.

---

## R15-1. The stored form

A phase entry may carry `"unchecked": true`, after `to`:

```json
{ "id": "roast_drying", "label": "Drying", "from": 2, "to": 7, "unchecked": true }
```

It is `true` or it is absent. Any other value is dropped by the read, and a writer never
writes `false`. A side whose surviving phases carry at least one mark is `loop-revision/15`,
the highest label precedence, on the same projection (§R13-2 emits each entry with the keys
`id`, `label`, `from`, `to`, and now `unchecked` when set).

The mark is on the entry, not beside the list, so that it goes wherever the phases go and
nowhere else: a saved file, the autosave record, a revision or a proposal file, a Workspace,
a share link, an undo entry. A document that loses its phases loses the mark with them.

Every header written from this document on carries `"semantics": "loop-revision/15"`.

## R15-2. When it is set

By an Apply for which `phaseTimingSplit` (§R14-4) is not `null`, on EVERY phase of the
resulting document:

- **`timing-only`** — the timing of the document changes and its phases stay: the kept
  phases are marked, since it is their timing that moved;
- **`phases-only`** — the proposal's phases are taken and the resulting timing is not wholly
  the proposal's: the taken phases are marked.

Whole or chosen alike. It is the notice of the review, kept: the same function decides
both, so a mark is never set without the notice having been shown, and the notice is never
shown without the mark following.

Nothing else sets it. An edit of a timetable or of the step length in the app does not.

## R15-3. When it is cleared

1. **Undo of the Apply that set it.** Every undo entry carries the phases (§R13-4), so the
   Undo restores them as they were, and Redo brings the mark back.
2. **An Apply that takes phases and timing together from a side without the mark.** No
   split, and the proposal's phases come as they are: unmarked. A whole Apply of a proposal
   whose own phases carry the mark brings it, as content.
3. **The phases are removed.** There is nothing left to mark.
4. **The reader's own check** (`confirmPhasesChecked`): the mark is taken off every phase.
   It is an edit of the document: one undo entry (its Undo brings the mark back), refused
   while the edit lock is on, and it makes an open revision dirty. It bumps no
   `simulationRev`, so a run under way goes on. It records that the reader looked, and
   nothing more: there is no editor for phases, so names that are in fact wrong are
   corrected in the file or by an Apply.

It stays through everything else: saving, opening again, a reload, an export, a language
switch, an Apply that takes neither phases nor timing, and an Apply that moves the timing
again while the phases stay.

## R15-4. On screen

Where the run row shows a phase (docs/run-phases.md) and that phase is marked:

- **Desktop, a name.** A small button after the name. Its press, or the keyboard focus on
  it, opens a popover over the row with the phase and its range, the guide sentence, the
  sentence of the mark, and the button "I checked the phases and the timetables". With the
  edit lock on, a sentence says to turn it off instead of the button. The popover is a
  named group, not a tooltip, since it holds a button; that button is the next keyboard
  stop after the mark, and Escape or a press elsewhere closes it. After the check the
  keyboard focus is on Play.
- **Desktop, the phase button.** Where a name has no room every phase of the document is a
  button (docs/run-phases.md). That button is then the mark: it shows the mark instead of
  the information sign, its accessible name ends with the mark's words, and its popover
  holds the same. The room a name needs counts the mark, so a document whose widest name
  fits alone and not with the mark shows the button.
- **Phone.** The mark is a button beside the name on the phase line. Its press opens the
  sentence under the line and a second press closes it. The phone views and runs, so the
  check is recorded on a desktop, and the sentence says so.
- **Screen reader.** The mark's button is described by its sentence. The playback
  announcement names a marked phase with its mark when it names the phase.
- No control of the row moves for the mark.

The sentence: "When a proposal was applied, these phase names and the timetables or the
step length came from different sides. The phase shown may differ from the real process."

## R15-5. In a review

The mark is content of the phases unit (§R13-4): two documents that differ only in it
differ in their phases, the unit's verdict takes it into account, and the "Run phases" line
says when taking the proposal's phases would bring the mark or take it off.

## R15-6. What a build before this document does with the mark

Measured with the readers of main before this change (`3738db4c`, `loop-revision/14`) and
of v0.32.0 (`be27518a`), each extracted with `git archive`, on files this build writes from
the coffee roasting batch with its phases marked.

- **A plain graph file.** The build before this one opens it with its phases and without
  the mark: its read keeps the four keys it knows. When it saves the document the mark is
  not in the file: **the mark is lost if an earlier version saves over the file.** v0.32.0
  opens it without phases at all, as it does every document with phases (§R13-7).
- **A revision or proposal file.** Its digest includes the mark, so an earlier build's
  digest check fails; the header declares `loop-revision/15`, so that build reports a file
  written by a newer version of Loop Studio, drops the project data and opens the diagram.
- **A document with no mark** is the same file and the same digest in both builds.

## R15-7. Invariants

- **R15-INV-1** — no marked phase ⇒ projection, digest and saved file are byte-identical to
  `loop-revision/14`.
- **R15-INV-2** — `semanticDigest`, the engine digest and every simulation result are the
  same with and without the mark.
- **R15-INV-3** — the mark is set by an Apply exactly when the review showed the notice of
  §R14-4 for it.
- **R15-INV-4** — the check is one undo entry, and its Undo restores the mark.

Pinned by `src/model/revision.r15.test.ts`, `test/revision-phase-mark.test.ts` and
`e2e/run-phases.spec.ts`.

## R15-D. Settled decisions (Lumi, 2026-11-14)

- The mark is revision content, `loop-revision/15`; what an earlier version loses is stated.
- It is cleared by the Undo of the Apply, by an Apply that takes phases and timing together
  from a side without it, by the removal of the phases, and by a button of the reader's own.
- The button's words say that the reader checked, not that the app verified a match; the
  mark's sentence says the names may differ, not that they do.
