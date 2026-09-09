# Register expression authoring (design doc)

**Status: proposed.** A usability layer over `loop-expr/1` (`SEMANTICS-X.md`) /
`loop-model/1` (`SEMANTICS-M.md` §M3) — the Register `expression` field. The
language, the stored form, evaluation, and the `loop-revision/2` digest are
**unchanged**; this doc only pins how a person reads, understands, and edits an
expression that is stored as opaque `@id` references.

Sections: **§RXA0** why · **§RXA1** scope · **§RXA2** invariants · **§RXA3**
Slice 1 — the reference-aware editor · **§RXA4** naming & disambiguation ·
**§RXA5** keyboard / SR / IME / mobile · **§RXA6** large-graph performance ·
**§RXA7** `EdgeFlowField` reuse · **§RXA8** Slice 2 — insert from canvas ·
**§RXA9** acceptance · **§RXA10** decisions · **§RXA11** work order.

---

## RXA0. Why

`Net worth = @pool_mttqb36u_2 + @pool_mttqb36u_5` evaluates fine, but the person
who unlocked the canvas to edit it has almost no way to know that
`@pool_mttqb36u_2` is `Wallet` and `@pool_mttqb36u_5` is `Savings`, what their
current values are, or how to name a third node. The current editor
(`RegisterFields` in `Inspector.tsx`) is a bare monospace `<input>` plus a
canonical-form hint, the live result, and a parse-error code. Editing an
existing formula is copy-and-guess; writing a new one is worse.

The lock (`canvasLocked`) prevents *accidental* edits — it does not *teach* the
syntax or reveal what an id points at. Confirmed against the code: `@id`
resolves **by node id** (stable across rename) to a Pool's count at `S(k)`, a
Parameter's `value`, or another Register's value; every other kind, a missing
id, or a dependency cycle makes the whole Register `invalid`
(`src/model/model/registers.ts`).

The one existing precedent is `EdgeFlowField` — a `Name → @id` `<select>` for the
single-Parameter `flow` case, with a `(label)` status line. Nothing equivalent
exists for a full Register expression.

## RXA1. Scope

**In (Slice 1 — this design):**
- The Register `expression` field in the desktop Inspector: an `@`-triggered
  autocomplete of referenceable nodes, a **name-rendered read-back** of the
  canonical expression, and a **live value breakdown** shown together, plus a
  transient canvas peek when a reference is hovered.
- Reusing **only the reference-picker sub-component** in `EdgeFlowField` (§RXA7).

**In (Slice 2 — sketched here, its own PR):**
- Arm-and-click insertion of a reference by clicking a node on the canvas
  (§RXA8).

**Out:**
- No change to `loop-expr/1` grammar, `refsOf`, `canonicalPrint`, the
  `evaluateRegisters` pass, or the `loop-revision/2` digest.
- No rich contenteditable "chip" editor — the field stays a plain `<input>`
  (IME / paste / `Ctrl-Z` / caret handling stay trivial; a token editor is a
  separate project if ever wanted, §RXA10-D1).
- No expressions on Parameters, Sources, Gates, Converters, activation, or
  state edges — those are other languages / deferred amendments.
- No autocomplete or read-back on mobile (editing is locked there, §RXA5).

## RXA2. Invariants (RXA-INV)

