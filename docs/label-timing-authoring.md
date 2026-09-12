# Label timing authoring (design doc)

**Status: design — pending review (round 4).** CSU8 slice 3
(`docs/conditional-state-update.md`, `SEMANTICS-S3.md` §S3-8): the Inspector
authoring surface for a `label` connection's `timing` / `when`
(`loop-state/3`). The engine, the grammar, and the `loop-revision/6`
projection (`SEMANTICS-R6.md`) are **frozen and unchanged** by this document —
this is authoring UX only.

Sections: **§LTA0** why · **§LTA1** scope · **§LTA2** invariants · **§LTA3**
the preset model · **§LTA4** classification & eligibility · **§LTA5** the
modifier field's `S`-form gate · **§LTA6** the preview / warning line ·
**§LTA7** keyboard / SR / IME / mobile / locked · **§LTA8** i18n · **§LTA9**
acceptance · **§LTA10** decisions · **§LTA11** work order.

---

## LTA0. Why

`SEMANTICS-S3.md` gives a `label` connection two internal identifiers:
`timing: "phase0" | "afterPull"` and `when: "source-fired"`. These are correct
and frozen as **wire content** — but they are engine/spec vocabulary, not
words a Loop Studio author has ever needed to know. Today's Inspector has no
control for them at all (PR #181 shipped the engine only, deliberately —
`SEMANTICS-S3.md` §S3-8). Without an authoring surface, the only way to use
Phase 2.5 is hand-editing the JSON file, which defeats the point of a visual
tool and is exactly the gap the gacha hard-pity content (GS10-3) needs closed
next.

The risk this document exists to manage: a raw two-field editor (`timing`
dropdown + `when` dropdown, mirroring the wire shape 1:1) would let an author
freely construct `phase0 + when` — fail-closed and silently inert
(`SEMANTICS-S3.md` §S3-5 row 2) — inside the tool that is supposed to prevent
exactly that class of mistake. Hanrim's brief (2026-09-12) heads this off:
collapse the two fields into a small, named set of author-facing outcomes, so
every state the structured control can **freshly author** is engine-valid by
construction.

**Round 2 (Hanrim)** found this draft's first pass under-specified in five
places: the invalid-state classification was incomplete (only one of four
reachable bad combinations was named), the **target** eligibility rule was
missing entirely (§S3-5 rows 6/7 apply to *both* presets, not just source),
the "allow + warn" stance let the structured control **author** a
known-bad state instead of only *inheriting* one, the mode-switch behaviour
was described backwards from the actual code, and the atomicity /
accessibility details were unstated. All five were fixed in round 2.

**Round 3 (Hanrim)** found four more problems, all in the round-2 fix
itself: the **modifier-parses** condition (§S3-5 row 7 — an empty /
unparseable `expr`) was missing from eligibility entirely, only the `S`-form
sub-case was covered; the round-2 rendering table described a "both presets
eligible" state that **cannot occur** (A needs a Pool source, B needs a
Router source — a node has exactly one kind, so eligibility for the two
presets is mutually exclusive by construction); one acceptance test assumed
a target could be deleted and then still be inspected on its incident edge,
which this codebase's `removeNode` — it cascades edge deletion — makes
unreachable through the UI; and the keyboard contract mixed a native
`disabled` radio with an arrow-navigable-while-disabled custom pattern,
which are two different, incompatible implementations. All four are fixed
below; §LTA4.2–§LTA4.4, §LTA6, §LTA7's keyboard bullet, §LTA8, and several
§LTA9 tests are rewritten.

