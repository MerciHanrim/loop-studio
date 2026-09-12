# Label timing authoring (design doc)

**Status: design — pending review.** CSU8 slice 3
(`docs/conditional-state-update.md`, `SEMANTICS-S3.md` §S3-8): the Inspector
authoring surface for a `label` connection's `timing` / `when`
(`loop-state/3`). The engine, the grammar, and the `loop-revision/6`
projection (`SEMANTICS-R6.md`) are **frozen and unchanged** by this document —
this is authoring UX only.

Sections: **§LTA0** why · **§LTA1** scope · **§LTA2** invariants · **§LTA3**
the preset model · **§LTA4** eligibility & warnings · **§LTA5** the modifier
field's S-form gate · **§LTA6** the preview sentence · **§LTA7** keyboard /
SR / IME / mobile / locked · **§LTA8** i18n · **§LTA9** acceptance · **§LTA10**
decisions · **§LTA11** work order.

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
every UI-reachable state is engine-valid by construction.

## LTA1. Scope

**In:**

- One new authoring control on a **`label`**-mode state edge in the desktop
  Inspector, replacing nothing (`ExprField` for the modifier stays; this is a
  new field alongside it, per §LTA3).
- Live, non-blocking validation for the two states this control can put an
  edge into that are *not* automatically engine-valid — an ineligible source
  node, and an S-form modifier under the conditional option (§LTA4 / §LTA5) —
  plus a read-only rendering of a **third** state: a value already on disk
  that this control never writes (an unrecognised `timing` / `when` from a
  hand-edited or externally-produced file, §LTA4.3).
- A one-line, always-visible preview sentence stating in plain language when
  the edit currently takes effect (§LTA6).
- EN / KO / JA copy for all of the above (§LTA8).

**Out:**

- Any change to `src/engine/stateExpr.ts`, `step.ts`, `SEMANTICS-S3.md`, or
  the `loop-revision/6` projection (`revision.ts` / `workspace.ts`,
  `SEMANTICS-R6.md`). This document authors *existing*, frozen wire content —
  it invents no new stored shape (LTA-INV-1).
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
| **LTA-INV-1** | The control writes **exactly one of two shapes** on a `label` edge's `data`, never a third: (a) **no `timing` key, no `when` key** — the "Always" preset; (b) **`timing: "afterPull"`, `when: "source-fired"`** — the "On source fire" preset. Choosing (a) **deletes** both keys if present (never writes the literal `"phase0"`) — a label edge no author has ever touched this control on, and one where the author has explicitly chosen "Always", produce byte-identical `data`, byte-identical `fullContentDigest` / `semanticDigest`, and byte-identical engine `report` (`SEMANTICS-S3.md` §S3-7 / `SEMANTICS-R6.md` R6-INV-2). |
| **LTA-INV-2** | No engine, grammar, schema, or digest change. This is an authoring surface over `SEMANTICS-S3.md` / `SEMANTICS-R6.md`, exactly as `docs/register-expression-authoring.md` is over `loop-expr/1` — the frozen documents are read, never amended, by this slice. |
| **LTA-INV-3** | **Never a silent rewrite.** The control never auto-converts an `S`-form modifier to a literal, never auto-reconnects an edge to fix an ineligible source, and never auto-normalises an unrecognised stored `timing` / `when` on load. Every one of those states is shown and explained (§LTA4/§LTA5); the author acts on it explicitly, or leaves it as-is. Mirrors `SEMANTICS-S3.md` §S3-5's own governing rule, extended to the editor. |
| **LTA-INV-4** | **Locked / mobile:** read-only. The current preset (or the unrecognised-value state) renders as text, with the same preview sentence as the editable state; no radios, no `select`, no keyboard target. Mirrors `docs/register-expression-authoring.md` §RXA5's mobile rule verbatim. |
| **LTA-INV-5** | A preset switch is **one ordinary field edit** — it goes through the same `setEdgeData` → commit → `simulationRev` bump path as every other edge-data field, one undo entry, no special-cased history handling. |
| **LTA-INV-6** | Fully keyboard-operable (`role="radiogroup"`, arrow-key navigation between the two options, `Tab` to enter/leave) and screen-reader labelled — each option's accessible name states its consequence, not its internal id (§LTA7). |
| **LTA-INV-7** | EN / KO / JA copy ships in the same PR as the control (matching every other Inspector field). **No internal identifier — `phase0`, `afterPull`, `source-fired`, or the raw field names `timing` / `when` — appears in any user-facing string**, in any locale, in the normal-operation states. (The one narrow exception, and only there: the unrecognised-imported-value warning may echo the literal stored string so the author can see what a hand-edited file actually contains — §LTA4.3 / §LTA10-D5.) |

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
- **A pre-existing label edge from before this feature:** reads as Preset A
  (LTA-INV-1(a)) — every currently-saved graph opens with every label showing
  "Always", the correct and only truthful reading.