| id | statement |
|---|---|
| **RXA-INV-1** | The stored `expr` string, its `canonicalPrint` form, `refsOf`, the `evaluateRegisters` result, and the `loop-revision/2` digest are **byte-identical** to today for every input. A document written before this feature loads, edits, and re-saves with no diff attributable to it. `@id` is the only persisted reference form. |
| **RXA-INV-2** | Every user-visible name is **derived** from the referenced node's current `data.label` at render time. Renaming a node updates the read-back on the next render; it never rewrites the stored `expr`. |
| **RXA-INV-3** | The canvas **peek** highlight is a transient preview: it sets no selection, does not enter Focus, bumps no `simulationRev` / `loadRev`, creates no undo entry, and is never serialized. It clears on blur / mouse-leave / Inspector close. |
| **RXA-INV-4** | Autocomplete lists **only** `pool` / `parameter` / `register` nodes. The Register being edited, and any Register that (transitively) depends on it, appear **disabled with a reason**, never hidden. |
| **RXA-INV-5** | The editor never blocks a save. An in-progress unparseable draft stays local (the existing `draft` gate); a parseable expression with a dangling / wrong-kind / cyclic / divide-by-zero reference is **committed** and flagged, exactly as today. |
| **RXA-INV-8** | The read-back's valid/invalid verdict and error text are a **presentation of the existing `evaluateRegisters` outcome** — the same `RegisterOutcome` (`useRegisterOutcome`) the Inspector and Canvas already show. The read-back adds only a per-reference value lookup, resolved against the **same snapshot view** (`RegisterSnapshotView` — `poolCount` / `paramValue` / `refKind`). No second parser or evaluator runs and none can reach a different classification: if `evaluateRegisters` says `invalid: false, value: 37`, line 2 ends `= 37`; if it says `invalid: true, code: …`, line 2 shows exactly that code's §RXA3.5 row. |
| **RXA-INV-9** | The **meaning line never shows two identical bare names.** When any referenced ids share a trimmed label, every occurrence of that label in the meaning line (and the autocomplete) is rendered `Label · Kind`, and `Label · Kind …idTail` if the kind also collides (§RXA4). `Savings + Savings` is not a possible render. |
| **RXA-INV-6** | Fully keyboard-operable and screen-reader-labelled; the popover does not trap focus or fight an IME composition (§RXA5). |
| **RXA-INV-7** | Building the candidate list + filtering + the dependent-Register set is **O(nodes + register-deps)** and memoised per `(nodes, S(t))` identity — no per-keystroke graph walk on an MMO-sized graph (§RXA6). |

## RXA3. Slice 1 — the reference-aware Register editor

### RXA3.1 The input

`RegisterFields` keeps its plain `<input>` and its `draft`-until-parseable
commit gate (unchanged). What changes is what surrounds it: an autocomplete
popover anchored to the input, and a read-back block below it.

### RXA3.2 `@` autocomplete

- Typing `@` (or `@` + a partial name / id) opens a popover listing candidates.
  Each row: **`Name` · `Kind` · `= <current value>`** — e.g. `Wallet · Pool · = 3`,
  `Progress cap · Parameter · = 100`, `Net worth · Register · = 37`.
- **Candidates (RXA-INV-4):** every `pool` / `parameter` / `register` node.
  - the Register **being edited** → shown, disabled, reason "cannot reference
    itself";
  - any Register that already depends (transitively) on this one → shown,
    disabled, reason "would create a cycle with <name>";
  - a candidate whose current value is non-finite / a Parameter with a
    negative `value` → shown, enabled, with a muted "= —" (the reference is
    legal; it just resolves to an error / 0 — the read-back explains).
- **Filter:** case-insensitive substring match against the display name **and**
  the raw id, ranked name-prefix > name-substring > id-substring, then by the
  §RXA4 stable order. `@{` opens the same list (for ids that are not
  `SAFE_ID`).
- **Choosing** a row inserts the **canonical reference spelling** for that id
  (`@id` for a `SAFE_ID`, else `@{…}`) at the caret, replacing the `@…` token
  being typed, and closes the popover. The input value is still a plain string;
  the commit path is unchanged.
- Escape closes the popover and leaves the typed text as-is (a raw `@id` the
  user knows is still allowed — RXA-INV-5).

### RXA3.3 The name read-back **and** the value breakdown — shown together

Directly under the input, two lines that are the heart of this feature:

```
Wallet + Savings
Wallet 3 + Savings 34 = 37
```

- **Line 1 — meaning.** The **canonical** expression (`parseExpr(draft).expr.canonical`)
  with every `@id` token rendered as its §RXA4 display name; operators, numbers,
  and parentheses verbatim from the canonical text. This is a read-only,
  name-substituted echo — it always reflects the *canonical* parse, so the user
  also learns how their input normalises (this replaces today's separate
  "canonical:" hint).
