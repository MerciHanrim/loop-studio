# SEMANTICS-M6 — run rules (`loop-model/6`)

A run rule is a fixed rule on a Converter. It reads one tank, one timetable, or both, and sets the fraction the Converter's group may run at. A recipe is never rewritten: every line of a group moves the same fraction, so a conserved kind still balances.

This is a modelling rule, not a plant controller. It has no integral term, ramp or hold, and it does not compute part-load efficiency, pressure, or the cost of a start. Its result depends on the step length, unlike a timetable's amount.

A rule is made in the Inspector (§M6-9), or comes in through a document file.

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

**Notices.** `short` and `stopped` raise `runHeld`, and a rule above a full run raises `runCapped`. `off` raises none, because nothing is wrong. The run bar shows one line per group with the steps in a row, not one per step. The count follows the group, named by its first member, so it carries on when the rule that decides changes. A notice gives its amounts in the unit the Pool is authored in, cut to six figures: a Pool in no unit reads in its kind's base unit, and with no kind as a bare number.

**The run CSV** adds three columns per ruled group, by its first member: `<label> (target) [id]`, `(moved)` and `(state)`, in the plain and the shown file. A step with no report, such as step 0, leaves them empty. A document with no rule writes the same bytes.

## M6-6. Where it lives

- Model: `src/model/runRule.ts` (the read, the findings, the plan, the report), `hasRunRules` in `src/model/modelVersion.ts`.
- File and digests: `src/model/serialize.ts`, `src/model/revision.ts`, `src/model/workspace.ts`, `src/model/moduleGraph.ts`.
- Engine: `src/engine/step.ts`, with `runTargets` as its seam.
- Words: `src/ui/runMessages.ts`, and `runRefusals` in `src/store/simStore.ts`.
- Canvas: `src/model/readEdges.ts`, `src/components/edges/ReadEdge.tsx`, `src/components/nodes/StageTag.tsx`, `src/ui/stageTag.ts`.
- Panels: `src/components/RunRuleSection.tsx`, `src/components/RunStrip.tsx`, `src/components/RunRuleHelpDialog.tsx`, `src/ui/runRuleForm.ts`, `src/ui/runStrip.ts`, `src/model/runWarnings.ts`, and `setRunRule` in `src/store/graphStore.ts`.
- Pins: `src/engine/run-target.test.ts`, `src/engine/run-rule.test.ts`, `src/engine/runRuleHelp.test.ts`, `src/model/runRuleFile.test.ts`, `src/model/runWarnings.test.ts`, `src/ui/runMessages.test.ts`, `src/model/readEdges.test.ts`; in the browser, `e2e/run-rule.spec.ts`, `e2e/read-connection.spec.ts`, `e2e/stage-tag.spec.ts`, `e2e/run-panels.spec.ts`.

A fraction that is not finite is known only inside a step, so it refuses with the engine’s English diagnostic.

## M6-7. The read connection

A stage whose rule names a tank has a line from that tank to the stage. It says what the rule reads. It is a picture of the rule, not a connection.

- **Derived, never stored.** `src/model/readEdges.ts` works it out from `data.run.tank`. Only the router and the canvas see it. It reaches no document, digest, undo entry, engine input, connection list or CSV, and a rule whose tank is missing or is no Pool draws nothing.
- **Known by its data, not its id.** A file may give a stored line any id or `type`, `read:ro` and `read` included, so neither says what a line is. `isReadEdge` reads `data.readPort`, which only `readEdges` sets: reading a file rebuilds `data` from the keys it knows. A read connection's id is `read:<stage>`, with `~` added until no stored line holds it, so routes and React Flow never meet two lines with one id.
- **Its look.** Dash-dot, 2.5 px, no arrowhead, no chip, a ring just outside the tank. A flow is solid with an arrow and an activator dashed with an arrow and a chip, so the pattern tells it apart in every mode. In forced colours it is CanvasText. Selecting the stage or the tank, or pointing at the line, thickens it.
- **A click or a tap selects the stage,** and nothing else: the line cannot be selected, deleted, reconnected or reached by Tab. Canvas handles the click, and `PanSurface` the tap on the phone and in Pan mode, where it takes the pointer before React Flow does.
- **Its own port.** A read connection shares no stub with another line: docs/edge-routing.md §ER20.
- **Not drawn when a tank has no spot left.** That takes more stages reading one tank than it has spots, six on a tank with a line on three faces. `readEdges` reports them as `blocked`, and sharing a stub is not the fallback, because the shared stub would hide what the line says. The stage tag says it: §M6-8.

## M6-8. The stage tag

Plain text under a ruled stage's name, at the name's 136 px. It says what the stage reads and what it did.

| State | The tag's state |
|---|---|
| No step yet | Run rule |
| `met` | Run 50 % |
| `short` | Run 30 %, target 50 % |
| `stopped` | Stopped, target 50 % |
| `off` | Off |