This closes Hanrim's ask #5 (bundle vs. independent fields) as: **bundle**.
It structurally forecloses `phase0 + when` (§S3-5 row 2) and `afterPull` with
no `when` / a foreign `when` (§S3-5 rows 3–4) — none of those shapes has a
control that produces them.

## LTA4. Eligibility & warnings

Two shapes remain reachable that this control does not by itself prevent,
because they depend on **graph structure the author can change independently**
(the edge's source node) or **the modifier field** (§LTA5) — not on the preset
control in isolation. Per LTA-INV-3, neither is auto-fixed; both are shown.

### LTA4.1 Preset B needs a Phase-2 source

`SEMANTICS-S3.md` §S3-5 row 5: an `afterPull` label's source must be a node
that fires in Phase 2 — Gate, Converter, Drain, or End (`ROUTER_KINDS` in
`src/engine/step.ts`). If Preset B is selected on an edge whose current
source is a Pool or a Source, the edit is stored (LTA-INV-1(b) is still
written verbatim — never silently refused) but currently has **no effect**.
Shown as an inline warning under the radio group:

> EN: "This connection's source is a Pool — 'On source fire' needs a Gate,
> Converter, Drain, or End source. This edit has no effect until you
> reconnect it."
> KO: "이 연결의 소스가 Pool이에요 — '소스 실행 시'는 게이트·컨버터·드레인·엔드
> 소스가 필요해요. 다시 연결하기 전까지 이 설정은 적용되지 않아요."

The node-kind names (Pool / Gate / Converter / Drain / End) are existing
Loop Studio vocabulary — every one already appears in the node palette and
`inspector.edge.mode.*` — so this is not new jargon (contrast the internal
identifiers LTA-INV-7 bars).

### LTA4.2 Preset A needs a Pool source (pre-existing rule, now surfaced)

Not a new rule — `loop-state/1` has always required a `phase0` label's source
to be a Pool. Today's Inspector doesn't check this at all, so a label wired
from, say, a Gate has silently done nothing since before CSU existed. Since
§LTA4.1 already computes the source node's kind to validate Preset B, doing
the symmetric check for Preset A is nearly free and closes a real,
pre-existing silent-failure gap:

> EN: "This connection's source isn't a Pool — 'Always' needs a Pool source.
> This edit has no effect until you reconnect it."
> KO: "이 연결의 소스가 Pool이 아니에요 — '항상'은 Pool 소스가 필요해요. 다시
> 연결하기 전까지 이 설정은 적용되지 않아요."

(A source that is itself a `Source` node satisfies *neither* rule — both
warnings' underlying conditions hold; only the one matching the **currently
selected** preset is shown, since only one preset's warning is relevant at a
time.)

**Decision (§LTA10-D2): allow, don't hard-disable.** Both radio options stay
selectable regardless of the current source — hard-disabling one based on
transient graph state adds real complexity (recompute on every reconnect,
decide what happens to a disabled-but-already-selected option) for a case
that is never destructive: an ineligible preset just means "no effect right
now," identical in spirit to `docs/register-expression-authoring.md` §RXA3.5's
"wrong kind" reference row (shown, flagged, still saved). The warning is the
correction mechanism, not a lock.

### LTA4.3 An unrecognised stored value (imported / hand-edited file)

`SEMANTICS-S3.md` §S3-5 rows 1 and 4 — a `timing` that is neither absent,
`"phase0"`, nor `"afterPull"`, or a `when` other than `"source-fired"`. This
control **never writes** such a value (LTA-INV-1), so it is reachable only by
opening a file that already has one (hand-edited, or produced by a future
version / a bug). Per `SEMANTICS-R6.md` §R6-2.2 the value is preserved
verbatim on load and through every save — it is not clobbered.

The radiogroup shows **neither** preset as selected; a third, distinct
message replaces the usual warning:

> EN: "This connection was imported with a value Loop Studio doesn't
> recognise (`timing: "nope"`) — it currently has no effect. Choose one of
> the two options above to replace it."
> KO: "이 연결은 Loop Studio가 인식하지 못하는 값(`timing: "nope"`)으로
> 가져왔어요 — 지금은 적용되지 않아요. 위 두 옵션 중 하나를 선택해서
> 바꿔주세요."

This is the **one** place the literal stored string is shown (§LTA10-D5) —
it is diagnostic information about a file's actual content, in a state that
by definition did not come from this UI, not a label for a normal choice.
Selecting either preset overwrites the unrecognised value with that preset's
exact shape (LTA-INV-1) — there is no "keep the unrecognised value" option,
matching "never a silent rewrite, but a chosen one is fine."

## LTA5. The modifier field's `S`-form gate

`SEMANTICS-S3.md` §S3-5 row 8: an `afterPull` label's `expr` must be a
numeric literal (`+N -N =N`) — `+S -S =S` fail-close ("cannot read S" — an
`afterPull` source is not a Pool, so `S[source]` has no meaning). This is
reachable **live**, by typing, independent of §LTA4: an author on Preset B
can type `+S` into the existing modifier field at any time.

`ExprField` (`src/components/Inspector.tsx`) currently applies the identical
`parseLabelExpr` grammar regardless of `timing` — it has no reason to know
about presets today. This slice adds one thing to it: when the edge is on
Preset B and the parsed modifier's `token === 'S'`, show a distinct hint in
place of the normal "describe the effect" hint:

> EN: "'On source fire' can only use a fixed number (e.g. +1, =0) — not S."
> KO: "'소스 실행 시'는 고정된 숫자만 쓸 수 있어요(예: +1, =0) — S는 안 돼요."

**Decision (§LTA10-D3): warn, don't block the commit.** Consistent with
§LTA4's "allow, don't hard-disable" and with `docs/register-expression-authoring.md`
RXA-INV-5 ("the editor never blocks a save … committed and flagged, exactly
as today") — an `S`-form modifier under Preset B still saves (the engine's
own fail-closed handling is exactly as harmless as any other already-existing
invalid-label state), it is just immediately, visibly explained instead of
requiring a simulation run to discover.

No mutation happens in either direction: switching Preset A → B with an
existing `S`-form modifier does **not** rewrite the expression (it would be
guessing what number the author meant); switching back to A makes the same
`S`-form valid again with no edit needed, since `S` is legal there.

## LTA6. The preview sentence

One line, always present under the radiogroup (or under the read-only preset
text, per LTA-INV-4), stating in plain language when the edit currently takes
effect — this is Hanrim's ask #8 and doubles as the accessible description
tying the whole control together (§LTA7):

| state | EN preview |
|---|---|
| Preset A, eligible source | "Applied at the start of every step." |
| Preset B, eligible source | "Applied once this connection's source fires this step, right after this step's results are computed." |
| Preset A, ineligible source | *(the §LTA4.2 warning stands in for this line)* |
| Preset B, ineligible source | *(the §LTA4.1 warning stands in for this line)* |
| Preset B, `S`-form modifier | *(the §LTA5 warning stands in for this line)* |
| unrecognised stored value | *(the §LTA4.3 message stands in for this line)* |

i.e. exactly one line is ever shown per state — the ordinary preview when
nothing is wrong, or the single most relevant warning when something is.
(If more than one condition holds — e.g. an ineligible source **and** an
`S`-form modifier on Preset B — the source-eligibility warning (§LTA4.1) takes
priority, since fixing the source is the more fundamental blocker; the
`S`-form warning appears once the source is fixed.)

## LTA7. Keyboard, screen reader, IME, mobile, locked

- **Keyboard:** the radiogroup follows the standard native radio pattern —
  `↑`/`↓` (and `←`/`→`) move the selection between the two options and commit
  immediately (no separate "apply" step, matching every other Inspector
  `select`); `Tab` enters/leaves the group as one stop.
- **Screen reader:** the group has an accessible name (the field label, §LTA3)
  and each option's accessible name is its full outcome text (the EN strings
  in §LTA3's table) — never the bare word "Always" / "On source fire" alone
  without the "at the start of every step" / "after this step's results"
  qualifier, so the consequence is in the name itself, not only in visible
  text a screen reader might not reach. The preview sentence / warning
  (§LTA4–§LTA6) is an `aria-live="polite"` region, debounced, mirroring
  `docs/register-expression-authoring.md`'s read-back region.
- **IME:** not applicable — this control has no free-text entry (the two
  presets are chosen, not typed). The adjacent modifier field's existing IME
  behaviour (none needed — it's a numeric/operator grammar) is unchanged.
- **Mobile:** LTA-INV-4 — read-only text, matching the established
  `docs/mobile.md` §MV3a edit-lock precedent exactly (canvas edit-locked on
  mobile ⇒ this field, like every other Inspector field, is not reachable to
  *edit*, only to read).
- **Locked (desktop):** same as mobile — LTA-INV-4.

## LTA8. i18n

New keys (naming to match the existing `inspector.*` namespace convention;
final key names are an implementation detail, not fixed by this document):

- `inspector.field.labelTiming` — the field label ("When it applies" / "적용
  시점" / "適用タイミング").
- `inspector.labelTiming.always` / `inspector.labelTiming.afterPull` — the two
  option texts (§LTA3 table).
- `inspector.labelTiming.previewAlways` / `inspector.labelTiming.previewAfterPull`
  — the two normal preview sentences (§LTA6).
- `inspector.labelTiming.warnSourceNotRouter` / `inspector.labelTiming.warnSourceNotPool`
  — §LTA4.1 / §LTA4.2 (each takes no dynamic content — the node-kind names
  are fixed by the rule, not by the specific graph).
- `inspector.labelTiming.warnSForm` — §LTA5.
- `inspector.labelTiming.unrecognised` — §LTA4.3 (interpolates the raw stored
  string — the one exception, LTA-INV-7 / §LTA10-D5).

All six ship in EN / KO / JA in the same PR as the control (LTA-INV-7),
following `docs/i18n.md`'s existing per-locale-file convention
(`src/i18n/locales/{en,ko,ja}/inspector.ts`) and checked by the existing
`check-i18n.mjs` completeness gate — no exception requested.

## LTA9. Acceptance / E2E

Keyed on node / edge ids, never rendered labels (matching every other
Inspector E2E suite in this codebase).

1. **Default / round-trip (LTA-INV-1a):** a freshly-created label edge shows
   Preset A; its `data` carries no `timing` / `when` key; the file's
   `fullContentDigest` after save equals the pre-feature digest for the same
   graph.
2. **Preset B write (LTA-INV-1b):** selecting Preset B on an eligible
   (Gate/Converter/Drain/End-sourced) label sets `timing: "afterPull",
   when: "source-fired"` exactly; the engine's next run shows the Phase 2.5
   effect (cross-checked against `src/engine/state.afterpull.test.ts`'s
   existing fixtures — this suite is not re-testing the engine, only that the
   UI writes the shape the engine already accepts).
3. **Round-trip back to A:** selecting Preset A on an edge currently on
   Preset B deletes both keys (not `timing: "phase0"`); digest returns to
   what it was before B was ever chosen.
4. **Ineligible source warnings (§LTA4.1/4.2):** a label wired from a Pool
   shows Preset-A-selected-by-default with no warning; switching it to
   Preset B (without reconnecting) shows the §LTA4.1 warning and still saves
   the CSU shape; reconnecting the source to a Gate clears the warning with no
   further edit needed. The symmetric case for a Router-sourced label
   defaulting to Preset A shows §LTA4.2.
5. **S-form gate (§LTA5):** on Preset B, typing `+S` into the modifier shows
   the §LTA5 hint instead of the normal describe-the-effect hint, and still
   commits (the value round-trips on reload); switching to Preset A on the
   same edge clears the warning with no expression change.
6. **Unrecognised value (§LTA4.3):** loading a fixture with
   `data: { kind: 'state', mode: 'label', expr: '+1', timing: 'nope' }` shows
   neither preset selected and the §LTA4.3 message including the literal
   `nope`; choosing Preset A replaces it with the clean shape (test 1);
   choosing Preset B replaces it with the clean shape (test 2).
7. **Only on `label` mode (§LTA1):** switching a state edge's mode away from
   `label` (to `trigger` / `activator`) removes the control from view; no
   `timing` / `when` key survives the mode switch (mirrors the existing
   mode-switch key-dropping behaviour for `delay` / `expr`).
8. **Locked / mobile (LTA-INV-4):** a selected label edge on a locked canvas
   or mobile viewport shows the current preset (or the §LTA4.3 message) as
   plain text with the preview sentence, no radio inputs, no keyboard target.
9. **Keyboard + SR (LTA-INV-6):** `Tab` reaches the radiogroup; `↑`/`↓` moves
   and commits selection; each option's accessible name includes its full
   consequence text; the preview/warning region is `aria-live`.
10. **Localisation (LTA-INV-7):** all six §LTA8 strings present and rendered
    correctly in EN / KO / JA; none of `phase0` / `afterPull` /
    `source-fired` / the bare words `timing` / `when` appears in any of the
    non-`unrecognised` strings in any locale (a grep-based lint in the E2E
    suite, mirroring the existing `check-i18n.mjs` style of mechanical checks).
11. **No engine/digest regression (LTA-INV-2):** the full existing
    `state.afterpull.test.ts` / `gacha-pity-timing.probe.test.ts` /
    `revision.csu.test.ts` / `revision-v6-fixture.test.ts` suites are
    unaffected — zero non-`.tsx` engine or model file touched by this slice's
    implementation PR (a CI-checkable claim, like PR #181's "zero `.tsx` file
    touched" note in reverse).

## LTA10. Decisions

| id | question | decision |
|---|---|---|
| **LTA-D1** | independent `timing`/`when` fields, an "advanced" toggle, or a bundled preset? | **Bundled, two-option preset, no advanced mode.** (§LTA3) `loop-state/3` v1 has exactly one non-default value per field, so two named outcomes already cover the full valid space; an advanced mode would exist only to let an author construct a state `SEMANTICS-S3.md` §S3-5 already forbids. Revisit only if a future spec revision adds a second `when`. |
| **LTA-D2** | hard-disable an ineligible preset, or allow + warn? | **Allow + warn.** (§LTA4.2) Matches `docs/register-expression-authoring.md`'s "disable + reason" for a *structurally impossible* choice (self/cycle reference) but that precedent is for a choice that can *never* be valid from that picker; an ineligible preset here becomes valid again the moment the source is reconnected, so a live warning is more honest than a lock that would need constant recomputation. |
| **LTA-D3** | block committing an `S`-form modifier under Preset B, or warn only? | **Warn only, still commits.** (§LTA5) Matches RXA-INV-5's "never blocks a save" precedent; the failure mode is a no-op diagnostic, not data loss. |
| **LTA-D4** | should selecting "Always" ever write the literal `timing: "phase0"`? | **No — delete both keys.** (LTA-INV-1a) Byte-identical to "never touched," which is both simpler to reason about and the only way every pre-existing graph's digest stays untouched by this feature shipping. |
| **LTA-D5** | show the raw stored string for an unrecognised imported value? | **Yes, in that one message only.** (§LTA4.3) It is diagnostic content about a file the tool did not produce; hiding it would make an already-confusing state harder to debug, and it cannot leak into the two normal-operation strings LTA-INV-7 protects since those never carry the raw field name at all. |
| **LTA-D6** | surface the pre-existing "Preset A needs a Pool source" gap now, or leave it alone since it predates CSU? | **Surface it now.** (§LTA4.2) The source-kind check for Preset B (§LTA4.1) already computes the information; leaving the symmetric, pre-existing silent-failure case unaddressed while shipping a brand-new warning for its sibling would be an inconsistent user experience for a near-zero marginal cost. |
| **LTA-D7** | exact i18n key names, warning copy wording, radiogroup visual styling | Not fixed here — implementation detail, finalised during the impl PR against the real Inspector layout (mirrors RXA10-D7's precedent for tunable constants). The **meaning** of each string (§LTA3/§LTA4/§LTA5/§LTA6/§LTA8) is what this document fixes. |

## LTA11. Work order

1. **This design doc** — its own PR, reviewed and approved before any UI code
   lands (Hanrim, 2026-09-12).
2. **Implementation PR** — the radiogroup + warnings + preview sentence in
   `Inspector.tsx`, the `ExprField` `S`-form-under-Preset-B hint, EN/KO/JA
   copy, and the §LTA9 acceptance suite. No engine, `stateExpr.ts`, `step.ts`,
   `revision.ts`, or `workspace.ts` change.
3. **README** — updated only after step 2 ships and is verified (per Hanrim:
   not yet, since the Inspector doesn't exist until then).
4. Unblocks **GS10-3** (gacha hard-pity content) — the first real content
   that needs an author, rather than a test fixture, to set `timing` /
   `when`.