- **Line 2 — result.** The same structure with each reference replaced by its
  **resolved value at the current step**, ending in `= <R(step)>`. The final
  value and the valid/invalid verdict are **read straight from
  `useRegisterOutcome(id)`** — the read-back never re-parses or re-evaluates the
  whole expression, so it cannot disagree with the Canvas / Timeline / M3.5 pass
  (RXA-INV-8). The only addition is a per-reference lookup: for each id in
  `refsOf(ast)`, `poolCount` / `paramValue` / another Register's outcome from
  the **same `RegisterSnapshotView`**. When the outcome is `invalid`, line 2 is
  replaced by that outcome's §RXA3.5 row — e.g.
  `Wallet 3 + Savings target 0 → cannot divide by 0` for `EVAL_DIV_ZERO`,
  attributing the failing reference from `refsOf` order + the outcome code.
- Both lines wrap; on a very long expression line 2 is capped with a "…" and the
  full breakdown is in the title.
- While the draft does not parse, line 1/2 are replaced by the existing
  parse-error note (`EXPR_… · <message at column N>`).

### RXA3.4 Reference chips + canvas peek

- In **line 1**, each rendered name is a small `<span>` chip (not a link — it
  navigates nothing). `title` / `aria-description` = the raw `@id`. `:hover`
  and keyboard focus (the line is a list of `role="listitem"` chips, arrow-key
  navigable) set `uiStore.peekRefNodeIds = [id]`.
- A new session-only `uiStore.peekRefNodeIds: string[]` (default `[]`). Canvas
  node rendering adds a `.is-ref-peek` class when a node's id is in it — a soft
  outline / halo, drawn **below** selection and Activity, dropped under
  `forced-colors` to a dashed outline. Purely visual (RXA-INV-3).
- Hovering the whole read-back block (or focusing the input) peeks **all**
  `refsOf` ids at once, so "what does this formula touch" is one glance.
- Clears on mouse-leave, input blur, node deletion, and Inspector close.

### RXA3.5 Edge-case display (fixed wording, localised EN / KO / JA)

| situation | line 1 (meaning) | line 2 (result) |
|---|---|---|
| **duplicate name** | `Savings · Pool + Savings · Register` — the kind suffix disambiguates (§RXA4) | values as normal |
| **deleted / unknown id** | `@pool_… (deleted)` chip, warn style | `— reference "pool_…" not found` |
| **wrong kind** (e.g. a Source) | `Activity (Source — not usable)` chip, warn | `— "Activity" is a Source; only Pool / Parameter / Register resolve` |
| **divide by zero** | expression as normal | `Wallet 3 / Savings target 0 → cannot divide by 0` |
| **cycle** (loaded file already cyclic) | expression as normal | `— cycle: Net worth → … → Net worth` |
| **non-finite / negative param** | expression as normal | the reference shows `—`; trailing `→ not a finite number` |
| **empty expr** | (nothing) | the existing "expression is empty" note |

`REF_UNKNOWN` / `REF_WRONG_KIND` / `REF_INVALID_ID` / `REF_NOT_FINITE` /
`EVAL_DIV_ZERO` / `EVAL_NOT_FINITE` / `M_REG_CYCLE` map 1:1 to these rows; the
codes are already produced by `errors.ts` / `registers.ts`.

## RXA4. Naming & disambiguation

- **Display name = `data.label`** of the referenced node, trimmed. Empty label
  → the node's kind + a short id tail (`Pool …q36u_2`).
- **Disambiguation:** when two *referenceable* nodes share a trimmed label,
  every occurrence of that label (in the autocomplete list and every read-back)
  is rendered as **`Label · Kind`** (`Savings · Pool`, `Savings · Register`). If
  the kind also collides, append a short id tail: `Savings · Pool …u_2`.
  Disambiguation is computed once per candidate-list build, not per render.
- Storage is always the id, so a name collision is a display concern only —
  never an ambiguous save.

## RXA5. Keyboard, screen reader, IME, mobile

- **Keyboard:** `@` opens the popover; `↑ ↓` move the active row (`aria-activedescendant`),
  `Enter` / `Tab` insert, `Esc` closes. The popover is a `role="listbox"`
  attached to the input via `aria-controls` / `aria-expanded`; focus **stays in
  the input** (combobox pattern), it is not a focus trap.
