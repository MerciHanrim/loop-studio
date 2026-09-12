# Label timing authoring (design doc)

**Status: design — pending review (round 2).** CSU8 slice 3
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
accessibility details were unstated. All five are fixed below.

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
| **LTA-INV-6** | Fully keyboard-operable (`role="radiogroup"`, arrow-key navigation between the two options including a *disabled* one being focusable-but-not-selectable per the native `role="radio"` `aria-disabled` pattern, `Tab` to enter/leave) and screen-reader labelled — each option's accessible name states its consequence, not its internal id (§LTA7). |
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

### LTA4.2 Eligibility — four independent, graph-context conditions

| condition | required by | source of truth |
|---|---|---|
| **target is a Pool** (present, `data.kind === 'pool'`) | **both** presets | `SEMANTICS-S3.md` §S3-5 row 6 (`afterPull`) + the pre-existing `loop-state/1` rule (`phase0`, never before surfaced in the UI — Hanrim's finding #2) |
| **source is a Pool** | preset A only | pre-existing `loop-state/1` rule |
| **source is a Router** (`ROUTER_KINDS` — Gate / Converter / Drain / End) | preset B only | `SEMANTICS-S3.md` §S3-5 row 5 |
| **modifier is not an `S`-form** (`parseLabelExpr(expr).token !== 'S'`) | preset B only | `SEMANTICS-S3.md` §S3-5 row 8 |

A missing/deleted target or source node fails its respective condition (not
a distinct third case) — "not a Pool" and "doesn't exist" render the same
warning, since both mean the edge can't run as that preset right now.

### LTA4.3 Combining classification + eligibility → what renders

For each preset, computed independently:

- **selected** — `classifyLabelTiming(ed.timing, ed.when) === 'phase0' | 'afterPull'` for that preset (never both; never for "unsupported").
- **eligible** — every one of §LTA4.2's conditions that applies to that preset currently holds.
- **enabled for a fresh pick** — always `eligible`. **Never** `eligible && !selected` alone — i.e. eligibility, not current selection, gates whether clicking that radio is allowed right now (LTA-INV-3).

Rendering:

| state | radio A | radio B | line under the group |
|---|---|---|---|
| classified `phase0`, both eligible | checked, enabled | unchecked, enabled | §LTA6 normal preview for A |
| classified `phase0`, target/source-for-A ineligible | checked, **disabled** | unchecked, enabled/disabled per B's own conditions | the failing condition's warning (§LTA6) |
| classified `afterPull`, both eligible | unchecked, enabled | checked, enabled | §LTA6 normal preview for B |
| classified `afterPull`, target/source-for-B/modifier ineligible | unchecked, enabled/disabled per A's own conditions | checked, **disabled** | the failing condition's warning |
| classified `unsupported` | unchecked, enabled iff A-eligible | unchecked, enabled iff B-eligible | §LTA4.4 unsupported message |

A **checked** option can be **disabled** — this is the one place §LTA4.1 and
§LTA4.2 interact for an *already-stored* value that graph editing elsewhere
made ineligible (a reconnect, a deleted target). It stays checked (LTA-INV-3
— never silently changed) and disabled (a fresh re-pick of the same,
currently-bad option is not offered either — there is nothing to "re-pick,"
the value is already there); the **other** radio, if eligible, stays a live
escape hatch to fix it. If **neither** is eligible (e.g. the target was
deleted), both are disabled and the line explains the more fundamental
problem (target) rather than the preset-specific one (§LTA6 priority order).

### LTA4.4 The `unsupported` classification

Reached only by opening a file with a stored value `classifyLabelTiming`
rejects (§LTA4.1) — this control never writes one (LTA-INV-1/3). Neither
radio is checked; both raw stored values are preserved verbatim on every
subsequent save (LTA-INV-3) until the author explicitly picks a preset (which
overwrites both keys with that preset's exact shape, LTA-INV-1). The message
is the **one** place raw field values appear (LTA-INV-7 / §LTA10-D5):

> EN: "This connection has a timing/condition combination Loop Studio
> doesn't support (currently: timing = `nope`, when = `source-fired`) — it
> currently has no effect. Choose one of the two options above to replace
> it."
> KO: "이 연결의 적용 시점/조건 조합을 Loop Studio가 지원하지 않아요(현재
> timing = `nope`, when = `source-fired`) — 지금은 적용되지 않아요. 위 두
> 옵션 중 하나를 선택해서 바꿔주세요."

The interpolated pair always shows **both** fields as currently stored
(`(none)` for an absent one), regardless of which row of §LTA4.1 produced
`unsupported` — one message, one wording, parameterised — rather than eight
bespoke strings mirroring each `SEMANTICS-S3.md` §S3-5 row 1–4 sub-case. Row
5–8 (eligibility) failures are never described here; they use §LTA4.2's own
per-condition warnings even when they additionally co-occur with an
`unsupported` classification (rare — an unsupported value is already going to
be replaced by picking a preset, so eligibility for the *not-yet-chosen*
preset is what the enabled/disabled state in §LTA4.3's last row already
conveys).

## LTA5. The modifier field's `S`-form gate

`SEMANTICS-S3.md` §S3-5 row 8. Two distinct paths reach an `S`-form under
"On source fire," with **two different, deliberately different, contracts**
(Hanrim's finding #3):

1. **A fresh switch from A to B while the modifier is already an `S`-form.**
   This is a **structured** choice — §LTA4.2's fourth condition makes radio B
   **disabled** in this state (with the reason "needs a fixed number, not
   S"), exactly like the source/target conditions. The switch **cannot
   happen** until the modifier is fixed. (Reverses this document's first
   draft, which allowed the switch and warned after the fact.)
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
an `S`-form `expr`) and the *same* §LTA4.2 "modifier ineligible" condition
now also disables a **fresh** switch away-and-back on radio B — but path 1
never lets that state be **created** through the radio, while path 2 (already
on B, editing the free-text field) can still reach it, matching the
established free-input precedent. No mutation happens in either direction:
neither switching presets nor typing rewrites the *other* field to
compensate.

## LTA6. The preview / warning line

One line, always present under the radiogroup (or under the read-only
classification text, per LTA-INV-4). Exactly one of the following, in this
priority order (most fundamental problem first):

1. **Target ineligible** (§LTA4.2) — applies regardless of which preset is
   selected or being considered; shown first since neither preset can work
   until it's fixed.
2. **The selected preset's own source/modifier condition is ineligible**
   (§LTA4.2) — e.g. B selected but source isn't a Router.
3. **`unsupported` classification** (§LTA4.4) — neither preset currently
   applies.
4. **Normal preview** — the selected preset is fully eligible.

| state | EN line |
|---|---|
| target ineligible | "This connection's target isn't a Pool (or no longer exists) — neither option can take effect until it's reconnected to one." |
| A selected, source ineligible | "This connection's source isn't a Pool — 'Always' needs a Pool source. This edit has no effect until you reconnect it." |
| B selected, source ineligible | "This connection's source isn't a Gate, Converter, Drain, or End — 'On source fire' needs one of those. This edit has no effect until you reconnect it." |
| B selected, modifier is `S`-form (reached via §LTA5 path 2) | the §LTA5 hint, shown here too so both paths agree |
| `unsupported` | the §LTA4.4 message |
| A selected, everything eligible | "Applied at the start of every step." |
| B selected, everything eligible | "Applied once this connection's source fires this step, right after this step's results are computed." |

The node-kind names (Pool / Gate / Converter / Drain / End) are existing Loop
Studio vocabulary — every one already appears in the node palette and
`inspector.edge.mode.*` — so none of this is new jargon (contrast the internal
identifiers LTA-INV-7 bars).

## LTA7. Keyboard, screen reader, IME, mobile, locked

- **Keyboard:** the radiogroup follows the standard native radio pattern —
  `↑`/`↓` (and `←`/`→`) move focus between the two options; a **disabled**
  option is reachable by arrow navigation (so its reason is discoverable) but
  does not commit on `Space`/`Enter` and is not the initial focus target when
  the other option is enabled. An enabled option commits immediately on
  selection (no separate "apply" step, matching every other Inspector
  `select`). `Tab` enters/leaves the group as one stop.
- **Screen reader — two different ARIA mechanisms for two different jobs**
  (Hanrim's minor-cleanup note): the normal preview line (§LTA6's last two
  rows) is **not** a live region — it is static text the radiogroup already
  points at via `aria-describedby`, since its content already restates each
  option's consequence and a live region would double-announce what the
  option's own accessible name just said. A **warning** (§LTA6's first four
  rows) uses `aria-live="polite"`, because it can appear or change as a
  *side effect* of an edit elsewhere (reconnecting the source, editing the
  target, editing the modifier) without the radiogroup receiving focus, and
  that change genuinely needs announcing. A disabled option's reason is in
  its own accessible description (`aria-describedby` on that `role="radio"`),
  not only in the shared line, so it is discoverable by navigating options
  even before an attempted (refused) selection.
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
**Nine** keys, not six (correcting this document's first draft, Hanrim's
minor note):

1. `inspector.field.labelTiming` — the field label ("When it applies" / "적용
   시점" / "適用タイミング").
2. `inspector.labelTiming.always` — preset A's option text (§LTA3).
3. `inspector.labelTiming.afterPull` — preset B's option text (§LTA3).
4. `inspector.labelTiming.previewAlways` — §LTA6 row "A selected, everything
   eligible."
5. `inspector.labelTiming.previewAfterPull` — §LTA6 row "B selected,
   everything eligible."
6. `inspector.labelTiming.warnTargetNotPool` — §LTA6 row "target ineligible"
   — shared by both presets (Hanrim's finding #2), reused verbatim as the
   disabled-reason text for both radios when this condition fails.
7. `inspector.labelTiming.warnSourceNotPool` — §LTA6 row "A selected, source
   ineligible," reused as A's disabled-reason text.
8. `inspector.labelTiming.warnSourceNotRouter` — §LTA6 row "B selected,
   source ineligible," reused as B's disabled-reason text.
9. `inspector.labelTiming.warnSForm` — §LTA5 (both paths) / §LTA6, reused as
   B's disabled-reason text when the modifier is already an `S`-form.
10. `inspector.labelTiming.unsupported` — §LTA4.4 (interpolates the two raw
    stored values — the one exception, LTA-INV-7 / §LTA10-D5).

(Ten, in fact, once every reuse is counted as one key — the correction is
that the first draft undercounted, not that the exact count is load-bearing;
key *names* are an implementation detail per §LTA10-D7.)

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

**Eligibility / disabling (§LTA4.2/4.3, reversing the first draft's
allow-then-warn tests):**

7. **Target ineligible:** a label whose target is a Gate (not a Pool) shows
   **both** radios disabled and the target warning; attempting to click
   either does nothing (no `setEdgeData` call). Deleting the target node
   produces the same result.
8. **Source ineligible for A:** a label sourced from a Gate, classified `A`
   (e.g. a pre-existing file), shows A **checked and disabled**, B enabled;
   clicking B (now eligible, since the source is a Router) switches to B
   normally; the disabled A never becomes freshly selectable while the source
   stays a Gate.
9. **Source ineligible for B:** a label sourced from a Pool: clicking radio B
   **does nothing** (it is disabled, per LTA-INV-3) — no `setEdgeData` call,
   no digest change, `timing`/`when` stay exactly as before the click. This
   replaces the first draft's "commits with a warning" test for this case.
10. **Modifier `S`-form blocks a fresh switch to B (§LTA5 path 1):** a label
    with modifier `-S`, currently classified `A`: radio B is disabled with
    the §LTA5 reason; changing the modifier to `-1` enables B; only then does
    clicking B commit.
11. **Free-text `S` on an already-B edge still commits (§LTA5 path 2):**
    typing `+S` into the modifier field while B is selected still commits the
    expression change (round-trips on reload) and shows the §LTA5 hint; the
    stored `timing`/`when` are untouched by this edit.
12. **An already-stored value that becomes ineligible is preserved, never
    auto-corrected:** start with a valid `B` edge (Router source); reconnect
    its source to a Pool via the canvas (not through this control); reload
    the Inspector selection — `timing`/`when` are **unchanged** on disk
    (assert via the saved file / digest), radio B renders checked-and-disabled
    with the source warning, and radio A (now eligible) is available to fix
    it with one click.
13. **Unsupported classification (§LTA4.4):** loading a fixture with
    `data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope', when: 'source-fired' }`
    shows neither preset checked, both raw values in the message, and (if
    source/target are otherwise eligible) both radios enabled; choosing A
    replaces it with the clean shape (test 4's assertions); choosing B
    replaces it with the clean shape (test 5's assertions). A second fixture
    using each of the other three named bad combinations (test 3) is checked
    the same way.

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
16. **Keyboard + SR (LTA-INV-6/§LTA7):** `Tab` reaches the radiogroup; arrow
    keys move focus including onto a disabled option (reason discoverable,
    no commit); the static preview is reachable via `aria-describedby`
    (present, correctly associated, **not** inside an `aria-live` region);
    a warning appears inside an `aria-live="polite"` region and updates when
    triggered by an edit elsewhere (e.g. test 12's reconnect) without the
    radiogroup itself needing focus.
17. **Localisation (LTA-INV-7):** all ten §LTA8 strings present and rendered
    correctly in EN / KO / JA; none of `phase0` / `afterPull` /
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
| **LTA-D6** | surface the pre-existing "needs a Pool source/target" gaps now, or leave them alone since they predate CSU? | **Surface both now.** (§LTA4.2) The eligibility check for preset B already computes source kind; adding the symmetric source-for-A check, and the target-for-both check `SEMANTICS-S3.md` §S3-5 row 6 explicitly names (Hanrim's finding #2 — missing entirely from this draft's first pass), closes real, pre-existing silent-failure gaps for a near-zero marginal cost, and is more consistent than shipping only the brand-new B-source check. |
| **LTA-D7** | exact i18n key names, warning copy wording, radiogroup visual styling | Not fixed here — implementation detail, finalised during the impl PR against the real Inspector layout (mirrors RXA10-D7's precedent for tunable constants). The **meaning** of each string (§LTA3/§LTA4/§LTA5/§LTA6/§LTA8) is what this document fixes. |
| **LTA-D8** | where does the `phase0`/`afterPull`/`unsupported` classification logic live? | **`src/engine/stateExpr.ts`, one shared function (§LTA4.1), not re-derived in `Inspector.tsx`.** Follows the file's own stated charter ("the engine and the editor must always agree on what is recognised") to its logical conclusion: `parseLabelTiming` / `parseLabelWhen` already live there for exactly this reason; the composition of the two into the three-way answer the Inspector needs belongs beside them, not duplicated. |
| **LTA-D9** | one `aria-live` region for everything, or split? | **Split.** (§LTA7) The static, always-true-while-selected preview is reached via `aria-describedby` (no live announcement — it would double the option's own accessible name); only a warning, which can appear as a side effect of an edit elsewhere, uses `aria-live="polite"`. Avoids the redundant-announcement issue Hanrim flagged. |

## LTA11. Work order

1. **This design doc** — its own PR, reviewed and approved before any UI or
   `stateExpr.ts` code lands (Hanrim; round 2 in progress, 2026-09-12).
2. **Implementation PR** — `classifyLabelTiming` in `stateExpr.ts` (with unit
   tests, §LTA9 items 1–3); the radiogroup + eligibility disabling +
   preview/warning line + `ExprField`'s `S`-form hint in `Inspector.tsx`;
   EN/KO/JA copy; the full §LTA9 acceptance suite. No `step.ts`, `revision.ts`,
   or `workspace.ts` change.
3. **README** — updated only after step 2 ships and is verified (per Hanrim:
   not yet, since the Inspector doesn't exist until then).
4. Unblocks **GS10-3** (gacha hard-pity content) — the first real content
   that needs an author, rather than a test fixture, to set `timing` /
   `when`.
