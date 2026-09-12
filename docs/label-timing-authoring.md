# Label timing authoring (design doc)

**Status: design — pending review (round 3).** CSU8 slice 3
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

- Any change to `step.ts`, `SEMANTICS-S3.md`, or the `loop-revision/6`
  projection (`revision.ts` / `workspace.ts`, `SEMANTICS-R6.md`). This
  document authors *existing*, frozen wire content — it invents no new stored
  shape (LTA-INV-1). The one addition to `stateExpr.ts` is a **pure
  classification helper with no new recognised values** (§LTA4.1) — it
  changes what the Inspector shows, never what the engine accepts.
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
| **LTA-INV-2** | No engine, grammar, schema, or digest change. `stateExpr.ts` gains one pure classification function (§LTA4.1) with no new recognised `timing` / `when` value and no change to `parseLabelTiming` / `parseLabelWhen` / `step.ts`'s own validation. This is an authoring surface over `SEMANTICS-S3.md` / `SEMANTICS-R6.md`, exactly as `docs/register-expression-authoring.md` is over `loop-expr/1` — the frozen documents are read, never amended, by this slice. |
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

### LTA4.2 Eligibility — one unified function, not two independent booleans

Round 2 modelled eligibility as two independent per-preset boolean checks and
missed `SEMANTICS-S3.md` §S3-5 row 7 (an empty / unparseable modifier)
entirely (Hanrim's finding #1). Round 3 replaces it with **one** pure
function returning **at most one** eligible preset, because — as Hanrim's
finding #2 observes — A and B **cannot both be eligible for the same edge**:
A requires a Pool source, B requires a Router source, and a node has exactly
one kind. Modelling them as independent booleans let the round-2 draft
describe an impossible "both eligible" state; a single function that returns
`'A' | 'B' | null` cannot.

```ts
// New in src/engine/stateExpr.ts, beside classifyLabelTiming — a pure
// function of graph context, not of the stored timing/when (LTA-D8/D11).
export type EligibleLabelPreset = 'A' | 'B' | null

export function eligibleLabelPreset(ctx: {
  targetKind: NodeKind | undefined   // undefined = target id doesn't resolve
  sourceKind: NodeKind | undefined   // undefined = source id doesn't resolve
  modifier: LabelParse                // parseLabelExpr(expr)
}): EligibleLabelPreset {
  if (ctx.targetKind !== 'pool') return null        // S3-5 row 6 + the pre-existing phase0 rule
  if (!ctx.modifier.ok) return null                 // S3-5 row 7 (also the pre-existing phase0 rule)
  if (ctx.sourceKind === 'pool') return 'A'
  if (ctx.sourceKind && ROUTER_KINDS.has(ctx.sourceKind) && ctx.modifier.token === 'N') return 'B'
  return null   // source is a Source node, missing, or a Router with an S-form modifier
}
```

| condition | fails → | required by |
|---|---|---|
| **target is a Pool** (present, `kind === 'pool'`) | both (`null`) | `SEMANTICS-S3.md` §S3-5 row 6 (`afterPull`) + the pre-existing `loop-state/1` rule (`phase0`, never before surfaced in the UI — round-2 finding) |
| **modifier parses** (`parseLabelExpr(expr).ok`) | both (`null`) | `SEMANTICS-S3.md` §S3-5 row 7 (`afterPull`) + the pre-existing `loop-state/1` rule (`phase0`) — **round-3 addition, Hanrim's finding #1** |
| **source is a Pool** | ⇒ not `'A'` | pre-existing `loop-state/1` rule |
| **source is a Router** (`ROUTER_KINDS`) **and** modifier token is `'N'` | ⇒ not `'B'` | `SEMANTICS-S3.md` §S3-5 rows 5 + 8 |

A source that is itself a `Source` node satisfies neither the Pool nor the
Router condition ⇒ `null` (Hanrim's "Source/missing source → 둘 다 불가"). A
Router source with an `S`-form modifier also ⇒ `null` — not `'B'` disqualified
alone, since `'A'` was already disqualified by the source not being a Pool;
both are ineligible, for two different individual reasons (§LTA4.3's warning
priority resolves which one is shown).

**Implementation note — accepted, documented duplication (LTA-D11):**
`ROUTER_KINDS` is currently exported *from* `step.ts`, which itself imports
`stateExpr.ts` (`parseLabelTiming`, `parseLabelWhen`, `parseLabelExpr`) —
importing `ROUTER_KINDS` back from `step.ts` into `stateExpr.ts` would be
circular. The implementation PR re-declares the same four-item `Set` literal
in `stateExpr.ts` rather than restructure the import graph (which would touch
`step.ts`, out of scope per §LTA1). This is a real, small duplication risk
(the two literals could drift) — flagged here rather than left implicit; a
future slice may resolve it by moving the canonical `ROUTER_KINDS` into
`stateExpr.ts` and having `step.ts` import it from there instead (a
`step.ts` change, and therefore not this slice's to make).

`eligibleLabelPreset` is **pure and synchronous string-in-string-out** —
built for exactly the kind of direct unit test Hanrim's finding #3 needs
(§LTA9 test 7b), independent of the live store, `removeNode`, or any React
rendering.

### LTA4.3 Combining classification + eligibility → what renders

Two independently-computed values per edge:

- **classified** — `classifyLabelTiming(ed.timing, ed.when)` (§LTA4.1):
  `'phase0'`, `'afterPull'`, or `'unsupported'`.
- **eligible** — `eligibleLabelPreset(ctx)` (§LTA4.2): `'A'`, `'B'`, or `null`.

A radio is **checked** iff `classified` names it (`'phase0'` → A checked,
`'afterPull'` → B checked, `'unsupported'` → neither checked). A radio is
**enabled** iff `eligible` names it — **regardless of `classified`** (LTA-INV-3
— eligibility, never current selection, gates a fresh pick). Since `eligible`
is single-valued, **at most one radio is ever enabled**; the other is always
disabled (with the one reason `eligibleLabelPreset`'s failing condition
names, per §LTA4.2's table, surfaced via §LTA6).

| `classified` | `eligible` | radio A | radio B | line (§LTA6) |
|---|---|---|---|---|
| `phase0` | `'A'` | checked, enabled | unchecked, disabled (source-not-router *or* target/modifier) | normal preview for A |
| `phase0` | `'B'` or `null` | checked, **disabled** | unchecked, enabled iff `'B'` | the reason `eligible` fails for A |
| `afterPull` | `'B'` | unchecked, disabled (source-not-pool *or* target/modifier) | checked, enabled | normal preview for B |
| `afterPull` | `'A'` or `null` | unchecked, enabled iff `'A'` | checked, **disabled** | the reason `eligible` fails for B |
| `unsupported` | `'A'` | unchecked, enabled | unchecked, disabled | §LTA4.4 message (takes priority — §LTA6) |
| `unsupported` | `'B'` | unchecked, disabled | unchecked, enabled | §LTA4.4 message |
| `unsupported` | `null` | unchecked, disabled | unchecked, disabled | §LTA4.4 message — always, even when a target/modifier problem is *also* why `eligible` is `null` (§LTA6 priority: `unsupported` is checked first) |

There is **no** row with both radios enabled (Hanrim's finding #2 — this is
now structurally impossible, not just untested) and **no** row with both
radios checked. A **checked-and-disabled** radio is the one place an
*already-stored* value that graph editing elsewhere made ineligible renders
(a reconnect, an edited modifier, an edited target) — it stays checked
(LTA-INV-3 — never silently changed), and the *other* radio, if `eligible`
names it, is a live one-click escape hatch. The intended author flow for
fixing it is therefore: **reconnect the source (or fix the target / modifier)
first, then pick the preset that is now eligible** — never the other order,
since the control cannot commit an ineligible pick (LTA-INV-3).

### LTA4.4 The `unsupported` classification

Reached only by opening a file with a stored value `classifyLabelTiming`
rejects (§LTA4.1) — this control never writes one (LTA-INV-1/3). Neither
radio is checked; both raw stored values are preserved verbatim on every
subsequent save (LTA-INV-3) until the author explicitly picks a preset (which
overwrites both keys with that preset's exact shape, LTA-INV-1). At most one
radio is enabled, per §LTA4.3's last three rows — never both (round-3
correction of the round-2 draft, which allowed both). The message is the
**one** place raw field values appear (LTA-INV-7 / §LTA10-D5):

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
   `null` in this state (a Router source with a non-`'N'`-token modifier), so
   radio B renders **disabled** (reason: "needs a fixed number, not S"),
   exactly like the source/target/modifier-parses conditions. The switch
   **cannot happen** until the modifier is fixed. (Reverses this document's
   first draft, which allowed the switch and warned after the fact.)
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
an `S`-form `expr`, i.e. `classified === 'afterPull'` while
`eligibleLabelPreset` returns `null`) — but path 1 never lets that state be
**created** through the radio, while path 2 (already on B, editing the
free-text field) can still reach it, matching the established free-input
precedent. No mutation happens in either direction: neither switching
presets nor typing rewrites the *other* field to compensate.

## LTA6. The preview / warning line

One line, always present under the radiogroup (or under the read-only
classification text, per LTA-INV-4). Exactly one of the following, in this
priority order (most fundamental problem first — round 3 adds the
modifier-parses row and reorders `unsupported` ahead of a plain eligibility
reason, since an unsupported *value* is a more basic problem than an
otherwise-valid choice being ineligible):

1. **`unsupported` classification** (§LTA4.4) — the stored value itself is
   not one this control recognises; shown first regardless of eligibility.
2. **Target ineligible** (§LTA4.2) — applies regardless of which preset is
   classified or being considered.
3. **Modifier doesn't parse** (§LTA4.2, §S3-5 row 7) — empty or unparseable
   `expr`; also applies regardless of preset.
4. **The classified preset is not the eligible one** (§LTA4.3) — the
   remaining, more specific case: target and modifier are fine, but this
   edge's source (or, for B, an `S`-form modifier) doesn't match what's
   currently selected.
5. **Normal preview** — `classified === eligible`'s preset.

| state | EN line |
|---|---|
| `unsupported` | the §LTA4.4 message |
| target ineligible | "This connection's target isn't a Pool (or no longer exists) — neither option can take effect until it's reconnected to one." |
| modifier doesn't parse | "This connection's modifier is empty or can't be parsed — enter a valid value first. Neither option can take effect until it does." |
| A checked, not eligible (source isn't Pool) | "This connection's source isn't a Pool — 'Always' needs a Pool source. This edit has no effect until you reconnect it." |
| B checked, not eligible (source isn't a Router) | "This connection's source isn't a Gate, Converter, Drain, or End — 'On source fire' needs one of those. This edit has no effect until you reconnect it." |
| B checked, not eligible (modifier is `S`-form, reached via §LTA5 path 2) | the §LTA5 hint, shown here too so both paths agree |
| A checked and eligible | "Applied at the start of every step." |
| B checked and eligible | "Applied once this connection's source fires this step, right after this step's results are computed." |

The node-kind names (Pool / Gate / Converter / Drain / End) are existing Loop
Studio vocabulary — every one already appears in the node palette and
`inspector.edge.mode.*` — so none of this is new jargon (contrast the internal
identifiers LTA-INV-7 bars).

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

7a. `eligibleLabelPreset` returns `'A'` for a Pool source + Pool target +
    parseable non-`S` modifier; `'B'` for a Router source + Pool target +
    an `'N'`-token modifier; `null` for: a Pool target with a `Source`-kind
    source, a Router source with an `S`-token modifier, a non-Pool target
    (any source), and — the round-3 addition — an **unparseable modifier**
    (`expr: ''` and `expr: 'garbage'`), asserted with a **synthetic**
    `{ targetKind, sourceKind, modifier }` context object, not through the
    live store — this is what makes the next test (7b) possible without
    `removeNode`'s cascade getting in the way.
7b. **Missing target/source id (a dangling reference reachable only by
    import, not by the UI's own delete — Hanrim's finding #3):**
    `eligibleLabelPreset({ targetKind: undefined, ... })` and
    `({ sourceKind: undefined, ... })` both return `null`, via the same
    synthetic-context unit test as 7a. **Not** an E2E test — this codebase's
    `removeNode` cascades incident-edge deletion, so a target/source can
    never be missing on an edge still reachable from the Inspector through
    normal UI actions; the defensive case exists only for a hand-edited or
    externally-produced file with a dangling edge, and is exercised as a
    pure function call, never by trying to delete a node out from under a
    selected edge in the running app.

**Eligibility rendering / disabling in the Inspector (§LTA4.3, reversing the
round-2 draft's allow-then-warn stance):**

7c. **Target ineligible, reachable through the UI:** a label whose target
    **is a Gate** (a real, existing, wrong-kind node — not a deleted one,
    per 7b's split) shows **both** radios disabled and the target warning;
    clicking either does nothing (no `setEdgeData` call).
7d. **Modifier doesn't parse:** a label with an empty modifier shows **both**
    radios disabled with the modifier warning, regardless of source/target;
    typing a valid modifier re-enables whichever radio `eligibleLabelPreset`
    now names.
8. **Source ineligible for A:** a label sourced from a Gate, classified `A`
   (e.g. a pre-existing file): `eligibleLabelPreset` returns `'B'`, so radio A
   renders **checked and disabled**, B **unchecked and enabled**; clicking B
   switches to B normally; A never becomes freshly selectable while the
   source stays a Gate (there is nothing to click — it's disabled).
9. **Source ineligible for B:** a label sourced from a Pool, classified `A`:
   `eligibleLabelPreset` returns `'A'`, so radio B renders **disabled** —
   there is no click to make on it; if a test harness dispatches a change
   event on it anyway, assert no `setEdgeData` call fires, no digest change,
   `timing`/`when` stay exactly as before.
10. **Modifier `S`-form blocks a fresh switch to B (§LTA5 path 1):** a label
    with modifier `-S`, source a Router, classified `A`:
    `eligibleLabelPreset` returns `null` (Router source, but `S`-token) — B
    renders disabled with the §LTA5 reason; changing the modifier to `-1`
    makes `eligibleLabelPreset` return `'B'`, enabling it; only then does
    clicking B commit.
11. **Free-text `S` on an already-B edge still commits (§LTA5 path 2):**
    typing `+S` into the modifier field while B is selected still commits the
    expression change (round-trips on reload) and shows the §LTA5 hint; the
    stored `timing`/`when` are untouched by this edit. (This edge is now
    `classified === 'afterPull'`, `eligible === null` — the checked-and-disabled
    state test 10's B radio would also show, reached from the other
    direction.)
12. **An already-stored value that becomes ineligible is preserved, never
    auto-corrected:** start with a valid `B` edge (Router source, Pool
    target, `'N'`-token modifier); reconnect its source to a Pool via the
    canvas (not through this control); reload the Inspector selection —
    `timing`/`when` are **unchanged** on disk (assert via the saved file /
    digest), radio B renders checked-and-disabled with the source-not-router
    warning, and radio A (now `eligibleLabelPreset === 'A'`) is enabled to fix
    it with one click.
13. **Unsupported classification (§LTA4.4), with at most one radio ever
    enabled (round-3 correction — the round-2 draft's "both enabled" premise
    was impossible, Hanrim's finding #2):** loading a fixture with
    `data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope', when: 'source-fired' }`
    on an edge with a **Pool** source and Pool target shows neither preset
    checked, both raw values in the message, radio A **enabled** (since
    `eligibleLabelPreset` returns `'A'` for this source/target/modifier) and
    radio B **disabled**; choosing A replaces it with the clean shape (test
    4's assertions). A second variant of the *same* fixture with a **Router**
    source instead shows the mirror image — B enabled, A disabled, choosing B
    replaces it with the clean shape (test 5's assertions). A third variant
    with a **Source**-kind source shows **both** disabled (matching 7a/7c) —
    the message is shown, but neither preset can be freshly chosen until the
    source is reconnected. Each of the other three named bad combinations
    (test 3) is checked once, on the Pool-source variant, for the
    classification-only assertion (the eligibility matrix is not re-run five
    times).

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
    unaffected; `step.ts` is untouched by this slice's implementation PR (a
    CI-checkable claim, like PR #181's "zero `.tsx` file touched" note in
    reverse — here it is "zero `step.ts` line touched").

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
| **LTA-D11** | eligibility as two independent per-preset booleans, or one unified function? | **One function, `eligibleLabelPreset` returning `'A' \| 'B' \| null'`** (§LTA4.2). Round 2's two-boolean model could describe "both eligible," which Hanrim's finding #2 shows is structurally impossible (A needs a Pool source, B needs a Router source — mutually exclusive by node-kind). A single-valued function makes the impossible state unrepresentable rather than merely untested, and gives `eligibleLabelPreset` a natural pure-unit-test surface (§LTA9 tests 7a/7b) independent of the live store — which is also how Hanrim's finding #3 (the unreachable deleted-target E2E) gets resolved: the defensive "missing node" case moves to a synthetic-context unit test instead of an impossible UI interaction. |

## LTA11. Work order

1. **This design doc** — its own PR, reviewed and approved before any UI or
   `stateExpr.ts` code lands (Hanrim; round 3 in progress, 2026-09-12).
2. **Implementation PR** — `classifyLabelTiming` + `eligibleLabelPreset` in
   `stateExpr.ts` (with unit tests, §LTA9 items 1–3, 7a, 7b); the radiogroup
   (native radios, LTA-D10) + eligibility-driven disabling + preview/warning
   line + `ExprField`'s `S`-form hint in `Inspector.tsx`; EN/KO/JA copy; the
   full §LTA9 acceptance suite. No `step.ts`, `revision.ts`, or `workspace.ts`
   change.
3. **README** — updated only after step 2 ships and is verified (per Hanrim:
   not yet, since the Inspector doesn't exist until then).
4. Unblocks **GS10-3** (gacha hard-pity content) — the first real content
   that needs an author, rather than a test fixture, to set `timing` /
   `when`.
