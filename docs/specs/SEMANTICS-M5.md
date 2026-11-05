# SEMANTICS-M5 — `loop-model/5`: timetables

Status: normative for a document whose `schema` is `loop-studio/graph/5`. It extends `loop-model/4` ([`SEMANTICS-M4.md`](SEMANTICS-M4.md)): everything there holds here. A document with no timetable is not written at this version and computes as before, so `ENGINE_REVISION` does not change.

## M5-1. What a document declares

A document may hold a top-level `timetables` list, after `time`:

```json
"timetables": [
  {
    "id": "tide_intake",
    "label": "Intake by tide",
    "source": "Harbour gauge, example assumption",
    "unit": "CMD",
    "timeUnit": "h",
    "read": "linear",
    "end": "6",
    "after": "stop",
    "points": [["0", "19200"], ["3", "26400"], ["6", "19900"]]
  }
]
```

A resource connection reads a table as `"flow": "~tide_intake"`, as `@id` reads a Parameter. On an earlier schema the key is not read, and a leading `~` is the unparseable literal it always was.

**Version boundary.** A table is written only on `loop-studio/graph/5`; writing one with less is refused. An app that does not know this schema refuses the file. Adding a table promotes the document, one way.

## M5-2. The table

- `id`: a letter or `_`, then letters, digits, `_` or `-`, at most 64 characters, unique in the document.
- `label` and `source`: non-empty text. `source` says where the numbers came from and is shown beside the table.
- `unit`: a rate of the line's kind (M5-5). `timeUnit`: `s`, `min`, `h` or `d`.
- `read`: `hold` or `linear`. `after`: `stop`, `hold`, `zero` or `repeat`; absent reads as `stop`.
- `points`: 1 to 20,000 pairs of time and rate. Both are plain non-negative decimal text of at most 15 significant digits and at most 10⁶⁰, kept as typed. So is `end`. The first time is 0, and times strictly increase. Time is elapsed from the start of the run. It is not a calendar date.

**A table with any bad entry refuses the file, with the table and the row named.** It is not repaired on read, because dropping a row changes what the table means. This differs from the defensive read of §M4-1 on purpose.

**Why 10⁶⁰.** Fifteen significant digits bound precision, not size: a 1 followed by 400 zeros has one. A step's amount is at most a rate times the longest step times the largest factor, 10⁶⁰ × 8.64 × 10¹⁰ × 10¹⁵, about 10⁸⁶. So every plan of a good table under a file's factors is a finite double. A table that reaches `step` by another way is refused as M5-5 says, and a plan that is still not finite refuses the step with a diagnostic. It never throws.

## M5-3. The end of a table

`end` is required: the time the table stops describing.

| Table | `end` must be | Its last stretch |
|---|---|---|
| `hold`, any `after` | after the last point | The last value lasts until `end` |
| `linear`, not `repeat` | equal to the last point | None |
| `linear`, `repeat` | after the last point | A straight line from the last point to the first value, reached at `end` |

So under `repeat`, `end` is the period, and no stretch has zero length. A table that breaks this is refused as M5-2 says.

## M5-4. A step's amount

Step k covers the time from (k−1)S to kS, where S is the step length.

**amount(k) is the table's rate added up from (k−1)S to kS.** Under `hold`, the rate of a point lasts until the next point. Under `linear`, the rate changes in a straight line between two points. Both have an exact value over rationals, so no numeric grid is used, a point inside a step is counted correctly, and a step longer than an interval loses nothing. The amount depends only on the step number, so a step can be replayed.

After `end`:

| `after` | Behaviour |
|---|---|
| `stop` | The run ends before the first step the table does not fully cover: nothing moves, the step is not consumed, and a message says so. The Inspector shows the last covered step before Play |
| `hold` | The last rate continues |
| `zero` | The rate is 0 |
| `repeat` | The table starts again from 0 |

A step that crosses `end` is added up in two parts under `hold`, `zero` and `repeat`, so a period need not be a whole number of steps. Only tables a line reads can end a run.

