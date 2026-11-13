# Run phases

A document may name the phases of its run: "drying" for steps 2 to 5, "browning" for 6 to 9. While the run is under way, the run row shows the name of the phase the current step belongs to.

A phase is a guide written by the document's author. It is not a result: the engine does not read it, no step depends on it, and a phase named "browning" does not mean any temperature or reaction was computed.

## In the document

```json
"phases": [
  { "id": "roast_drying", "label": "Drying", "from": 2, "to": 5 },
  { "id": "roast_browning", "label": "Browning", "from": 6, "to": 9 }
]
```

- `label` is the short name shown beside the step.
- `from` and `to` are the first and the last step of the phase, both counted in. A step is 1 or more: step 0 is the time before the run and belongs to no phase.
- The key is written after `timetables`, only when the document has a phase. A document without phases is saved byte for byte as before.
- The key does not depend on the schema number. It is read from and written to a document of any `loop-studio/graph` version.

The app has no editor for phases yet. They come with a Template or a hand-written file.

### Reading

A bad entry is dropped; the document always opens. An entry is kept only when it has

- an `id` that is a non-empty text of at most 64 characters and not already used,
- a `label` that is not blank (a name longer than 60 characters is cut there),
- whole numbers `from` ≤ `to`, 1 or more,
- and a `from` after the `to` of the last kept entry.

So the phases that are kept are in step order and never overlap. Of two that overlap, the first in the file stays. Steps between two phases belong to none, and the run row names none there. At most 64 phases are kept.

### What a phase is not part of

- The engine, a run, Monte Carlo: none reads it.
- The engine digest and the revision digest: a document has the same two digests with and without phases.
- The undo history: phases change only where a document begins (a file, a Template, a share link, a Workspace, the browser's saved work), where the history starts again too.
- A revision's content: no diff and no hunk covers phases. A revision or proposal file carries them, so the file opened as a document keeps them; an Apply onto the open document keeps the open document's phases.
- A saved structure (module): it carries none, and inserting one keeps the document's.

### An earlier version of the app

A build from before this key opens a document that has it, ignores the key, and runs the same. When that build saves the document, the phases are not in the saved file. Measured on v0.32.0 and on main before the change, with the coffee roasting batch: both open it, both write no `phases` key, and every engine gives the same values at each of 25 steps with and without the key.

## On screen

The phase shown is the one that covers the current step of a run under way. There is none before the first step, between phases, once the run has ended, and while the run cannot start.

### Desktop: the run row

The step readout keeps its place. The phase's short name is shown in the room beside it, the one the steady-state status uses, after a thin rule. That room has the same width whether the status is shown or not, so a phase appearing, changing or going never moves a control.

- A state wording comes first. While the steady-state status is shown, the phase is not. At the end the step readout says so, and the phase is not shown.
- The tooltip gives the name with its range ("Browning (steps 6–9)") and says that it is the author's guide. A screen reader reads "Browning phase, steps 6–9".
- **A name that does not fit is never cut.** If any phase name of the document is wider than the room at its current width, every phase of that document is shown as one small button instead. Pressing it, or moving the keyboard focus to it, opens the name and range over the row; Escape or a press elsewhere closes it. The rule is per document, not per name, so the form does not switch between a name and a button as the run goes on. It is judged again when the window size or the language changes.
- The button's accessible name is the phase and its range, and its description is the guide sentence, so nothing is only in the popover.
- If the button goes while it holds the keyboard focus (the run ends, the status appears, the window widens), the focus moves to Play.

### Phone: the run bar

A line of its own above the controls shows the name and the range ("Browning (steps 6–9)"). The line is there only while there is a phase to show: a document without phases, the time before the first step and the end add no height, and at the end only the end notice remains. A long name wraps; it is not cut. The bar grows by the line's height when the first phase begins, and the controls under it do not move.

### Announcements

The playback announcer says the step as before. A step message also names the step's phase when it is not the phase named last: "Step 6, Browning phase". It is one message in the one region, with the announcer's own pace of at most one message in 900 ms, the newest step winning.

- The end, a pause and a start name no phase.
- At a fast Play, a phase that begins and ends inside one 900 ms window is not named. Nothing is queued behind the step, so the announcements never fall behind the run.
- A message may be the first one inside a phase without being its first step, so it never says "begins".
- After Reset, a rewind or another document, the next step names its phase again.

## Templates

A bundled Template may have phases in its example file. Their names follow the reader's language like the Template's node, frame and table names ([`template-label-overlay.md`](template-label-overlay.md)): each language's dictionary has a `<name>Phases` map, a name is switched on a language change only while it is exactly an official one, and `npm run check:template-labels` fails on a missing or stale name. A phase id belongs to one Template.

The coffee roasting batch has seven: Charge (step 1), Drying (2–5), Browning (6–9), Development (10–13), Drop (14), Cooling (15–18), Discharge (19). Its test checks them against its timetables: every time a table changes its rate or ends is a phase boundary, and every phase boundary is one of those times.

## Where it is in the code

| part | file |
|---|---|
| the shape, the defensive read, the phase of a step | `src/model/phases.ts` |
| written and read with the document | `src/model/serialize.ts` |
| held for the open document | `src/store/graphStore.ts` (`phases`) |
| which phase a row shows, and its wording | `src/ui/runPhase.ts` |
| the desktop run row | `src/components/PlayBar.tsx` |
| the phone run bar | `src/components/mobile/MobileRunBar.tsx` |
| the announcement | `src/components/PlaybackAnnouncer.tsx` |
| a Template's phase names per language | `src/i18n/templateLabels/` |