- **`met` says how far the stage ran, and no more.** `met` is a judgement within a ratio (§M6-5), so its words carry no target and nothing that reads as the target being hit. In every language they are the run clause of the `short` words alone, and a test holds that. Two `short` numbers that round alike take more digits, then `<`, so a held stage never reads as if it ran at its target.
- **The forms,** longest first: the state and what it reads; the state and the table, because the line shows the tank and nothing else shows the table; the state in its short words, `Run 30/50 % …` or `Stopped …`; then `…` alone.
- **The numbers are bounded,** so a run can print nothing the block did not allow for. A share prints to two decimals at most, and under 0.01 % as `<0.01`. Two `short` numbers that still round alike say `<` the target: `Run <50 %, target 50 %`. A far smaller share, or a target like 0.00000005 %, needs the exact figure the notice and the CSV give.
- **The rule:** the longest form whose words stay at least 6 px from every chip, other node and other name, in every state at the widest numbers a run can print. When even `…` is too close, no words show until the tag opens. Which state is widest depends on the language and its font, so each is measured and none is guessed. Digits are tabular, so no number of that shape is wider.
- **The block is the largest of the full form's states,** whichever form shows and whatever the state. The router and the chips treat it as part of the name block. So a rule can move a line near its stage once, when it is added, and neither a step nor a fold moves anything.
- **A folded tag opens.** Choosing the stage or its tank, pointing at or focusing the stage, or pointing at its line shows the full form over the block, so the tank can always be named. A tap on the phone chooses the stage. The full form is also in the stage's accessible name.
- **No line.** A stage whose read connection has no spot left says `no line to <tank>: no free port`. Those words are never folded away, so its last form can sit closer than 6 px.
- **Detail levels.** At L1 only the state shows, and at L0 nothing, except that a stage with no line keeps its words at L1.

## M6-9. The panels

What a folded tag leaves out is on three other surfaces, so no stage depends on its tag to be read.

**Inspector, a Converter's "Target run" section.** It reads first, then edits.

- It reads: the tag's longest form, whatever form the canvas shows; this step's target and run in full figures, with no bound; why a stage is off; each rule's target and which one decides, when a group has two; and the run bar's own notice sentence. A member of a group whose rule sits on another stage says so, and shows the group's numbers.
- It edits: Full or a rule, then Tank with Target level, Band and Side, Timetable with its 100 % line, and Lowest run, as a percent. Tank and table options keep a name that no longer exists, as `Missing: <id>`.
- **A document only ever holds a rule that reads,** because `bad-run-rule` would refuse its file. A tank waiting for its level and band stays in the form and says it is not in use yet, and nothing changes in the document, its version or its run. A number is set on Enter or on leaving the field, so clearing `500` never runs a level of `50`.
- **A level and a band belong to their tank.** The same figure on a tank in another unit is another amount, so choosing another tank takes none of them, nor a `unit`. The new tank's fields start empty and show its unit, and the rule that is stored keeps running as it was, on the tank it names, until both numbers are typed. The section says so. Going back to that tank ends the draft with its numbers. A Timetable or a 100 % line applies at once, because neither is a figure in a tank's unit.
- **A Pool's unit change carries the rules in that unit.** A rule with no `unit` reads in its tank's unit, so the unit select re-expresses its level and band with `initial` and `capacity`, in one undo entry, and a value that does not end within 15 digits waits for the same consent (§M4-4). A rule that names its own `unit` is left alone: it means the same amount either way.
- The first rule promotes the document to `graph/6`, one-way, and one undo takes both back. Each field is its own undo entry.
- A group a rule cannot steer offers no rule, and says why. A finding stands beside the fields, in the words the run bar refuses with.
- The phone reads and does not make a rule: the sheet is read-only, as it is for every field.

**Step-length warnings** (`src/model/runWarnings.ts`) are warnings, not refusals, in the tank's unit with both numbers.

| Warning | When |
|---|---|
| `band-under-step` | the stage moves more in one full step into, or out of, the tank than the band |
| `level-under-pull` | what lines outside the group take from the tank in one step is more than the target level |
| `tank-under-take` | a group that pulls all takes more in one full step from a Pool than that Pool's capacity |

A line counts at its rate, and a table line at the table's highest rate for a whole step: no step reads more. A line with no one amount, such as `all` or a dice roll, adds nothing. A stage with no line to its tank gets no band warning, because what it moves there is not known. A step-length change that gives a stage a warning names that stage and waits for consent, as §M4-4 does for a balance.

**Inputs list.** One row per rule, under the timetables, with the tag's longest form and any finding. The row selects the stage. A table a rule reads counts as in use, so it cannot be removed, and it draws its rate strip.

**Timeline.** One strip per ruled group under the rate strips, 0 to 100 %, on the chart's step scale: the run solid and the target dashed, so neither rests on colour. A step's fraction holds for the whole step, so the line is stairs. Past one step per pixel a column keeps its lowest and highest, so one stopped step in a long run still shows. Pointing at a strip reads the step, and the step reading gives the same state to a keyboard. The strips count with the rate strips in the analysis area's rise.

**Help.** Help ▸ How a run rule reads a tank says the rule, the one-step delay, the three warnings and what the rule does not compute. Its numbers are pinned in `src/engine/runRuleHelp.test.ts`.