- **Screen reader:** the input has `role="combobox"`, `aria-autocomplete="list"`;
  each option row has an accessible name `"<Name>, <Kind>, current value <n>"`
  and, when disabled, `aria-disabled` + the reason in its name. The read-back
  block is an `aria-live="polite"` region so the value line is announced as the
  user edits (debounced, latest-wins — mirrors `PlaybackAnnouncer`).
- **IME (한글 / 日本語):** the popover **does not open or filter while a
  composition is in progress** (`compositionstart` → suppress, `compositionend`
  → evaluate once). `Enter` during composition commits the IME candidate, never
  an autocomplete row. Verified in the acceptance set with a real IME
  emulation.
- **Mobile:** the canvas is edit-locked on mobile (`docs/mobile.md` §MV3a), so
  the Register editor is not reachable to *edit*. Where the Inspector is shown
  **read-only** (a selected Register on a locked/mobile canvas), lines 1 and 2
  of the read-back still render — names + values, no input, no popover. That is
  the whole mobile surface for this feature.

## RXA6. Large-graph performance (RXA-INV-7)

- The candidate list (referenceable nodes + their disambiguation + current
  values) is built **once per `(nodes, S(t))` identity** — the same cache key
  `useRegisterOutcomes` already uses — and re-filtered in memory per keystroke.
  On `examples/mmo-progression.json` (97 nodes) the list is < ~40 rows and the
  filter is a linear scan of a pre-lowercased array.
- The "would create a cycle" set for the edited Register is the transitive
  **dependents** in the Register→Register dep graph `evaluateRegisters` already
  computes; taken from the memoised outcome map, not recomputed per keystroke.
- The popover renders at most `RXA_MAX_ROWS` (≈ 12) with a "+N more — keep
  typing" footer; no virtualised list needed.
- Acceptance: a keystroke in the editor on the MMO graph does **not** trigger a
  `registerEvalCount` bump and stays under a frame budget (measured, like the
  §PB4.5 budget probe).

## RXA7. `EdgeFlowField` — reuse the picker only

`EdgeFlowField` keeps its own field (a `flow` is a *single* bare reference or a
literal — never arithmetic, `docs/parameter-inputs.md` §PI1). It swaps its bare
`<select>` for the **same reference-picker component** built for §RXA3.2
(scoped to `parameter` only there) so the two authoring surfaces list
candidates identically (`Name · Parameter · = n`). The full read-back / chips /
peek block is **not** ported — a one-reference `flow` already shows its
`(label)` + resolved value inline.

## RXA8. Slice 2 — insert a reference from the canvas (separate PR)

- A small "＋ reference" affordance beside the expression input. Pressing it
  **arms** a one-shot mode: the next click on a `pool` / `parameter` /
  `register` node on the canvas inserts that node's canonical reference at the
  last caret position and disarms. `Esc` / clicking empty canvas / blurring the
  input disarms.
- While armed: referenceable nodes get a faint "pick me" affordance (reuse
  `.is-ref-peek` styling), the cursor is a crosshair, and a one-line hint sits
  under the input. Arming sets **no** selection and is session-only
  (RXA-INV-3).
- A node that would self-reference or cycle is not insertable while armed (same
  rule as RXA-INV-4) — clicking it shows the disabled reason in the hint and
  stays armed.
- Everything else (grammar, storage, digest) unchanged.

## RXA9. Acceptance / E2E

Keyed on **node / edge ids**, never rendered labels.

1. **Read-back correctness** — a Register `@a + @b` on a graph with `a` a Pool
   (count 3) and `b` a Pool (count 34): line 1 == `"<label a> + <label b>"`,
   line 2 == `"<label a> 3 + <label b> 34 = 37"`. Rename `a` → line 1/2 update
   on the next render; the stored `expr` string is unchanged (digest identical).
2. **Autocomplete contents** — `@` lists exactly the graph's `pool` /
   `parameter` / `register` nodes; a Source / Gate is absent. The edited
   Register is present but `aria-disabled` with the self reason; a Register that
   depends on it is present, disabled, with the cycle reason.
3. **Insert** — choosing a row inserts `@id` (or `@{id}`) at the caret; the
   committed `expr` parses to the same AST as typing it by hand; canonical form
   and digest match the hand-typed control.