## M5-5. Which lines, and which unit

A table may drive only **Source → Pool** and **Pool → Drain or End**. It is refused on any other line, including one with a Converter or a Gate at either end: a recipe must balance exactly, and a rate that changes alone would break it.

A table's values are rates per time, never an amount per step, so it keeps its meaning when the step length changes. Its `unit` resolves as a `rate` field does under §M4-2.2, against the kind of the line that reads it, and must name a time: a rate unit, or an amount unit per a time unit. The run is refused when:

- the line names a table the document does not hold;
- the line is not one of the two shapes above;
- the document has no step length;
- the line has no kind;
- the unit is not a rate of that kind;
- two lines of different kinds read one table;
- the table breaks M5-2, or a plan is not a finite number.

A refused run moves nothing and consumes no step. The run bars and Monte Carlo refuse before they start, with the same findings.

## M5-6. Planned and moved

Four numbers exist for a table line at step k, and they are kept apart.

| Layer | What it is | Type | Lives in |
|---|---|---|---|
| **P** exact plan | The table's integral over the step | Rational | Derived; never stored, never rounded |
| **p** engine plan | The nearest double of P: what the engine is asked to move | Double | `report.timetableLines[].planned` |
| **m** moved | What the engine actually moved on that line | Double | `report.timetableLines[].moved` |
| **u** unmet | exact(p) − exact(m) | Rational, never negative | Derived on reading |

- A line that was not clamped has m equal to p, bit for bit.
- Each step, |exact(p) − P| is at most 2⁻⁵³ × P, one conversion's rounding. Σ P equals the exact integral. Σ exact(p) differs from it by at most the sum of those roundings. The two claims are never written as one.
- The report holds p and m unrounded. A step with no table line has no `timetableLines` key.
- **The run CSV**, plain or with shown values, gains `<table> (planned) [<unit>] [<edge-id>]` and `<table> (moved) [<unit>] [<edge-id>]` for each table line, in the base unit per step. A cell is that double, in the shortest decimal text that reads back as the same double, so a reader can subtract the two columns. P is not written, because it is not a number the engine used. Unmet is not written, because a third column would be a rounded subtraction. A step with no plan, such as step 0, reads 0.
- **The message** appears when u passes the engine's `EPSILON` (10⁻⁹). A want below it moves nothing, because the engine snaps it to 0: that is unmet in the file, and not worth a message. It shows the double nearest u, in the base unit.

A constant line stays as it is.

## M5-7. Digests, modules and Monte Carlo

- Tables are canonical content in the revision digest and the graph digest, as decimal text, after `time`. A document with no table keeps its bytes.
- A module insert joins the module's tables to the host's. An id both hold with different content refuses the insert. A selection saved as a module carries the tables its lines read, and is a `/graph/5` file.
- A table is the same in every Monte Carlo run. Randomness elsewhere is unchanged, and seeds keep their meaning. Amounts are worked out once per table, step length and step. A result keeps each table's id and digest in `config.timetableDigests`, never its points. Under `stop`, every run ends at the same step, and `endedRuns` says so. Monte Carlo files hold no per-run planned and moved.

## M5-8. Water balance without a steady tank

`test/timetable-balance.test.ts` holds three levels that assume no steady Pool.

1. **The ledger, for any run at every step.** A Pool equals its start plus what came in minus what went out, inside a bound read from the run: each Pool update rounds by at most u times its result. It says the ledger is sound, not that the run is the right one.
2. **The exact path, while nothing clamps.** S(t) and its error D(t) are derived from the tables' rationals. Each step's preconditions come from the model alone: the Pool can give its whole outflow and fit its whole inflow. The first step a precondition fails ends the proof, and the test reports that step. After it, only levels 1 and 3 hold.
3. **The plan is accounted for**, in the layers of M5-6.

## M5-9. Not in this version

The controller and run fractions, calendar dates and time zones, editing points on screen, tables on Converter or Gate lines, splines, and random noise on a table.