**Round 4 (Hanrim)** found two more problems, both in round 3's fix: the
unified `eligibleLabelPreset` returned only `'A' | 'B' | null`, with no way
for the Inspector to know *which* condition disqualified the *non*-eligible
option — forcing the Inspector to re-derive that itself, defeating the
point of a shared function — and, entangled with the same gap, §LTA6 and
§LTA7 asserted two mutually exclusive display contracts ("exactly one line,
ever" vs. "a reason always visible beside every disabled option"). Separately,
Hanrim rejected §LTA4.2's "accepted duplication" of `ROUTER_KINDS`: a
`step.ts` one-line refactor (re-export the existing constant from
`stateExpr.ts` instead of defining it locally) is judged worth doing now,
because the entire point of this design is that the engine and the Inspector
share one predicate — shipping a second, independently-maintained copy on
day one undermines that before the feature even exists. Both are fixed below;
§LTA1, §LTA2 (INV-2), §LTA4.2–§LTA4.3, §LTA6, §LTA8, and several §LTA9 tests
are revised.

## LTA1. Scope

**In:**

- One new authoring control on a **`label`**-mode state edge in the desktop
  Inspector, replacing nothing (`ExprField` for the modifier stays; this is a
  new field alongside it, per §LTA3).
- A shared, engine-agreeing **classifier** for what a stored `(timing, when)`
  pair means — `phase0` / `afterPull` / `unsupported` — living in
  `src/engine/stateExpr.ts`, not reimplemented in the Inspector (§LTA4.1 /
  LTA-D8).
- Live, non-blocking-where-free-text / blocking-where-structured validation
  covering every one of `SEMANTICS-S3.md` §S3-5's eight rows that this
  control's own choices can reach (§LTA4).
- A one-line, always-visible preview / warning line stating in plain language
  when the edit currently takes effect, or why it doesn't (§LTA6).
- EN / KO / JA copy for all of the above (§LTA8).

**Out:**

- Any *behavioural* change to `step.ts`, `SEMANTICS-S3.md`, or the
  `loop-revision/6` projection (`revision.ts` / `workspace.ts`,
  `SEMANTICS-R6.md`). This document authors *existing*, frozen wire content —
  it invents no new stored shape (LTA-INV-1). The additions to
  `stateExpr.ts` are **pure helpers with no new recognised values**
  (§LTA4.1/§LTA4.2) — they change what the Inspector shows, never what the
  engine accepts. **One narrow, non-behavioural exception (round 4,
  LTA-D13):** `step.ts`'s `ROUTER_KINDS` constant *definition* moves to
  `stateExpr.ts`; `step.ts` **imports it and explicitly re-exports it**
  (`import { ROUTER_KINDS, ... } from './stateExpr'` then
  `export { ROUTER_KINDS } from './stateExpr'`) — a plain `import` alone does
  not re-export a name, so the explicit `export` is required for
  `src/engine/index.ts`'s existing `export { initSim, step, ROUTER_KINDS }
  from './step'` to keep resolving (round-4 correction, Hanrim's mechanical
  finding). Two lines of `step.ts` change (the import and the re-export),
  zero lines of `step.ts`'s *validation logic* change, and the existing
  engine test suite (unchanged) verifies byte-for-byte parity.
- An "advanced" mode exposing `timing` / `when` as independent fields. Not
  designed here, not stubbed, not a hidden toggle. `SEMANTICS-S3.md` v1
  recognises exactly one non-default value per field, so a two-option preset
  already covers 100% of the currently-valid space (§LTA10-D1); revisit only
  if a future `loop-state/N` adds a second `when` value or a third `timing`.
- The gacha hard-pity content itself (GS10-3) — this document only makes it
  *authorable*; building `examples/gacha-simulator.json`'s pity counters is
  the next slice.
- Any change to `trigger` / `activator` fields, or to a `resource` edge.

## LTA2. Invariants (LTA-INV)

| id | statement |
|---|---|
| **LTA-INV-1** | A **fresh pick** through the structured radio control writes **exactly one of two shapes**, in **one** `setEdgeData` call (§LTA2 atomicity, LTA-INV-8): (a) **no `timing` key, no `when` key** — "Always"; (b) **`timing: "afterPull"`, `when: "source-fired"`** — "On source fire". Choosing (a) **deletes** both keys if present (never writes the literal `"phase0"`) — a label edge no author has ever touched this control on, and one where the author has explicitly chosen "Always", produce byte-identical `data`, byte-identical `fullContentDigest` / `semanticDigest`, and byte-identical engine `report` (`SEMANTICS-S3.md` §S3-7 / `SEMANTICS-R6.md` R6-INV-2). |
| **LTA-INV-2** | No engine, grammar, schema, or digest **behaviour** change. `stateExpr.ts` gains two pure functions (§LTA4.1/§LTA4.2) with no new recognised `timing` / `when` value and no change to `parseLabelTiming` / `parseLabelWhen` / `step.ts`'s own CSU3-5 validation *logic*. The one exception (LTA-D13) is `ROUTER_KINDS` relocating from `step.ts` to `stateExpr.ts` as a re-exported constant — identical value, identical `Set` contents, verified byte-for-byte by the existing engine suite. This is an authoring surface over `SEMANTICS-S3.md` / `SEMANTICS-R6.md`, exactly as `docs/register-expression-authoring.md` is over `loop-expr/1` — the frozen documents are read, never amended, by this slice. |
| **LTA-INV-3** | **The structured control never freshly authors a state its own classifier or eligibility check calls invalid** (§LTA4) — an option that is not *currently* valid for the edge's source / target / modifier is **disabled**, not silently committable (§LTA10-D2, reversing this document's first draft). Separately, and just as firmly: **an already-stored value that later becomes invalid — by a reconnect, an import, or a hand edit — is never auto-corrected.** It round-trips verbatim; only a warning changes. New wrongness is prevented at the point of a fresh, structured choice; existing wrongness is preserved and explained, never silently fixed. (Free-text entry — the modifier field itself — is a different contract, §LTA5 / RXA-INV-5: it can never be "disabled," so it stays warn-and-commit.) |
| **LTA-INV-4** | **Locked / mobile:** read-only. The current classification (§LTA4.1) and any warning render as text, with the same line as the editable state; no radios, no `select`, no keyboard target. Mirrors `docs/register-expression-authoring.md` §RXA5's mobile rule verbatim. |
| **LTA-INV-5** | Mode switches **preserve** `timing` / `when` on the edge's `data` — the control hides while `mode !== 'label'`, but nothing is deleted (matching the actual `{ ...ed, mode }` spread already in `Inspector.tsx`, and mirroring how `delay` already survives a switch away from `trigger`). Returning to `label` mode re-shows whichever classification (§LTA4.1) those preserved fields represent — never reset to "Always" — unless the author explicitly picks a preset. |
| **LTA-INV-6** | **Native `<input type="radio">` elements, real `disabled` attribute — no custom ARIA radio, no hand-rolled roving `tabindex`.** (§LTA7, LTA-D10 — round 3) A disabled option is skipped by `Tab` and by arrow navigation, exactly as the platform already does for any disabled radio; its reason is never gated behind reaching it via a special focus path, because it is **always visible as plain text** next to the option, not revealed only on focus. Each option's accessible name states its consequence, not its internal id. |
| **LTA-INV-7** | EN / KO / JA copy ships in the same PR as the control (matching every other Inspector field). **No internal identifier — `phase0`, `afterPull`, `source-fired`, or the raw field names `timing` / `when` — appears in any user-facing string**, in any locale, in a normal-operation state. (The one narrow exception, and only there: the "unsupported combination" message may echo the literal stored values so the author can see what a hand-edited file actually contains — §LTA4.4 / §LTA10-D5.) |
| **LTA-INV-8** | A preset switch is **one atomic edit**: one `setEdgeData` call carrying both keys' final state together (never one call per key), one commit, one undo entry, **exactly one** `simulationRev` bump. No intermediate render or saved state ever shows only one of `timing` / `when` present when the other is required — every render is one of: neither key, or both keys, or (only for a pre-existing / imported value) whatever the file actually had, verbatim. |

## LTA3. The preset model

Following Hanrim's brief exactly: **one control, two named outcomes**, no
free combination of `timing` and `when`.

| preset | writes | EN | KO | JA |
|---|---|---|---|---|
| **A — Always** (default) | *(no `timing`, no `when`)* | "Always — at the start of every step" | "항상 · 단계 시작 시" | "常に · ステップ開始時" |
| **B — On source fire** | `timing: "afterPull", when: "source-fired"` | "When the source fires — after this step's results" | "소스 실행 시 · 단계 처리 후" | "ソース実行時 · ステップ処理後" |

Field label (above the two options): EN "When it applies" / KO "적용 시점" /
JA "適用タイミング" — never "Timing" alone, to avoid echoing the internal
field name (LTA-INV-7).

- **Placement:** immediately after the existing modifier field
  (`ExprField kind="label"`), inside `StateEdgeFields`'s `ed.mode === 'label'`
  branch (`src/components/Inspector.tsx` — the exact insertion point already
  exists; no restructuring of the surrounding fields).
- **Rendering:** a `role="radiogroup"` of two rows, each a label + one-line
  description (the EN strings above serve as both — no separate "helper text"
  needed, since the outcome IS the label per Hanrim's ask #2).
- **Default for a brand-new label edge:** Preset A, unchanged from today — a
  new label edge has never had `timing` / `when`, so "new edge" and "Preset A
  selected" are the same state; no migration, no first-run prompt.
- **A pre-existing label edge from before this feature:** classifies as `A`
  (§LTA4.1) — every currently-saved graph opens with every label showing
  "Always", the correct and only truthful reading.

This closes Hanrim's ask #5 (bundle vs. independent fields) as: **bundle**.
It structurally forecloses `phase0 + when` (§S3-5 row 2) and `afterPull` with
no `when` / a foreign `when` (§S3-5 rows 3–4) from ever being **freshly
authored** — no control combination produces them (§LTA4.1/LTA-INV-3).

## LTA4. Classification & eligibility

Two independent questions, deliberately kept separate because they are
answered by different code and change for different reasons:

1. **Classification (§LTA4.1)** — a pure function of the two stored fields
   alone: does `(timing, when)` mean `phase0`, `afterPull`, or neither?
2. **Eligibility (§LTA4.2)** — given the edge's *current graph context*
   (its source node's kind, its target node's kind, its modifier's parsed
   token), is the classified preset — or the *other*, not-yet-chosen preset —
   one `SEMANTICS-S3.md` §S3-5 would actually run, or would it fail-close?

A stored value can be classification-`unsupported` (bad on its own, rows
1–4) while being eligibility-fine, or classification-valid (`phase0` /
`afterPull`) while being eligibility-bad (rows 5–8, a graph-context problem).
The control's rendering and its disable rules (§LTA4.3) combine both.

### LTA4.1 Classification — a shared, engine-agreeing function

New in `src/engine/stateExpr.ts` (alongside `parseLabelTiming` /
`parseLabelWhen`, which it composes — no new grammar, LTA-INV-2):

```ts
export type LabelTimingClass = 'phase0' | 'afterPull' | 'unsupported'

export function classifyLabelTiming(rawTiming: unknown, rawWhen: unknown): LabelTimingClass {
  const t = parseLabelTiming(rawTiming)
  if (!t.ok) return 'unsupported'                          // S3-5 row 1
  if (t.timing === 'phase0') {
    return rawWhen === undefined ? 'phase0' : 'unsupported' // S3-5 row 2
  }
  const w = parseLabelWhen(rawWhen)
  return w.ok ? 'afterPull' : 'unsupported'                 // S3-5 rows 3 + 4
}
```

This is **exactly** `SEMANTICS-S3.md` §S3-5's rows 1–4, and only those rows —
rows 5–8 are graph-context (§LTA4.2), not a property of `(timing, when)`
alone. Both the engine (`step.ts`, indirectly — its own inline checks stay as
they are; this function is not wired into `step.ts`, which needs no change,
LTA-INV-2) and the Inspector read the **same** rows 1–4 logic because the
Inspector calls this **one** function — never a re-derived condition living
only in `Inspector.tsx` (LTA-D8). This directly answers Hanrim's finding #1:
the four example bad combinations —

- `phase0 + source-fired` (row 2)
- `afterPull` + no `when` (row 3)
- no `timing` + `source-fired` (identical to the first — absent `timing`
  normalises to `phase0` before the `when` check runs)
- `afterPull` + an unrecognised `when` (row 4)

— are all four `unsupported` by this one function, alongside a genuinely
unrecognised `timing` string (row 1). §LTA9 tests all four plus row 1
explicitly, by id, not just "some bad value."

### LTA4.2 Eligibility — one function, and it names each disqualifying reason

Round 2 modelled eligibility as two independent per-preset boolean checks and
missed `SEMANTICS-S3.md` §S3-5 row 7 (an empty / unparseable modifier)
entirely. Round 3 replaced the two booleans with one function returning
`'A' | 'B' | null` — because A and B **cannot both be eligible for the same
edge** (A requires a Pool source, B requires a Router source, and a node has
exactly one kind), so a single-valued return makes the impossible "both
eligible" state unrepresentable.

**Round 4 (Hanrim's finding #1)**: that return type still under-serves the
UI. A disabled radio needs its *own* reason rendered beside it (§LTA4.3), and
a bare `'A' | 'B' | null'` forces the Inspector to **re-derive** why the
non-eligible option failed — which is exactly the "one shared function"
promise (LTA-D8) breaking down one function later. The function now returns
a small structured result naming **both** options' status:

```ts
// New in src/engine/stateExpr.ts, beside classifyLabelTiming — a pure
// function of graph context, not of the stored timing/when (LTA-D8/D11).
export type LabelPresetReasonA = 'target-not-pool' | 'modifier-invalid' | 'source-not-pool'
export type LabelPresetReasonB = 'target-not-pool' | 'modifier-invalid' | 'source-not-router' | 's-form'

export type LabelPresetEligibility = {
  eligible: 'A' | 'B' | null
  /** present iff A is NOT eligible — the ONE reason, in §LTA4.2's priority order */
  reasonA?: LabelPresetReasonA
  /** present iff B is NOT eligible */
  reasonB?: LabelPresetReasonB
}

export function eligibleLabelPreset(ctx: {
  targetKind: NodeKind | undefined   // undefined = target id doesn't resolve
  sourceKind: NodeKind | undefined   // undefined = source id doesn't resolve
  modifier: LabelParse                // parseLabelExpr(expr)
}): LabelPresetEligibility {
  // a condition that disqualifies BOTH presets identically — checked first,
  // same priority order as §LTA6's display rule
  const common: LabelPresetReasonA & LabelPresetReasonB | undefined =
    ctx.targetKind !== 'pool' ? 'target-not-pool' : !ctx.modifier.ok ? 'modifier-invalid' : undefined

  const reasonA = common ?? (ctx.sourceKind !== 'pool' ? 'source-not-pool' : undefined)
  const reasonB =
    common ??
    (!ctx.sourceKind || !ROUTER_KINDS.has(ctx.sourceKind)
      ? 'source-not-router'
      : ctx.modifier.token !== 'N'
        ? 's-form'
        : undefined)

  const eligible = !reasonA ? 'A' : !reasonB ? 'B' : null
  return { eligible, ...(reasonA ? { reasonA } : {}), ...(reasonB ? { reasonB } : {}) }
}
```

| condition | sets | required by |
|---|---|---|
| **target is a Pool** (present, `kind === 'pool'`) | `reasonA = reasonB = 'target-not-pool'` | `SEMANTICS-S3.md` §S3-5 row 6 (`afterPull`) + the pre-existing `loop-state/1` rule (`phase0`) |
| **modifier parses** (`parseLabelExpr(expr).ok`) | `reasonA = reasonB = 'modifier-invalid'` | `SEMANTICS-S3.md` §S3-5 row 7 (`afterPull`) + the pre-existing `loop-state/1` rule (`phase0`) |
| **source is a Pool** | else, `reasonA` absent; else `reasonA = 'source-not-pool'` | pre-existing `loop-state/1` rule |
| **source is a Router** (`ROUTER_KINDS`) **and** modifier token is `'N'` | else, `reasonB` absent; else `'source-not-router'` (not a Router) or `'s-form'` (Router, but not `'N'`) | `SEMANTICS-S3.md` §S3-5 rows 5 + 8 |

Worked example matching Hanrim's own — a Router source with an `S`-form
modifier, valid Pool target: `common` is `undefined` (target and modifier are
both fine on their own), `reasonA = 'source-not-pool'` (the source is a
Router, not a Pool), `reasonB = 's-form'` (the source qualifies but the
modifier's token doesn't) → `eligible: null`, **both** reasons present and
**different**, exactly as Hanrim's example calls for. A `Source`-kind source
gives `reasonA: 'source-not-pool'`, `reasonB: 'source-not-router'` — two
different reasons again, neither of which is "s-form" (the modifier was never
the problem there).

**LTA-D13 (round 4, reversing round 3's "accepted duplication"):**
`ROUTER_KINDS`'s canonical definition **moves** from `step.ts` to
`stateExpr.ts`; `step.ts` **imports it and explicitly re-exports it**:

```ts
// step.ts
import { ROUTER_KINDS, parseLabelTiming, parseLabelWhen, parseLabelExpr } from './stateExpr'
export { ROUTER_KINDS } from './stateExpr'
```

A bare `import` does **not** implicitly re-export a name — an `export { … }
from` line is required, or `src/engine/index.ts`'s existing `export {
initSim, step, ROUTER_KINDS } from './step'` would fail to resolve
`ROUTER_KINDS` and the build would not typecheck (round-4 correction, a
mechanical finding: round 3's phrasing said "re-exports it exactly as
before" without writing the line that actually does so). With the explicit
`export` line added, `src/engine/index.ts` itself needs **zero** changes.
Two lines of `step.ts` change (the import, and the re-export); zero lines of
`step.ts`'s CSU3-5 validation *logic* change; the existing engine test suite
(unmodified) is the byte-parity check, and the implementation PR additionally
confirms both the `../engine` barrel import path and a direct `./step`
import of `ROUTER_KINDS` still resolve (§LTA9 test 18). Hanrim's reasoning
for doing this at all: a design whose entire premise is "the engine and the
Inspector share one predicate" should not ship a second, independently
maintained copy of that predicate's own vocabulary on day one — the "no
`step.ts` change" boundary (§LTA1) was drawn too wide; it should protect
`step.ts`'s *validation behaviour*, not a constant this document explicitly
depends on staying identical to the engine's.

`eligibleLabelPreset` is **pure and synchronous** — built for exactly the
kind of direct unit test Hanrim's finding #3 needs (§LTA9 test 7b),
independent of the live store, `removeNode`, or any React rendering.

### LTA4.3 Two separate display elements — round 4 resolves a real contradiction

Hanrim's finding #2: round 3 said both "exactly one line, ever, under the
group" (§LTA6) and "a reason always visible beside every disabled option"
(§LTA7) — two claims that cannot both hold once more than one thing can need
explaining at once (e.g. the Router-source-with-`S`-modifier example, where
**both** radios are disabled for **different** reasons). Round 4 names two
distinct display elements and gives each exactly one job:

1. **Per-radio short reason** — up to **two** of these can be visible at
   once, one beside each *disabled* radio, always rendered (never gated
   behind focus, LTA-INV-6). Sourced directly from `reasonA` / `reasonB`
   (§LTA4.2) via a fixed lookup (`'target-not-pool'` → its i18n string, etc.)
   — short phrases ("needs a Pool source," not a full sentence), because
   there can be two of them and they sit right next to a compact radio row.
2. **The one line under the whole group** (§LTA6) — describes the
   **consequence of the currently checked option** (or the `unsupported`
   state): the normal preview when it's enabled, or — when it's the checked
   option that's disabled — **the same short reason text as element 1**,
   reused verbatim in that one summary slot, not a separately-worded longer
   sentence. There is exactly one of these, because there is exactly one
   currently-checked (or `unsupported`) state to summarise; it does not
   attempt to also explain the *other*, unchecked radio's disablement, which
   already has its own always-visible text from element 1.

These read from the **same** two computed values per edge:

- **classified** — `classifyLabelTiming(ed.timing, ed.when)` (§LTA4.1):
  `'phase0'`, `'afterPull'`, or `'unsupported'`.
- **{ eligible, reasonA, reasonB }** — `eligibleLabelPreset(ctx)` (§LTA4.2).

A radio is **checked** iff `classified` names it (`'phase0'` → A,
`'afterPull'` → B, `'unsupported'` → neither). A radio is **enabled** iff
`eligible` names it — **regardless of `classified`** (LTA-INV-3). Since
`eligible` is single-valued, **at most one radio is ever enabled**; whichever
one is *not* `eligible` renders its `reasonA` / `reasonB` text beside it
(element 1) unconditionally, whether or not it is also checked.

| `classified` | `eligible` | radio A | radio B | the one group line (element 2) |
|---|---|---|---|---|
| `phase0` | `'A'` | checked, enabled, no reason text | unchecked, disabled, shows `reasonB` | normal preview for A |
| `phase0` | `'B'` or `null` | checked, **disabled**, shows `reasonA` | unchecked, enabled iff `'B'` (else disabled, shows `reasonB`) | `reasonA`'s text (A is checked and disabled) |
| `afterPull` | `'B'` | unchecked, disabled, shows `reasonA` | checked, enabled, no reason text | normal preview for B |
| `afterPull` | `'A'` or `null` | unchecked, enabled iff `'A'` (else disabled, shows `reasonA`) | checked, **disabled**, shows `reasonB` | `reasonB`'s text (B is checked and disabled) |
| `unsupported` | any | neither checked; each shows its own reason text iff disabled | | §LTA4.4 message — **always**, regardless of `reasonA`/`reasonB` (§LTA6 priority: `unsupported` outranks an eligibility reason in the *group line*, but the per-radio texts still show independently) |

There is **no** row with both radios enabled (Hanrim's finding #2 from round
3 — structurally impossible) and **no** row with both radios checked. A
**checked-and-disabled** radio is the one place an *already-stored* value
that graph editing elsewhere made ineligible renders (a reconnect, an edited
modifier, an edited target) — it stays checked (LTA-INV-3 — never silently
changed), shows its own reason beside it, and the *other* radio, if
`eligible` names it, is a live one-click escape hatch. The intended author
flow for fixing it is therefore: **reconnect the source (or fix the target /
modifier) first, then pick the preset that is now eligible** — never the
other order, since the control cannot commit an ineligible pick (LTA-INV-3).

### LTA4.4 The `unsupported` classification

Reached only by opening a file with a stored value `classifyLabelTiming`
rejects (§LTA4.1) — this control never writes one (LTA-INV-1/3). Neither
radio is checked; both raw stored values are preserved verbatim on every
subsequent save (LTA-INV-3) until the author explicitly picks a preset (which
overwrites both keys with that preset's exact shape, LTA-INV-1). `eligible`
(§LTA4.2) is computed exactly as it would be for any other edge — at most one
radio is enabled, and a disabled one shows its own `reasonA` / `reasonB` text
beside it (§LTA4.3's per-radio element), independent of the classification.
The **group line** (§LTA4.3's element 2), however, always shows the
`unsupported` message below, never an eligibility reason, even when one also
applies — it is the more fundamental problem to surface in that one summary
slot. The message is the **one** place raw field values appear (LTA-INV-7 /
§LTA10-D5):

> EN: "This connection has a timing/condition combination Loop Studio
> doesn't support (currently: timing = `nope`, when = `source-fired`) — it
> currently has no effect. Choose one of the two options above to replace
> it."
> KO: "이 연결의 적용 시점/조건 조합을 Loop Studio가 지원하지 않아요(현재
> timing = `nope`, when = `source-fired`) — 지금은 적용되지 않아요. 위 두
> 옵션 중 하나를 선택해서 바꿔주세요."

The interpolated pair always shows **both** fields as currently stored
(`(none)` for an absent one), regardless of which row of §LTA4.1 produced
`unsupported` — one message, one wording, parameterised — rather than four
bespoke strings, one per `SEMANTICS-S3.md` §S3-5 row 1–4. This
message always **takes priority** over an eligibility reason when both are
true (§LTA6) — an unsupported stored value is the more fundamental problem to
surface first, even if the graph context also happens to make one preset
ineligible.

## LTA5. The modifier field's `S`-form gate

`SEMANTICS-S3.md` §S3-5 row 8. Two distinct paths reach an `S`-form under
"On source fire," with **two different, deliberately different, contracts**
(Hanrim's finding #3):

1. **A fresh switch from A to B while the modifier is already an `S`-form.**
   This is a **structured** choice — `eligibleLabelPreset` (§LTA4.2) returns
   `reasonB: 's-form'` in this state (a Router source with a non-`'N'`-token
   modifier), so radio B renders **disabled** with that reason (§LTA6.1:
   "needs a fixed number, not S"), exactly like the source/target/
   modifier-parses conditions. The switch **cannot happen** until the
   modifier is fixed. (Reverses this document's first draft, which allowed
   the switch and warned after the fact.)
2. **Typing `+S` directly into the free-text modifier field while already on
   B.** This is **not** a structured control — it is the same `<input>` every
   other expression uses, and per `docs/register-expression-authoring.md`
   RXA-INV-5 ("the editor never blocks a save … committed and flagged,
   exactly as today"), free text is never disabled or refused. It **commits**
   (the value round-trips) and shows a distinct hint in place of the normal
   "describe the effect" hint:

   > EN: "'On source fire' can only use a fixed number (e.g. +1, =0) — not S."
   > KO: "'소스 실행 시'는 고정된 숫자만 쓸 수 있어요(예: +1, =0) — S는 안 돼요."

Both paths end at the *same stored state* (`afterPull` + `when` +
an `S`-form `expr`, i.e. `classified === 'afterPull'` while `eligible` is
`null` with `reasonB: 's-form'`) — but path 1 never lets that state be
**created** through the radio, while path 2 (already on B, editing the
free-text field) can still reach it, matching the established free-input
precedent. No mutation happens in either direction: neither switching
presets nor typing rewrites the *other* field to compensate. Path 2's inline
hint lives under the modifier `<input>` itself (a separate, field-scoped
message, unchanged from this document's earlier drafts); the radiogroup's
own group line (§LTA6.2) independently shows the same `reasonB` phrase for
the same reason, in its own slot.

## LTA6. The two display elements' actual copy

Per §LTA4.3's round-4 split, this section fixes the wording for **both**
elements — they are not competing for the same slot, so this is no longer a
single "exactly one line" list (round 3's framing, corrected).

### LTA6.1 Per-radio short reason (§LTA4.3 element 1 — up to two visible at once)

One short phrase per `reasonA` / `reasonB` value (§LTA4.2), reused **verbatim**
in element 2 when that radio is also the checked one (§LTA6.2):

| reason | EN phrase |
|---|---|
| `target-not-pool` | "target must be a Pool" |
| `modifier-invalid` | "modifier must be a valid value" |
| `source-not-pool` | "needs a Pool source" |
| `source-not-router` | "needs a Gate, Converter, Drain, or End source" |
| `s-form` | "needs a fixed number, not S" |

The node-kind names (Pool / Gate / Converter / Drain / End) are existing Loop
Studio vocabulary — every one already appears in the node palette and
`inspector.edge.mode.*` — so none of this is new jargon (contrast the internal
identifiers LTA-INV-7 bars). Rendered beside a disabled radio, always, per
LTA-INV-6 — never gated behind focus.

### LTA6.2 The one line under the group (§LTA4.3 element 2)

Exactly one of the following, in this priority order (most fundamental
problem first):

1. **`unsupported` classification** (§LTA4.4) — the stored value itself is
   not one this control recognises; shown regardless of `eligible` /
   `reasonA` / `reasonB`.
2. **The checked radio is disabled** — show *that radio's own* reason phrase
   from §LTA6.1 verbatim (`reasonA` if A is checked, `reasonB` if B is
   checked). This single reuse is *why* §LTA6.1's phrases are written as
   short, self-contained statements rather than half-sentences that only
   make sense inline next to a radio.
3. **Normal preview** — the checked radio is the eligible one.

| state | group line |
|---|---|
| `unsupported` | the §LTA4.4 message |
| A checked, `reasonA` present | §LTA6.1's `reasonA` phrase |
| B checked, `reasonB` present | §LTA6.1's `reasonB` phrase (this is also where the §LTA5 path-2 `S`-form hint surfaces, since that path leaves the edge exactly in "B checked, `reasonB: 's-form'`") |
| A checked, eligible | "Applied at the start of every step." |
| B checked, eligible | "Applied once this connection's source fires this step, right after this step's results are computed." |

Locked / mobile (LTA-INV-4) renders both elements as plain text in the same
positions — §LTA6.1's phrases beside the (now unclickable) options, §LTA6.2's
line below the group.

## LTA7. Keyboard, screen reader, IME, mobile, locked

- **Keyboard (round 3 — LTA-D10, reversing round 2's custom-ARIA sketch):**
  **native `<input type="radio">` elements**, real `disabled` attribute, no
  custom `role`, no hand-rolled roving `tabindex`. This means the platform's
  own behaviour applies unmodified: `↑`/`↓` (and `←`/`→`) move selection
  between **enabled** options only; a disabled option is skipped by both
  `Tab` and arrow navigation, exactly as any disabled native radio already
  is anywhere else in this app. Because at most one option is ever enabled
  (§LTA4.3), this is never a dead end — the one live option is always
  reachable, and the disabled one's reason is **always rendered as visible
  text right next to it** (not gated behind focusing it, since a native
  disabled control cannot receive focus at all). Selecting the enabled option
  commits immediately (no separate "apply" step, matching every other
  Inspector `select`).
- **Screen reader — two different ARIA mechanisms for two different jobs**
  (Hanrim's minor-cleanup note, unchanged from round 2): the normal preview
  line (§LTA6's last row) is **not** a live region — it is static text the
  radiogroup already points at via `aria-describedby`, since its content
  already restates the checked option's consequence and a live region would
  double-announce what the option's own accessible name just said. A
  **warning** (§LTA6's first four rows) uses `aria-live="polite"`, because it
  can appear or change as a *side effect* of an edit elsewhere (reconnecting
  the source, editing the target, editing the modifier) without the
  radiogroup receiving focus, and that change genuinely needs announcing. A
  disabled option's reason text (always visible, per the keyboard bullet
  above) is also its `aria-describedby` target, so a screen reader reading
  that option states the reason without needing a live region either.
- **IME:** not applicable to the radiogroup itself (no free-text entry — the
  two presets are chosen, not typed). The adjacent modifier field's existing
  IME behaviour (none needed — it's a numeric/operator grammar) is unchanged.
- **Mobile:** LTA-INV-4 — read-only text, matching the established
  `docs/mobile.md` §MV3a edit-lock precedent exactly (canvas edit-locked on
  mobile ⇒ this field, like every other Inspector field, is not reachable to
  *edit*, only to read).
- **Locked (desktop):** same as mobile — LTA-INV-4.

## LTA8. i18n

New keys (naming to match the existing `inspector.*` namespace convention;
final key names are an implementation detail, not fixed by this document).
**Eleven** keys (round 2 undercounted at six; round 3 adds the
modifier-parses warning, Hanrim's finding #1):

1. `inspector.field.labelTiming` — the field label ("When it applies" / "적용
   시점" / "適用タイミング").
2. `inspector.labelTiming.always` — preset A's option text (§LTA3).
3. `inspector.labelTiming.afterPull` — preset B's option text (§LTA3).
4. `inspector.labelTiming.previewAlways` — §LTA6's normal-preview row for A.
5. `inspector.labelTiming.previewAfterPull` — §LTA6's normal-preview row for B.
6. `inspector.labelTiming.warnTargetNotPool` — §LTA6's target row — shared by
   both presets, reused verbatim as the disabled-reason text for whichever
   radio(s) it disables.
7. `inspector.labelTiming.warnModifierInvalid` — §LTA6's modifier-doesn't-parse
   row (round 3 addition) — shared by both presets, same reuse pattern.
8. `inspector.labelTiming.warnSourceNotPool` — §LTA6's "A checked, not
   eligible" row, reused as A's disabled-reason text.
9. `inspector.labelTiming.warnSourceNotRouter` — §LTA6's "B checked, not
   eligible (source)" row, reused as B's disabled-reason text.
10. `inspector.labelTiming.warnSForm` — §LTA5 (both paths) / §LTA6, reused as
    B's disabled-reason text when the modifier is already an `S`-form.
11. `inspector.labelTiming.unsupported` — §LTA4.4 (interpolates the two raw
    stored values — the one exception, LTA-INV-7 / §LTA10-D5).

Key *names* remain an implementation detail per §LTA10-D7; the count is fixed
here only so the implementation PR's i18n diff isn't a surprise.

All ship in EN / KO / JA in the same PR as the control (LTA-INV-7), following
`docs/i18n.md`'s existing per-locale-file convention
(`src/i18n/locales/{en,ko,ja}/inspector.ts`) and checked by the existing
`check-i18n.mjs` completeness gate — no exception requested.

## LTA9. Acceptance / E2E

Keyed on node / edge ids, never rendered labels (matching every other
Inspector E2E suite in this codebase).

**Classification (§LTA4.1), unit-level in `stateExpr.test.ts`:**

1. `classifyLabelTiming(undefined, undefined)` and `('phase0', undefined)` →
   `'phase0'`.
2. `classifyLabelTiming('afterPull', 'source-fired')` → `'afterPull'`.
3. Each of the four named bad combinations classifies `'unsupported'`,
   individually asserted by name: `('phase0', 'source-fired')`,
   `('afterPull', undefined)`, `(undefined, 'source-fired')`,
   `('afterPull', 'level>=5')` — plus a fifth, `('nope', 'source-fired')`
   (row 1, an unrecognised `timing`).

**Round-trip / atomicity (Inspector-level):**

4. **Default (LTA-INV-1a):** a freshly-created label edge classifies `A`; its
   `data` carries no `timing` / `when` key; the file's `fullContentDigest`
   after save equals the pre-feature digest for the same graph.
5. **Preset B write (LTA-INV-1b) on an eligible edge:** selecting B sets
   `timing: "afterPull", when: "source-fired"` exactly, in one call — spy on
   `setEdgeData` and assert exactly one invocation, with both keys present in
   its single argument (LTA-INV-8); one undo entry; `simulationRev` bumps by
   exactly one.
6. **Round-trip back to A:** selecting A on an edge currently on B deletes
   both keys (not `timing: "phase0"`) in one call; digest returns to what it
   was before B was ever chosen; one undo entry; one `simulationRev` bump.

**Eligibility (`eligibleLabelPreset`), unit-level in `stateExpr.test.ts`
(§LTA4.2, Hanrim's finding #1 + #3):**

7a. `eligibleLabelPreset` for a Pool source + Pool target + parseable
    non-`S` modifier returns `{ eligible: 'A', reasonB: 'source-not-router' }`
    (no `reasonA`); for a Router source + Pool target + an `'N'`-token
    modifier returns `{ eligible: 'B', reasonA: 'source-not-pool' }` (no
    `reasonB`); for a Router source + Pool target + an `S`-token modifier
    returns `{ eligible: null, reasonA: 'source-not-pool', reasonB: 's-form' }`
    — **both** reasons present and **different**, Hanrim's own worked
    example; for a `Source`-kind source + Pool target returns
    `{ eligible: null, reasonA: 'source-not-pool', reasonB: 'source-not-router' }`;
    for a non-Pool target (any source) returns
    `{ eligible: null, reasonA: 'target-not-pool', reasonB: 'target-not-pool' }`;
    and — the round-3 addition — for an **unparseable modifier**
    (`expr: ''` and `expr: 'garbage'`, Pool target) returns
    `{ eligible: null, reasonA: 'modifier-invalid', reasonB: 'modifier-invalid' }`.
    All asserted with a **synthetic** `{ targetKind, sourceKind, modifier }`
    context object, not through the live store — this is what makes the next
    test (7b) possible without `removeNode`'s cascade getting in the way.
7b. **Missing target/source id (a dangling reference reachable only by
    import, not by the UI's own delete — Hanrim's finding #3):**
    `eligibleLabelPreset({ targetKind: undefined, ... })` returns
    `{ eligible: null, reasonA: 'target-not-pool', reasonB: 'target-not-pool' }`
    and `({ sourceKind: undefined, targetKind: 'pool', ... })` returns
    `{ eligible: null, reasonA: 'source-not-pool', reasonB: 'source-not-router' }`,
    via the same synthetic-context unit test as 7a. **Not** an E2E test —
    this codebase's `removeNode` cascades incident-edge deletion, so a
    target/source can never be missing on an edge still reachable from the
    Inspector through normal UI actions; the defensive case exists only for
    a hand-edited or externally-produced file with a dangling edge, and is
    exercised as a pure function call, never by trying to delete a node out
    from under a selected edge in the running app.

**Eligibility rendering / disabling in the Inspector (§LTA4.3, reversing the
round-2 draft's allow-then-warn stance):**

7c. **Target ineligible, reachable through the UI:** a label whose target
    **is a Gate** (a real, existing, wrong-kind node — not a deleted one,
    per 7b's split) shows **both** radios disabled, each showing the
    `target-not-pool` phrase beside it (§LTA6.1), and the group line
    (§LTA6.2) also showing that phrase (whichever radio happens to be
    checked); clicking either radio does nothing (no `setEdgeData` call).
7d. **Modifier doesn't parse:** a label with an empty modifier shows **both**
    radios disabled with the `modifier-invalid` phrase beside each,
    regardless of source/target; typing a valid modifier re-enables
    whichever radio `eligible` now names.
8. **Source ineligible for A:** a label sourced from a Gate, classified `A`
   (e.g. a pre-existing file): `eligibleLabelPreset` returns
   `{ eligible: 'B', reasonA: 'source-not-pool' }` — radio A renders
   **checked and disabled** with `reasonA`'s phrase beside it, B **unchecked
   and enabled** with no reason text; clicking B switches to B normally; A
   never becomes freshly selectable while the source stays a Gate (there is
   nothing to click — it's disabled).
9. **Source ineligible for B:** a label sourced from a Pool, classified `A`:
   `eligibleLabelPreset` returns `{ eligible: 'A', reasonB: 'source-not-router' }`
   — radio B renders **disabled** with that phrase beside it; there is no
   click to make on it; if a test harness dispatches a change event on it
   anyway, assert no `setEdgeData` call fires, no digest change, `timing`/
   `when` stay exactly as before.
10. **Modifier `S`-form blocks a fresh switch to B (§LTA5 path 1):** a label
    with modifier `-S`, source a Router, classified `A`:
    `eligibleLabelPreset` returns
    `{ eligible: null, reasonA: 'source-not-pool', reasonB: 's-form' }` — B
    renders disabled with the `s-form` phrase, A renders **checked and
    disabled** with the `source-not-pool` phrase (A was never eligible here
    either — the source is a Router); changing the modifier to `-1` makes
    `eligibleLabelPreset` return `{ eligible: 'B', reasonA: 'source-not-pool' }`,
    enabling B; only then does clicking B commit.
11. **Free-text `S` on an already-B edge still commits (§LTA5 path 2):**
    typing `+S` into the modifier field while B is selected still commits the
    expression change (round-trips on reload) and shows the §LTA5 hint under
    the modifier field; the stored `timing`/`when` are untouched by this
    edit. The edge is now `classified === 'afterPull'` with
    `reasonB: 's-form'` — the radiogroup's own group line (§LTA6.2) shows the
    same `s-form` phrase, matching test 10's B-disabled rendering reached
    from the other direction.
12. **An already-stored value that becomes ineligible is preserved, never
    auto-corrected:** start with a valid `B` edge (Router source, Pool
    target, `'N'`-token modifier); reconnect its source to a Pool via the
    canvas (not through this control); reload the Inspector selection —
    `timing`/`when` are **unchanged** on disk (assert via the saved file /
    digest), radio B renders checked-and-disabled with the
    `source-not-router` phrase, and radio A (now
    `eligibleLabelPreset` returns `{ eligible: 'A', ... }`) is enabled to fix
    it with one click.
13. **Unsupported classification (§LTA4.4), with at most one radio ever
    enabled (round-3 correction — the round-2 draft's "both enabled" premise
    was impossible, Hanrim's finding #2):** loading a fixture with
    `data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope', when: 'source-fired' }`
    on an edge with a **Pool** source and Pool target shows neither preset
    checked, both raw values in the group-line message, radio A **enabled**
    (no `reasonA`) and radio B **disabled** (`reasonB: 'source-not-router'`,
    shown beside it even though the group line shows the `unsupported`
    message instead, per §LTA4.4); choosing A replaces it with the clean
    shape (test 4's assertions). A second variant of the *same* fixture with
    a **Router** source instead shows the mirror image — B enabled, A
    disabled (`reasonA: 'source-not-pool'`), choosing B replaces it with the
    clean shape (test 5's assertions). A third variant with a **Source**-kind
    source shows **both** disabled (matching 7a/7c) — the group-line message
    is shown, each radio shows its own reason beside it, but neither preset
    can be freshly chosen until the source is reconnected. Each of the other
    three named bad combinations (test 3) is checked once, on the Pool-source
    variant, for the classification-only assertion (the eligibility matrix is
    not re-run five times).

**Mode switch (LTA-INV-5, correcting the first draft's reversed claim):**

14. Switching a state edge's mode away from `label` (to `trigger` /
    `activator`) hides the control, but a subsequent inspection of the edge's
    raw `data` shows `timing` / `when` **still present**, byte-for-byte
    (mirroring `delay` surviving a switch away from `trigger` today).
    Switching back to `label` re-shows the **same** classification (§LTA4.1)
    those preserved fields represent — not reset to "Always."

**Other:**

15. **Locked / mobile (LTA-INV-4):** a selected label edge on a locked canvas
    or mobile viewport shows the current classification (or the §LTA4.4
    message) as plain text with the appropriate line from §LTA6, no radio
    inputs, no keyboard target.
16. **Keyboard + SR (LTA-INV-6/§LTA7, round-3 native-radio contract):** `Tab`
    reaches the radiogroup and lands on the one enabled option (never a
    disabled one — native `disabled` skips it); when both options happen to
    be disabled (test 7c/7d's states) `Tab` skips the whole group, and the
    warning is still readable as ordinary page content; arrow keys never move
    focus onto a disabled option (platform default, not custom code); each
    disabled option's reason renders as visible text and is that option's
    `aria-describedby` target; the checked option's static preview is
    reachable via `aria-describedby` (present, correctly associated, **not**
    inside an `aria-live` region); a warning appears inside an
    `aria-live="polite"` region and updates when triggered by an edit
    elsewhere (e.g. test 12's reconnect) without the radiogroup itself
    needing focus.
17. **Localisation (LTA-INV-7):** all eleven §LTA8 strings present and
    rendered correctly in EN / KO / JA; none of `phase0` / `afterPull` /
    `source-fired` / the bare words `timing` / `when` appears in any of the
    non-`unsupported` strings in any locale (a grep-based lint in the E2E
    suite, mirroring the existing `check-i18n.mjs` style of mechanical
    checks).
18. **No engine/digest regression (LTA-INV-2):** the full existing
    `state.afterpull.test.ts` / `gacha-pity-timing.probe.test.ts` /
    `revision.csu.test.ts` / `revision-v6-fixture.test.ts` suites are
    unaffected and unmodified — this is the byte-parity check for
    `ROUTER_KINDS`'s relocation (LTA-D13): the two permitted `step.ts` lines
    are the import and its explicit re-export (§LTA4.2's code block), and if
    the relocation altered `ROUTER_KINDS`'s value or behaviour in any way,
    one of these existing suites (which already exercise `ROUTER_KINDS`-gated
    logic — the `afterPull` source-kind checks) would fail. Additionally:
    both `import { ROUTER_KINDS } from '../engine'` (the existing barrel
    path) and `import { ROUTER_KINDS } from '../engine/step'` (direct)
    resolve to the same value after the relocation — a one-line typecheck-
    level assertion, guarding specifically against the missing-re-export
    mistake this round's review caught. `step.ts`'s diff for this slice's
    implementation PR is exactly those two lines, reviewable at a glance;
    everything else that could move CSU3-5 behaviour is untouched.

## LTA10. Decisions

| id | question | decision |
|---|---|---|
| **LTA-D1** | independent `timing`/`when` fields, an "advanced" toggle, or a bundled preset? | **Bundled, two-option preset, no advanced mode.** (§LTA3) `loop-state/3` v1 has exactly one non-default value per field, so two named outcomes already cover the full valid space; an advanced mode would exist only to let an author construct a state `SEMANTICS-S3.md` §S3-5 already forbids. Revisit only if a future spec revision adds a second `when`. |
| **LTA-D2** | hard-disable a currently-ineligible preset for a *fresh* pick, or allow + warn? | **Hard-disable a fresh pick; never rewrite an existing one.** (§LTA4.3, LTA-INV-3) **Reverses this document's first draft.** Matches `docs/register-expression-authoring.md`'s "disable + reason" precedent for a wrong-kind autocomplete candidate more closely than this draft first judged: the structured radio, like the reference picker, is a *discrete, re-derivable-every-render* choice, not free text — there is no cost to recomputing its enabled state on every render, and doing so is strictly safer than letting the control author a combination `SEMANTICS-S3.md` already fail-closes. An *already-stored* value that becomes ineligible through unrelated graph edits is a different situation (nothing was freshly chosen) and is preserved + warned, never corrected (Hanrim's "새로운 잘못은 막고, 이미 존재하는 잘못은 조용히 고치지 않는다"). |
| **LTA-D3** | block a fresh switch to B while the modifier is an `S`-form, or warn only? | **Block the switch (§LTA5 path 1); free-text entry of `S` while already on B still warns-and-commits (path 2), unchanged.** Two different input mechanisms, two different contracts — the radio is structured and re-derivable (§LTA-D2's reasoning applies identically), the modifier `<input>` is free text and RXA-INV-5 already governs it. |
| **LTA-D4** | should selecting "Always" ever write the literal `timing: "phase0"`? | **No — delete both keys.** (LTA-INV-1a) Byte-identical to "never touched," which is both simpler to reason about and the only way every pre-existing graph's digest stays untouched by this feature shipping. |
| **LTA-D5** | show the raw stored string(s) for an unsupported value? | **Yes, in that one message only, and now both fields together** (not just `timing` — this draft's first pass showed only the offending `timing` value; §LTA4.4 always shows the full `(timing, when)` pair since row 2's failure mode is a bad `when` on an otherwise-fine `phase0`). It is diagnostic content about a file the tool did not produce this way; hiding it would make an already-confusing state harder to debug, and it cannot leak into the normal-operation strings LTA-INV-7 protects since those never carry the raw field name at all. |
| **LTA-D6** | surface the pre-existing "needs a Pool source/target/parseable modifier" gaps now, or leave them alone since they predate CSU? | **Surface all three now.** (§LTA4.2) The eligibility check for preset B already computes source kind; adding the symmetric source-for-A check, the target-for-both check `SEMANTICS-S3.md` §S3-5 row 6 explicitly names, and (round 3, Hanrim's finding #1) the modifier-parses-for-both check row 7 names, closes real, pre-existing silent-failure gaps for a near-zero marginal cost, and is more consistent than shipping only a subset of them. |
| **LTA-D7** | exact i18n key names, warning copy wording, radiogroup visual styling | Not fixed here — implementation detail, finalised during the impl PR against the real Inspector layout (mirrors RXA10-D7's precedent for tunable constants). The **meaning** of each string (§LTA3/§LTA4/§LTA5/§LTA6/§LTA8) is what this document fixes. |
| **LTA-D8** | where does the `phase0`/`afterPull`/`unsupported` classification logic live? | **`src/engine/stateExpr.ts`, one shared function (§LTA4.1), not re-derived in `Inspector.tsx`.** Follows the file's own stated charter ("the engine and the editor must always agree on what is recognised") to its logical conclusion: `parseLabelTiming` / `parseLabelWhen` already live there for exactly this reason; the composition of the two into the three-way answer the Inspector needs belongs beside them, not duplicated. |
| **LTA-D9** | one `aria-live` region for everything, or split? | **Split.** (§LTA7) The static, always-true-while-checked preview is reached via `aria-describedby` (no live announcement — it would double the option's own accessible name); only a warning, which can appear as a side effect of an edit elsewhere, uses `aria-live="polite"`. Avoids the redundant-announcement issue Hanrim flagged. |
| **LTA-D10** | native `<input type="radio" disabled>`, or a custom `role="radio"` with hand-rolled roving focus so a disabled option stays arrow-reachable? | **Native, round 3 — reverses round 2's sketch.** (LTA-INV-6, §LTA7) Hanrim's finding #4: "arrow-navigable while disabled" is not one native contract, it's two incompatible ones layered together. Native radios are the simpler, standards-correct choice once the disabled reason is **always visible as plain text** (not gated behind reaching a focus state a disabled control cannot enter) — which §LTA4.3's "at most one option is ever enabled" already makes cheap to guarantee. A custom ARIA radio is reserved for a future need that actually requires arrow-navigating *onto* a disabled option, which this control does not have. |
| **LTA-D11** | eligibility as two independent per-preset booleans, or one unified function? | **One function** (§LTA4.2). Round 2's two-boolean model could describe "both eligible," which Hanrim's finding #2 (round 3) shows is structurally impossible (A needs a Pool source, B needs a Router source — mutually exclusive by node-kind). A single function makes the impossible state unrepresentable rather than merely untested, and gives it a natural pure-unit-test surface (§LTA9 tests 7a/7b) independent of the live store — which is also how the unreachable deleted-target E2E gets resolved: the defensive "missing node" case moves to a synthetic-context unit test instead of an impossible UI interaction. |
| **LTA-D12** | should the eligibility function return just `'A' \| 'B' \| null'`, or name each option's disqualifying reason? | **Name both reasons.** (§LTA4.2, round 4, Hanrim's finding #1) A bare tri-state return forces the Inspector to re-derive *why* the non-eligible option failed, to render its per-radio text (§LTA6.1) — silently reintroducing the "the engine and the Inspector must agree" risk this whole design exists to close (LTA-D8), one function later. `{ eligible, reasonA?, reasonB? }` makes the shared function the **only** place either question is answered, for both radios, every time. |
| **LTA-D13** | relocate `ROUTER_KINDS` into `stateExpr.ts` now (`step.ts` lines change), or keep the round-3 duplicated literal? | **Relocate now, via import + explicit re-export.** (§LTA4.2, round 4, reversing round 3's "accepted duplication"; the import/re-export split itself is a round-4 mechanical correction — a bare `import` doesn't re-export, so `src/engine/index.ts`'s existing `ROUTER_KINDS` export needs `step.ts` to carry an explicit `export { ROUTER_KINDS } from './stateExpr'` line, not just the import.) Hanrim's reasoning for the relocation itself: a design whose central claim is "the engine and the Inspector share one predicate" should not ship, on day one, a second copy of that predicate's own vocabulary that could silently drift from the original. The refactor is two lines in `step.ts` (import + re-export), zero behavioural lines, and is verified by the existing (unmodified) engine test suite plus a direct-vs-barrel import-resolution check (§LTA9 test 18) — a cost low enough that "avoid touching `step.ts`" (§LTA1's original, too-wide boundary) is the wrong thing to optimise for here. |

## LTA11. Work order

1. **This design doc** — its own PR, reviewed and approved before any UI or
   `stateExpr.ts` code lands (Hanrim; round 4 in progress, 2026-09-12).
2. **Implementation PR** — `ROUTER_KINDS`'s relocation to `stateExpr.ts` +
   `step.ts`'s import + explicit re-export update (LTA-D13, verified against the
   unmodified existing engine suite); `classifyLabelTiming` +
   `eligibleLabelPreset` in `stateExpr.ts` (with unit tests, §LTA9 items 1–3,
   7a, 7b); the radiogroup (native radios, LTA-D10) + per-radio reason text +
   group line (§LTA4.3/§LTA6) + `ExprField`'s `S`-form hint in
   `Inspector.tsx`; EN/KO/JA copy; the full §LTA9 acceptance suite. No
   `revision.ts` or `workspace.ts` change, and no change to `step.ts`'s
   CSU3-5 validation *logic*.
3. **README** — updated only after step 2 ships and is verified (per Hanrim:
   not yet, since the Inspector doesn't exist until then).
4. Unblocks **GS10-3** (gacha hard-pity content) — the first real content
   that needs an author, rather than a test fixture, to set `timing` /
   `when`.
