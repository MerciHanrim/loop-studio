# SEMANTICS-M6 — run rules (`loop-model/6`)

A run rule is a fixed rule on a Converter. It reads one tank, one timetable, or both, and sets the fraction the Converter's group may run at. A recipe is never rewritten: every line of a group moves the same fraction, so a conserved kind still balances.

This is a modelling rule, not a plant controller. It has no integral term, ramp or hold, and it does not compute part-load efficiency, pressure, or the cost of a start. Its result depends on the step length, unlike a timetable's amount.

There is no screen for a rule yet. It comes in through a hand-written document file.

## M6-1. The file

`loop-model/6`, `loop-studio/graph/6`, `hasRunRules(version)` at `>= 6`. A `run` key on a document of an earlier version is not read.

```json
{ "id": "ro", "type": "converter", "data": { "kind": "converter", "mode": "pullAll",
  "run": { "tank": "product", "level": "1500", "band": "1500", "side": "fill",
           "table": "demand", "rated": "e_ro_permeate", "lowest": "0.5" } } }
```

- `tank`, a Pool's id, with `level`, `band` and `side` (`fill` or `empty`). `level` and `band` are in `unit` when it is set, and otherwise in the tank's own unit.
- `table`, a timetable's id, with `rated`, a line's id.
- `lowest`, from 0 to 1, optional.
- A rule needs a tank, a table, or both. Numbers are plain decimal text, at most 10⁶⁰, and `band` is above 0.

A rule that does not read refuses the file, naming the stage (`bad-run-rule`). There is no fallback fraction.

The rule is engine input: it is in the file, the graph digest, the revision content, the Monte Carlo digest and a module. An insert gives its `tank` and `rated` their new ids, and refuses a rule that reads outside the module. `ENGINE_REVISION` does not change, because no earlier document holds a rule.

## M6-2. `rated`

`rated` names one resource line of the stage's own group. Its rate is what that line moves at 100 %, so a table value equal to that rate asks for a full run. Every line of a group moves `f × rate`, so the group's own line is the only kind whose rate says what 1 means for this group.

The line must name a time: a rate unit, or an amount per a time. A line with no time unit is an amount per step, so its meaning would move with the step.

The table's amount and the line's rate are both taken to the base unit per step, exactly, and divided as rationals. Every test of a rate is on that exact value, before any step is applied to its sign, so no step length can refuse a line. A valid line can still be too small for the engine to move at a short step: that is a run result, `stopped` with `floor`.

## M6-3. Findings

Each refuses the step: nothing moves, and the step is not consumed. The run bars and Monte Carlo refuse before they start, with the same findings, and Show selects the stage. Each finding belongs to one of five sentences, one per thing a person has to fix: the group, the tank, the table, the 100 % line, or the rule itself.

| Case | Finding |
|---|---|
| A `run` key on a node that is not a Converter | `not-a-converter` |
| A rule that does not read | `bad-rule` |
| A Gate in the group, a Gate on a line of a lone Converter, or a `multi` group | `group-shape` |
| The tank is not in the file, or is not a Pool | `unknown-tank`, `bad-tank` |
| `unit` is set and is not an amount unit of the tank's kind, or its base unit by name | `bad-tank-unit` |
| The document does not hold the table | `unknown-table` |
| A table and no `rated` | `rated-needed` |
| `rated` and no table | `rated-unused` |
| `rated` is not in the file, or is not a resource line | `rated-missing` |
| A line of another group, or of no group | `rated-outside` |
| The document has no step length | `no-step` |
| The line has no kind | `no-kind` |
| A table read by lines of two kinds, a rule counting as one of them | `two-kinds` |
| The table's unit is not a rate of the line's kind | `bad-unit` |
| The rate is empty, `all`, `50%`, `1-3`, `2D6`, `@p` or `~t` | `rated-not-a-number` |
| The rate has no unit, or an amount unit with no time | `rated-no-time` |
| The exact rate is 0 or less | `rated-zero` |
| The exact rate is positive, and its double is not finite or is 0 | `rated-out-of-range` |

**A rule's explicit `unit` never falls back.** A field whose unit does not resolve reads as the base unit (§M4-2.2), so its number keeps a meaning. A rule's `level` written in L and read as m³ would ask for a different run, and nothing would say so. So `bad-tank-unit` refuses it, with a tank of no declared kind included. With no `unit`, a rule reads the tank's own unit, and follows that field's reading.

**`group-shape` is checked before anything else about a rule.** A router-fed Converter takes from its Pools on a path a target does not hold, and rules were measured on one Converter and on a chain of them only. So no rule may steer a group with a Gate until that path is measured. A wanted fraction that is not finite refuses the step too.

## M6-4. The rule

```
t      = the table's exact amount this step ÷ the rated line's exact amount per step   (0 with no table)
e      = (level − tank at step start) ÷ band                                           (0 with no tank)
wanted = t + e on the Fill side, t − e on the Empty side
target = 0 if wanted ≤ 0, or if wanted < lowest; otherwise min(1, wanted)
```

