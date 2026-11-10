# SEMANTICS-M7 — `loop-model/7`: a table of what a line can move

Status: normative for a document whose `schema` is `loop-studio/graph/7`. Issue #519. It extends `loop-model/6` ([`SEMANTICS-M6.md`](SEMANTICS-M6.md)) and the timetables of [`SEMANTICS-M5.md`](SEMANTICS-M5.md): everything there holds here. A document with no `available` table is not written at this version and computes as before.

## M7-1. What a table declares

A table may say what its rate means, after `after`:

```json
{ "id": "grid_b", "label": "Grid feed B", "source": "Example assumption: a 12-hour planned outage",
  "unit": "MW", "timeUnit": "h", "read": "hold", "end": "720", "after": "hold",
  "means": "available", "points": [["0", "1.225"], ["300", "0"], ["312", "1.225"]] }
```

- `plan`: the line should move this amount. A shortfall is reported (§M5-6). This is every table before this version.
- `available`: the line can move up to this amount. Moving less is normal.

Absent reads as `plan`, and a written `"plan"` reads as absent, so a plan table keeps its bytes and its digest. Any other value refuses the file with the table named (`bad-means`), as §M5-2 refuses a bad entry.

**The meaning belongs to the table.** Every line that reads one table reads it the same way. A table cannot be a plan on one line and available on another, and a different meaning is a new table, as any changed table is (§M5-10).

**Version boundary.** An `available` table is written only on `loop-studio/graph/7`; writing one with less is refused. Before this version, a reader drops a table key it does not know without a word. An older build would read an outage as a plan and lose the meaning on save, so an app that does not know this schema refuses the file instead. Adding an `available` table promotes the document, one way. A `means` key on a document of an earlier version is not read.

## M7-2. What the engine does

An `available` line moves exactly as a `plan` line does. Each step, the line's flow is that step's amount (§M5-4), and the step runs as usual: a full Pool clamps it, an empty one starves it. The step report keeps the same entry, `timetableLines[] = { edgeId, tableId, planned, moved }`, where `planned` is the amount the line was allowed to move.

The one difference is the shortfall: an `available` line never raises `timetableUnmet`. A real shortfall is still reported where it is real. When an outage leaves a tank empty and a demand is a `plan` table, the demand line reports its own unmet amount.

A run rule that reads a table reads its amount, as §M6-3 says, whatever the table means.

**The engine revision does not change** (SEMANTICS-W2.md §W2-1: a revision is a changed number on a document whose meaning did not change). For a document with no `available` table:

- every step's values, events and report are the same, `timetableLines` and notices included;
- the revision and graph digests are the same, since a plan table writes no `means`;
- a Monte Carlo result is the same, and so is its `config.timetableDigests`.

An `available` table is a new meaning on a new model version. Its digest differs from the same table as a plan, so a Monte Carlo result made from one is never shown as the other's. Monte Carlo keeps no notices and no per-run planned and moved (§M5-7), so nothing else in its files changes. `test/timetable-available.test.ts` pins this.

## M7-3. What a person reads

Nothing in the run bar, while an `available` table is at 0 or at any other time: nothing is wrong. Three places tell what was available apart from what moved.

- **The rate strip** (§M5-11) of an `available` table draws the table dotted, as a run strip draws its target, and what each line reading it moved, step by step, solid, as a stair over the step: the step's moved amount as the table's rate over that step. Its name reads `<label> (<unit>): available (dotted), moved (solid)`, and the words "available" and "moved" stand at the two lines' ends in the gutter right of the plot (§M6-9). A plan table's strip is unchanged.
- **The strip's reading** under the pointer is the hovered step's, on one basis: what the step made available and what moved, each as the table's rate averaged over that step (`stepRates`, from the step report's `planned` and `moved`). The table's rate at the pointer's instant is another quantity. Under `linear`, a step from 0 to 2 averages 1, and an instant near its end reads about 1.9, beside a moved 1 that is the whole step. So a line that moved everything reads two equal numbers: `Step 1: available 1, moved 1 CMH`. When several lines read the table, the reading says what each line could have and names every line by its ends, with what it moved: `Step 1: available 1 CMH on each connection, moved Src → Tank 1; Src → Tank B 0.5`.
- **The Inspector** of a line reading an `available` table says what the meaning is, and gives the last step's two amounts in the kind's base unit.
- **The run CSV** names the first column of the pair `<table> (available) [<unit>] [<edge-id>]`. The second is `(moved)`, as for a plan. A plan table's columns are unchanged.

## M7-4. Making a table on screen

Data ▸ New timetable asks what the rates are: a plan, the default, or what is available. The screen says what each choice means and that every line reading the table reads it the same way. The choice is written into the table, so it is kept by an autosave, a saved file, an Export and an Import.

## M7-5. Help

Help ▸ How a timetable is read states the two meanings, that the meaning belongs to the table and every line reading it shares it, and what shows while a supply is off.

## M7-6. Not in this version

A meaning on a line, an availability on a Source, a notice when a supply turns off, and the planned outage in the desalination Template, which needs its own kickoff.
