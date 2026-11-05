# SEMANTICS-M4 — `loop-model/4`: units and the step length

Status: normative for a document whose `schema` is `loop-studio/graph/4`. Issue #471, U1 stage 2; design record `units-display-design.md` rev 6 (decided 2026-11-03). Extends SEMANTICS-M3.md (the kinds table and per-kind conservation). Numbering continues the model-semantics axis: `loop-model/1` → `/2` → `/3` → `/4`.

## M4-1. What a document declares

A kind in the table (§M3-1) may carry two unit lists, and the document may carry a top-level `time`:

```json
"kinds": [
  { "name": "water", "conserved": true, "baseUnit": "m³",
    "units":     [{ "name": "L", "factor": "0.001" }],
    "rateUnits": [{ "name": "MLD", "factor": "1000", "per": "d" }] }
],
"time": { "step": { "value": 1, "unit": "h" }, "display": "d" }
```

- An **amount unit** `{ name, factor }`: one `name` is `factor` base units. A stock or a rate may be authored in it.
- A **rate unit** `{ name, factor, per }`: one `name` is `factor` base units per `per` (`s`, `min`, `h`, `d`). Only a rate may be authored in it, and only once the document declares a step length.
- `factor` is a positive plain decimal of at most 15 significant digits in the **runnable range 10⁻¹⁵ … 10¹⁵**, kept as TEXT in its shortest exact form (`1000.0` is written `1000`). The range is checked where a declaration is read and where one is committed in the Kinds panel (the same read): `1e400` is a valid 15-digit decimal, but no engine value scaled by it is finite. Inside the range, a factor times the largest step ratio (10⁶ days over 1 s) leaves every authored number below 10²⁸⁰ finite. A `name` is trimmed, NFC, at most 32 UTF-8 bytes, and may not contain `/`, which separates an amount unit from a time unit in a field's unit text (`L/min`).
- **Defensive read**: a bad entry is dropped; names are unique across both lists and apart from the base unit (the base unit's name wins, then file order); an empty list is no key.
- `time.step` is the **step length**: `value` an integer 1…10⁶, `unit` a time unit. It is a model fact. `time.display` is the time unit aggregate panels show rates per; it is presentation. Anything else is no `time` at all.
- **Version boundary.** A unit list, a `time` or a field `unit` (M4-2) is written only on `loop-studio/graph/4`; writing one at a lower version is refused, never silently dropped. None of them is read from an earlier schema. An older app fails closed on `/graph/4`. Declaring a unit list, a step length or a field unit promotes the document, one-way; a module insert that would promote asks first (§MS3.4). **M4-INV-1:** a document with no unit list, no `time` and no field unit computes, byte for byte, what it computes under `loop-model/3`, and its projection and digest are `loop-model/3`'s apart from the discriminator.

## M4-2. Authored values and engine values (invariant S′)

1. A Pool's `initial` and `capacity`, and a resource connection's constant `flow`, keep what the person typed: the **authored decimal** and the field's **`unit`** (`"L"`, `"L/min"`, `"MW"`; absent = the base unit, per step for a rate). The file stores exactly that.
2. **Resolution, fail-safe.** A field's unit resolves against its kind's lists and the step length. An unknown name, a rate unit or a per-time unit on a stock, and a per-time or rate unit without a step length all read as the base unit: the number then means what every earlier document meant by it, never a silently scaled amount.
3. **The engine value** is the nearest double of the exact rational `authored × factor × S ÷ T`, where `S` is the step length in seconds and `T` the seconds of the unit's time (`S ÷ T` = 1 for an amount per step). It is derived when the engine reads the graph and is never persisted. The derived graph carries it in plain digits at any size, because a flow in exponent form is not a number to `parseFlow`. An engine value at or below the engine's floor of 10⁻⁹ per step moves nothing, as any such amount does. Only a plain decimal is converted: a percent, `all`, a random form or a `@param` reference is read as it is, and a Parameter's value has no unit.
4. `step()`, Monte Carlo and the engine revision (4) are unchanged: they read the derived graph.
5. **Out of range.** A field whose engine value is not finite (an authored number near the double's limit in a large unit) is an `outOfRange` finding. It always refuses the run, whether or not a kind is conserved, as the kinds findings do (§M3-4): Play, Step and Monte Carlo do not start, and `step` returns the unchanged state with a diagnostic.

## M4-3. The step length

A step change moves the amount per step of every field authored per time unit, and of no other field. It can therefore change a balance verdict only at a Converter whose connections mix per-time and per-step rates; the change names those Converters and waits for consent before it is applied (M4-4).

## M4-4. Changing a unit, a step length or a factor

- **A unit change of a non-empty field** re-expresses the authored value through exact rationals. When the result terminates within 15 significant digits it is applied at once: the same rational, so the engine value and every verdict are unchanged. Otherwise nothing is applied until the person confirms: the sheet shows the exact value as far as it goes, the 15-digit value that would be stored and its deviation in the base unit (all under M4-5), and the Converters whose verdict would change. There is no "keep the number" action. Cancel leaves the field as it was.
- **A step-length change** that changes any Converter's verdict lists those Converters first and is applied only on consent. One that changes none is applied at once.
- Every applied change is one undo entry.
- **A module insert never changes what a field means** (§MS3.4). It is refused, with the reason, when:
  - the module and the document declare different step lengths (compared in seconds, so 60 min = 1 h);
  - a kind both declare has two different base units;
  - a unit name both declare has a different factor, a different time, or sits in the other list.

  Otherwise the module's units that the document does not name join the document's kind, and a side with no step length takes the other's. As a backstop, every field's engine value after the insert, the document's and the module's alike, must equal the one it had in its own document; if any differs, the insert is refused. A selection saved from a document with a step length carries that step length, so the comparison can be made.

## M4-5. C1 exact, and what a surface prints (R≈)

- **Balance (D4).** The C1 test of §M3-3 is exact: every computable rate is its authored decimal times its unit's ratio to the base unit per step, as a rational, and `Σ in = Σ out` must hold exactly — no epsilon, no double. This supersedes the `1e-9` tolerance of §M3-3 for every version: `0.1 + 0.2 = 0.3` balances, `100 = 50 + 55` breaks by exactly 5. A resolved `@param` takes part at its value, in the base unit.
- **R≈.** A verdict is taken from the rational, never from printed text. A surface prints a value's exact decimal when it terminates, otherwise `≈` and 15 significant digits, always in plain digits (never an exponent). An approximation is never labelled exact. Authored field text never carries `≈`.
- **An engine value on screen.** A surface that re-expresses an engine value in a field's unit (the Properties panel's current amount of a Pool) takes the double's exact binary value in that unit. It shows at most 15 significant digits and adds `≈` exactly when the shown text is not that value. After 720 steps of 1000/24 m³, the engine's 1699.999999999984 m³ shows as `≈ 1699999.99999998 L`; an exact 200 m³ shows as `200000 L`. The stored value and every verdict are untouched. A Pool in the base unit keeps the node's two-decimal format.

## M4-6. Exports (D6)

- **CSV**: numeric cells stay numbers, in the base unit per step; the header names the unit (`feed [m³]`).
- **JSON**: numbers stay numbers, and a `units` object names each unit once. The document itself stores the authored decimal and its `unit` key.
- No export turns a computed number into a string by prefixing `≈`.
- **A document that names no unit** writes every export as it always did, byte for byte. A Pool's unit is its kind's `baseUnit`; a Pool of no kind, or of a kind with none, names no unit, and a file may hold both.

Each export applies this as follows.

| Export | The unit |
|---|---|
| Timeline run CSV | in the column name, before the node id: `feed [m³] [pool_1]`. The last bracket is always the id (DI-D19) |
| Monte Carlo runs CSV | in the column name: `feed [m³]` |
| Monte Carlo series and summary CSVs | a `unit` column after `pool`, because one header serves every Pool in these long files |
| Monte Carlo JSON | a top-level `units` object by node id, because labels may repeat, after `engineRevision`. It is left out when no unit is named. The `loop-mc/1` fields do not change: `final` and `series` stay numbers |

**The step length of a Monte Carlo JSON is `config.time.step`.** That path is the one source: the run's own input, written with the result, and absent when the document declares no step length. `config.time.display` beside it is presentation. No other key repeats it.

**A re-expressed value.** No export above holds one: every number is the engine value in the base unit, whatever the screen shows. The one file that does is the Timeline's separate download of M4-8. The Monte Carlo files and the JSON never do, so the object form `{ value, unit, approx, display }` of the design record stays unused.

## M4-7. Where it lives

- Model: `src/model/rational.ts` (exact decimals, R≈), `src/model/units.ts` (the reads, field-unit resolution, the engine value, the unit-change preview), `src/model/engineValues.ts` (`applyUnits`, the derived graph; `stripFieldUnits`), `src/model/kinds.ts` (`readKindsAt`, the exact C1, `convertersWhoseVerdictChanges`). Engine: `src/engine/step.ts` and `montecarlo.ts` read the derived graph; the findings read the authored one.
- File: `time` after `kinds`, field `unit` keys trailing on Pool and resource-connection data. Projection and digest: the unit lists ride their kind entry, `time` follows `kinds` with `step` only, field `unit` keys are projected — all at version 4 only.
- UI: the Inspector's unit select on a Pool and on a resource connection, and its confirm sheet; the Kinds panel's unit lists and step-length row, which the Inputs tab shows for any graph that names or declares a kind.
- Exports: `src/model/exportUnits.ts` (the table of a document's Pools, the JSON header); the writers are `src/components/timelineCsv.ts` and the exports of `src/engine/montecarlo.ts`.
- View units (M4-8, M4-9): `src/model/viewUnits.ts` (how a Pool reads, the text of a number, the axis, the outflow reading), `src/store/viewUnitsStore.ts` (the session choices); the surfaces are `TimelineChart.tsx`, `TimelineSeriesPopover.tsx`, `TimelineCsvMenu.tsx`, `BandChart.tsx` and the Kinds panel in `ModelPanels.tsx`.
- Pins: `src/model/units.test.ts` (rationals and R≈, the reads and the factor range, resolution, engine values and the out-of-range refusal, unit changes, exact C1, module inserts, the `/graph/4` boundary and M4-INV-1), `src/model/kinds.test.ts`, `src/engine/kinds.test.ts`, `src/model/exportUnits.test.ts` (M4-6, and the readers of a result file), `src/model/viewUnits.test.ts` (M4-8); in the browser, `e2e/units.spec.ts` (the confirm sheet's cancel, confirm and undo, an exact change, the step-length sheet), `e2e/desalination.spec.ts` (the real downloads), `e2e/timeline-view-units.spec.ts` (M4-8 on the real screen and downloads) and `e2e/kinds-outflow-reading.spec.ts` (M4-9).
- Not built: the Inspector's current amount does not follow a view unit, and a field has no read-only hint of its value in another unit. The design record lists both; neither is implied by M4-8 or M4-9.

## M4-8. The Timeline's view unit

A person may read a kind's Pools in another of its amount units. Every Timeline series is a stock, so only amount units apply, and `time.display` has nothing to act on here.

- **It is screen state.** One choice per kind, starting at the base unit, held for the session and dropped when another whole graph loads. It is not in the document, a Workspace file, the undo history or an autosave, and it runs no engine code: `serialize()`, the digest, `series`, `values` and every result are the same under every view. `ENGINE_REVISION` and the schema do not change.
- **Resolved on every read.** The chosen name goes through §M4-2.2 as a stock field. A unit removed from the kind reads as the base unit at once, a rate unit never applies, and an edited factor applies at once.
- **The control.** A Units section in the Series popover, one select per kind that has an amount unit and a Pool. A document with none has no section.
- **One number line.** A point's height is the number shown for it, and a tick is true of every series in its own unit. The Pools of one kind keep their proportions; two kinds drawn together do not, and that comparison never meant anything.
- **The axis says what its numbers are in.** With one unit across the drawn Pools it names that unit once, above the ticks. With different units, a Pool that names none among them included, it says **Mixed units**, and each chip, end label and step reading carries its own unit, so two amounts are not read as one scale. With no unit at all it says nothing. Register lines keep their own range and are not counted.
- **The Distribution tab** uses the same view on screen. It draws one Pool, so it always has one unit.

**The text of a number.**

| Surface | Base view | A view unit |
|---|---|---|
| Chip, end label, the Distribution p50 | the chart format and the unit | compact: six significant digits or the whole integer part, `≈` exactly when the text is not the engine value |
| Step reading | the chart format and the unit | full R≈: at most 15 significant digits (§M4-5) |
| Tick | the chart format | plain digits with no float residue and no `≈`: a tick is a round mark, not an engine value |

A Pool that names no unit prints what it always printed. As in §M4-5, a Pool in the base unit keeps the chart's own format, so `499.99999999999994` prints `500.0 m³`, and the same value in L prints `≈ 500000 L`.

**The file with shown values.** The plain Timeline CSV never depends on the screen: the same run gives the same bytes under every view. While a view unit is on, the CSV control also offers `loop-studio-run-shown.csv`. Each Pool the view re-expresses gains two columns beside its number, and only such a Pool, so no cell is blank:

```
step,feed [m³] [feed],feed (shown) [L] [feed],feed (approx) [feed],power [kWh] [power]
1,499.99999999999994,≈ 500000,true,125
```

- `(shown)` is the step reading's text without its unit, which the header names. `(approx)` is `true` or `false`, derived and never stored. The last bracket is the id in every column (DI-D19).
- With the added columns removed, the file is the plain file, byte for byte.
- No number becomes a string: the numeric column stays as §M4-6 has it.

## M4-9. The Kinds panel's outflow reading

A boundary-outflow row (§M3-5) is the last committed step's delivery. It is an amount per step, so it reads as a rate, where a Timeline series reads as a stock. It has its own per-kind choice, and the Timeline's view unit does not move it.

- **It is screen state**, as M4-8 is: held for the session, dropped when another whole graph loads, in no file, undo entry or autosave. It runs no engine code and does not reset the run. It stays available under the edit lock, because reading a number is not an edit.
- **The control.** One select per kind on a row, when that kind has more than one reading. The list is a rate field's (§M4-2.3) plus the base unit per each time unit.
- **The starting reading.** A document that declares `time.display` opens in the base unit per that time. Otherwise, and when the base unit has no name, a kind opens in the base unit per step. The panel reads `time.display` and never writes it: `setTime` would reset the run.
- **Resolved on every read.** A reading no option carries any more reads as the base unit per step.

**The report's two numbers.** `amount` is rounded to 9 decimals, and `raw` is the engine's sum for the same row before that rounding. A conversion multiplies a rounding error, so `≈ 0.400000000008` would show where 400 CMD was authored. No step result, state, event or Pool value changes, and `ENGINE_REVISION` does not change. `raw` is still a double, so §M4-5 applies to it.

| Row | It prints |
|---|---|
| A line with no kind, or a kind that names no base unit, in the base reading | the report's `amount`, as before |
| A named base unit, in the base reading | `amount`, the unit and "per step": `16.666666667 m³ per step` |
| Another amount unit | `raw` under §M4-5, the unit and "per step": `≈ 16666.6666666667 L per step` |
| A rate or an amount per time | `raw` under §M4-5 and the unit: `≈ 0.4 MLD`, `≈ 400 m³/d` |

`≈` stays on `≈ 0.4 MLD` because the engine holds the nearest double of 400/24, not the exact value. No export holds a row.