**Fill** raises the run when the tank is low, and **Empty** when it is high. The table's amount is the one a table line would plan for the step, so a rule sees this step's demand exactly: a perfect forecast for one step, not a measurement.

The target is a function of the step's start state and the step number, so the state alone still decides the next step. A rule reads the tank before the step, and what a stage makes reaches the next stage one step later.

Order in a step: table findings and plan; rule findings; kind findings; a `stop` table ends the run, one a rule reads included; each rule reads the start state; the phases run, with `f` no greater than the target.

A group runs at the smallest target of its members. `pull all` means reaching the target: `f < target × (1 − 10⁻⁹)` stops the group. It is a ratio, so a small target cannot pass with nothing moved, and at a target of 1 it is the test `pull all` always had. An activator that turns a stage off still wins. The engine's two floors stay: a fraction at or below 10⁻⁹ does not run, and a line amount below it does not move.

## M6-5. The report

`StepReport.runs` holds one entry per group with a rule, ascending by first member. A document with no rule has no key.

```
{ members, rules: [{ stage, wanted, target }], target, decidedBy, capped,
  moved, basis, state, why, cause, pool, needed, had }
```

- `target` is the smallest of the rules' targets, and `decidedBy` the stage that gave it, the lowest id on a tie.
- `basis` is the group's line with the largest engine rate, the lowest id on a tie. The largest line is the last to fall under the engine's amount floor.
- `moved` is the amount on the basis line over its rate.
- `state`, in this order, with no absolute tolerance:

| State | When | `why` |
|---|---|---|
| `off` | an activator holds a member off, or the target is 0 | `activator`, `lowest`, `rule` |
| `stopped` | `moved` is 0 | `pullAll` with a `cause`, or `supply`, `room`, or `floor` when no limit held it |
| `met` | `moved ≥ target × (1 − 10⁻⁹)` | |
| `short` | otherwise | `supply` or `room` |

`met` is within a ratio of 10⁻⁹ of the target, so words on a screen must not say the target was filled exactly.

`pool`, `needed` and `had` name the tightest limit in `stopped` and `short`: what the target needed from that Pool or of its room, and what was there at the group's turn. On a tie, supply before room.

**Notices.** `short` and `stopped` raise `runHeld`, and a rule above a full run raises `runCapped`. `off` raises none, because nothing is wrong. The run bar shows one line per group with the steps in a row, not one per step. The count follows the group, named by its first member, so it carries on when the rule that decides changes.

**The run CSV** adds three columns per ruled group, by its first member: `<label> (target) [id]`, `(moved)` and `(state)`, in the plain and the shown file. A step with no report, such as step 0, leaves them empty. A document with no rule writes the same bytes.

## M6-6. Where it lives

- Model: `src/model/runRule.ts` (the read, the findings, the plan, the report), `hasRunRules` in `src/model/modelVersion.ts`.
- File and digests: `src/model/serialize.ts`, `src/model/revision.ts`, `src/model/workspace.ts`, `src/model/moduleGraph.ts`.
- Engine: `src/engine/step.ts`, with `runTargets` as its seam.
- Words: `src/ui/runMessages.ts`, and `runRefusals` in `src/store/simStore.ts`.
- Canvas: `src/model/readEdges.ts`, `src/components/edges/ReadEdge.tsx`.
- Pins: `src/engine/run-target.test.ts`, `src/engine/run-rule.test.ts`, `src/model/runRuleFile.test.ts`, `src/ui/runMessages.test.ts`, `src/model/readEdges.test.ts`; in the browser, `e2e/run-rule.spec.ts`, `e2e/read-connection.spec.ts`.

Not built yet: the screens for making a rule, and the stage tag. A fraction that is not finite is known only inside a step, so it refuses with the engine’s English diagnostic.

## M6-7. The read connection

A stage whose rule names a tank has a line from that tank to the stage. It says what the rule reads. It is a picture of the rule, not a connection.

- **Derived, never stored.** `src/model/readEdges.ts` works it out from `data.run.tank`. Only the router and the canvas see it. It reaches no document, digest, undo entry, engine input, connection list or CSV, and a rule whose tank is missing or is no Pool draws nothing.
- **Its look.** Dash-dot, 2.5 px, no arrowhead, no chip, a ring just outside the tank. A flow is solid with an arrow and an activator dashed with an arrow and a chip, so the pattern tells it apart in every mode. In forced colours it is CanvasText. Selecting the stage or the tank, or pointing at the line, thickens it.
- **A click or a tap selects the stage,** and nothing else: the line cannot be selected, deleted, reconnected or reached by Tab. Canvas handles the click, and `PanSurface` the tap on the phone and in Pan mode, where it takes the pointer before React Flow does.
- **Its own port.** A read connection shares no stub with another line: docs/edge-routing.md §ER20.
- **Not drawn when a tank has no spot left.** That takes more stages reading one tank than it has spots, six on a tank with a line on three faces. `readEdges` reports them as `blocked`, and sharing a stub is not the fallback, because the shared stub would hide what the line says. No screen shows `blocked` yet.