4. **Peek is inert** — hovering a chip adds `.is-ref-peek` to exactly that node
   and sets no selection / Focus / undo / `simulationRev` / autosave; leaving
   clears it. A full-graph snapshot before == after.
5. **Edge cases** — deleted ref, wrong-kind ref, `@x / @zero`, a loaded cyclic
   Register: each shows its §RXA3.5 row; the Register still **saves** and the
   engine result is unchanged from today. **Parity (RXA-INV-8):** the read-back's
   verdict equals `useRegisterOutcome(id)` — `invalid` flag and code — for every
   fixture row; a fuzz set of expressions shows no case where the read-back says
   valid while the outcome says invalid or vice-versa.
5a. **No bare duplicate (RXA-INV-9)** — two referenceable nodes both labelled
   `Savings` (one Pool, one Register), a Register `@a + @b`: the meaning line is
   `Savings · Pool + Savings · Register`, never `Savings + Savings`; if both were
   Pools it is `Savings · Pool …tail1 + Savings · Pool …tail2`.
6. **Keyboard + SR** — `@ ↓ ↓ Enter` inserts the third candidate; `Esc` leaves
   the raw text; `role="combobox"` / `aria-expanded` / `aria-activedescendant`
   present; the read-back live-region announces the value line (debounced).
7. **IME** — with `钥` / `한` composition active, `@` + `Enter` commits the IME
   candidate and does **not** insert an autocomplete row; after
   `compositionend` the popover filters once.
8. **Performance (MMO)** — 20 keystrokes in a Register editor on
   `mmo-progression.json`: `__registerEvalCount` unchanged, popover build
   happens ≤ 1×, each keystroke handler under the frame budget.
9. **`EdgeFlowField` parity** — its picker lists `Name · Parameter · = n` for
   every Parameter and writes `@id`; the rest of the field is unchanged.
10. **Mobile / locked** — a selected Register on a locked canvas shows lines
    1/2 read-only, no input, no popover.
11. **Localisation** — every new string present in EN / KO / JA; the edge-case
    rows checked per locale.

## RXA10. Decisions

| id | question | decision |
|---|---|---|
| **RXA-D1** | rich "chip" editor vs plain input? | **Plain `<input>`.** A contenteditable token editor is IME-fragile (the app ships 한국어 / 日本語), heavy on caret / paste / undo handling, and not needed to close the gap. Revisit only if authoring stays hard after Slice 2. |
| **RXA-D2** | hide or disable self / cycle candidates? | **Disable + reason.** Hiding makes the list feel arbitrary ("why isn't Net worth here?"). (RXA-INV-4) |
| **RXA-D3** | is the canvas peek a real highlight or a preview? | **Preview only** — a new session-only `uiStore.peekRefNodeIds`, no selection / Focus / undo / digest / serialization effect. (RXA-INV-3) |
| **RXA-D4** | port the full editor UI into `EdgeFlowField`? | **No** — reuse only the reference-picker sub-component; the `flow` field stays a single-reference-or-literal input. (§RXA7) |
| **RXA-D5** | canvas-click insertion in Slice 1? | **No** — Slice 2, its own PR. Slice 1 must ship value on its own (understand + edit an existing formula). |
| **RXA-D6** | new stored field / schema / digest change? | **No.** Presentation-only; `@id` remains the sole persisted form and the digest is a function of the canonical AST, unchanged. (RXA-INV-1) |
| **RXA-D7** | `RXA_MAX_ROWS` / debounce / peek-halo styling values | Tunable constants, not structural; final values set during impl against the MMO graph. |

## RXA11. Work order

1. **Slice 1** — the reference-aware Register editor: `@` autocomplete, the
   name read-back + value breakdown lines, reference chips + `peekRefNodeIds`
   canvas halo, the §RXA3.5 edge-case rows, `EdgeFlowField` picker reuse. Behind
   §RXA9 rows 1–7, 9–11.
2. **Slice 1 verification** — the §RXA9 acceptance set incl. IME + MMO
   performance, then merge.
3. **Slice 2** — arm-and-click insert a reference from the canvas (§RXA8),
   behind §RXA9 rows 3–4 extended for the armed mode.
