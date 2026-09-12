# `@parameter` activator contract (design doc)

**Status: design — pending review (draft 1).** GS10 slice 5 — the prerequisite
named in [`docs/example-gacha-simulator.md`](example-gacha-simulator.md) GS11-D1
rev 4 ("a tunable per-banner ceiling needs `@parameter` activator support = new
slice, a prerequisite before the 3-zone Template") and confirmed as the next
kickoff after GS10-3 (hard-pity content, PR #184). No engine code, no Inspector
code, and no `SEMANTICS-S*.md` / `loop-revision/N` file ships in this PR — this
document is the contract; engine + Inspector implementation is a separate PR
after this is approved, exactly as CSU (`docs/conditional-state-update.md` →
PR #181) and label-timing (`docs/label-timing-authoring.md` → PR #182/#183)
were each split.

Prefix `PA`. Sections: **PA0** why · **PA1** today's activator contract ·
**PA2** the off-by-one problem · **PA3** scope · **PA4** proposed grammar ·
**PA5** resolution & fail-closed rules · **PA6** revision / digest / the v1→v2
latch · **PA7** Inspector authoring UI · **PA8** the 3-zone banner application
(review only) · **PA9** i18n · **PA10** acceptance · **PA11** decisions ·
**PA12** work order.

---

## PA0. Why

An `activator` gates whether its target fires this step by comparing a Pool's
value against a literal (`SEMANTICS-S.md` §S6: `(>=|>|<=|<|==|!=) <number>`).
Today that number is baked into the graph forever. A gacha hard-pity ceiling —
`HARD_PITY = 3` in GS10-3's proof — is exactly the kind of value a designer
needs to tune per banner (a Premium Pickup banner might use a 3-pull ceiling,
Premium Standard a 5-pull ceiling) without hand-editing JSON or duplicating
the whole graph per value. `loop-model/2` already solved this same problem for
resource-edge `flow` (`@id` references a Parameter, resolved once per step);
this document extends the same capability to `activator`'s comparison value.

`docs/conditional-state-update.md` (CSU) rev 4 named this explicitly: *"the
phantom user-editable `HARD_PITY` Parameter is removed (fixed design constant
until `@parameter` activator support lands)"* — CSU shipped with a fixed
constant deliberately so this document could design the general contract
properly instead of improvising it under CSU's own review pressure.

## PA1. Today's activator contract (unchanged, frozen)

From `SEMANTICS-S.md` §S6 + `src/engine/stateExpr.ts`:

- Source must be a **Pool**; `expr` must match `ACT_RE`: an operator
  (`>= > <= < == !=`) followed by whitespace and a **finite literal real**.
  Anything else → `ACT_WHY[reason]` diagnostic, the target is **not gated**
  (`isEnabled` defaults to `true` — an unparseable activator is not
  fail-closed for the TARGET, only inert for itself; unchanged, see PA5).
- Evaluated once per step, Phase 0, against `S[source]` (the step-start
  snapshot — never `working`). Multiple activators on the same target AND
  together (`enabledByNode.set(target, prevOk === undefined ? satisfied :
  prevOk && satisfied)`).
- The Inspector's `ExprField` (`kind="activator"`) is one free-text input,
  live-parsed by the same `parseActivatorExpr` the engine uses, with a
  describe-the-effect hint (`describeActivator`) or a no-effect explanation.

**Nothing above changes.** A stored activator whose `expr` is already a plain
literal comparison must parse, describe, and evaluate byte-for-byte as it does
today, in every locale and at every review round (PA11-D1).

## PA2. The off-by-one problem (must be closed first — Hanrim, 2026-09-13)

`pity` (GS10-3) counts **consecutive non-SSR pulls**. A ceiling of "force SSR
by the 3rd pull" must flip the forced-route activator on when `pity` would
**otherwise reach** 3 — i.e. `pity >= HARD_PITY - 1 = 2` — matching CSU9-D2 /
GS10-3's own convention, verified by `gacha-hard-pity.test.ts`'s "every
forced-route pull is exactly at the ceiling" test. If this design supported
only `>= @hard_pity` (comparing directly against the raw Parameter value with
no offset), a user typing the intuitive value **3** into a `hard_pity`
Parameter would silently get a **4th-pull** guarantee, not a 3rd-pull one —
reproducing exactly the class of bug `docs/example-gacha-simulator.md`
GS11-D1 spent two engine generations closing, except now surfaced through the
*authoring* surface instead of the engine. Any grammar or UI that lets a
value like this round-trip without the reader seeing the arithmetic is not an
acceptable design (PA4, PA7).

## PA3. Scope

**In:**

- `activator`'s comparison RHS may be a **literal** (today, unchanged) or a
  reference to a **Parameter** node, optionally combined with one signed
  integer offset (PA4).
- Fail-closed resolution rules for every way a reference can be bad: unknown
  id, wrong node kind, non-finite Parameter value (PA5).
- The `loop-revision` / `loop-state` contract questions this raises — framed
  as open decisions for the implementation PR to close exactly, the same way
  CSU's design doc did ("No `loop-*/N` id yet... ships under a new
  `SEMANTICS-S*.md` revision + a `loop-revision/N` decision") — not resolved
  down to file diffs here (PA6).
- The Inspector authoring surface: a Parameter picker mirroring
  `EdgeFlowField`'s existing `Name · Parameter · = value` pattern, plus a
  live resolved-value preview that is the actual fix for PA2 (PA7).
- How the 3-zone banner Template (General/Free · Premium Standard · Premium
  Pickup) would use this — reviewed for feasibility, not built (PA8).

**Out (explicitly, per Hanrim's kickoff and GS10's own slice order):**

- The engine implementation itself, the Inspector component code, and any
  `SEMANTICS-S*.md` / `SEMANTICS-R*.md` file — separate PR, after this design
  is approved.
- The 3-zone public Template itself — GS10 slice 6, after the slice-5 impl.
- Cross-banner shared pity (`pity_carry_group`, `docs/example-gacha-simulator.md`
  Appendix GSA's Track 2 spreadsheet shape) — a materially bigger feature
  (aggregating a counter across multiple graphs/banners); PA8 confirms this
  design does not block it later but does not attempt it now.
- Any arithmetic beyond one literal integer offset (no `@a + @b`, no
  multiplication, no expressions) — deliberately a **limited** offset syntax,
  not a step toward a general activator expression language (PA4).
- Soft pity / weighted dynamic Gate splits (GS11-D2, already deferred
  separately) and the 10-pull guarantee.

## PA4. Proposed grammar

Extends `ACT_RE` (`SEMANTICS-S.md` §S6) with one new right-hand-side shape,
reusing the **same reference token** `loop-expr/1` §X3 already defines for
Register/flow (`@id` / `@{id}`, tokenized by the shared `tokenize()` used by
`flow.ts`'s `parseParamRef` and `RegisterExprField`) — not a new syntax:

```
activator-expr  = op ws (literal | param-term)
op              = ">=" | "<=" | "==" | "!=" | ">" | "<"
literal         = <finite real>                     (unchanged, PA1)
param-term      = ref [ws sign ws digits]
ref             = "@" id | "@{" id "}"               (loop-expr/1 §X3, unchanged)
sign            = "+" | "-"
digits          = <non-negative integer>
```

Examples: `>= @hard_pity`, `>= @hard_pity - 1`, `< @threshold + 2`.

- **At most one offset term.** `@a - 1 - 1` or `@a - @b` are not a
  `param-term` — they parse as today's grammar would, i.e. `not-a-comparison`
  (PA1 unchanged: an unparseable `expr` is inert + one diagnostic, not a
  crash). This is the "limited offset syntax" Hanrim asked for reviewed, not
  a general expression grammar — keeping the parser a small, closed
  extension of `ACT_RE` rather than opening activator into
  `src/model/expr/`'s full arithmetic grammar (which exists for Register
  formulas and would be substantially more surface to review, test, and
  keep in sync between the engine and the Inspector for a feature whose only
  known need today is "one tunable ceiling minus one").
- The offset is an **integer** (no `1.5`) — a pity counter is always a whole
  pull count; allowing a fractional offset would create comparisons that can
  never be exactly satisfied by an integer-valued Pool, a silent footgun
  worse than the one this document exists to close.
- `@id` alone (no offset) is exactly `@id + 0` — comparing directly against
  the Parameter's resolved value, unchanged from PA5's resolution.

**PA11-D2 (open for review): is `+` actually needed, or only `-`?** Hanrim's
example is `- 1` specifically (a ceiling always fires *before* reaching the
configured count). A `+` offset has no known use case yet. Symmetric grammar
is simpler to specify and test than an asymmetric one, and either direction
is equally cheap to parse/validate — but if there's a reason to keep the
surface even smaller, dropping `+` costs nothing at this stage. Recommend
keeping both for grammar symmetry; flagging as a explicit yes/no rather than
assuming it.

## PA5. Resolution & fail-closed rules

Mirrors `loop-model/2`'s flow-reference resolution (`step.ts`'s `@id`
handling for `resEdges`, `SEMANTICS-M2.md` §M2-3) as closely as the two
contexts allow — same failure taxonomy, same "resolve once per step, before
any phase, one diagnostic per edge" shape — so an author who has already
learned what an unresolved `@id` means on a flow edge does not have to learn
a second vocabulary for activators:

| condition | resolution | diagnostic (once per edge per step) |
|---|---|---|
| target id does not exist | inert — see below | `Activator "<id>" references an unknown parameter "@<id>"; ignored.` |
| target exists, not a Parameter (Pool / Register / Source / …) | inert | `Activator "<id>" reference "@<id>" must be a parameter node (got <kind>); ignored.` |
| Parameter's `value` is not a finite number (`NaN`, `±Infinity`, missing) | inert | `Activator "<id>" parameter "@<id>" is not a finite number; ignored.` |
| resolves to a finite number `v` | `v ± offset` used as the literal RHS | none |

**"Inert" for an activator means exactly what it means today for any
unparseable `expr` (PA1): the activator contributes nothing to
`enabledByNode`, and the target's firing is decided by whatever OTHER
activators (if any) target it — with none, it fires normally.** This is a
deliberate departure from the flow precedent, where a bad `@id` resolves to
`0` (a value that still participates in arithmetic). An activator has no
"zero" that means the same thing in every context — silently treating a
broken reference as "always true" (no gate) is one plausible reading and
"always false" (permanently blocks the target) is another, and picking either
by default risks masking the broken reference behind behaviour that looks
like a deliberate design rather than a mistake. **Fail-open (inert, no
gating) is chosen over fail-closed (permanently block)** specifically
because a hard-pity ceiling that references a parameter which gets deleted
must not silently and permanently stop every future SSR — that failure mode
is worse for a live simulation than the alternative (the ceiling stops being
enforced until the reference is fixed, which is visible via the one-time
diagnostic and via Timeline behaviour immediately looking wrong). Flagged as
**PA11-D3** for explicit review — this is a real behavioural choice, not a
mechanical port of the flow rule.

No new digest-affecting state beyond what `SEMANTICS-R6.md` already
established for `timing`/`when`: **a Parameter's `value` edit already bumps
`simulationRev`** today (`graphStore.ts`'s `updateNodeData` — any patched key
other than `label` calls `bump()`), because a flow `@id` reference already
makes Parameter values engine-observable. Nothing new is required here; this
document merely confirms editing a referenced Parameter continues to move
the run the same way it already does for flow-referencing graphs.

## PA6. Revision / digest / the v1→v2 latch — open decisions for the impl PR

Two existing mechanisms this feature touches, both **decided in principle
here, wired precisely in the implementation PR**:

**PA11-D4 — the v1→v2 latch extends to activator `expr`.** Today,
`graphStore.ts`'s `setEdgeData` promotes `modelVersion` 1→2 only on a
committed **resource**-edge `flow` whose trimmed value starts with `@`
(`SEMANTICS-M2.md` §M2-1.1). An activator's `expr` starting with a bare `@`
is not currently possible to author meaningfully (PA1's grammar rejects it —
`@hard_pity` is not `ACT_RE`), so today this can never fire from an
activator. Once PA4 ships, committing a **state**-edge `activator` `expr`
whose RHS is a `param-term` must promote the SAME `modelVersion` flag, by
the same one-way rule (never on load/open, only on the user's own edit) —
reusing the existing single versioning axis rather than inventing a second
one, exactly as `loop-model/2`'s own precedent argues for.

**PA11-D5 — likely needs a new `loop-revision/N` classification (not
resolved here).** `revision.ts`'s `projectEdge()` already emits a state
edge's `expr` **verbatim** for every kind of state edge, unconditionally
(the same code path CSU's `timing`/`when` fields sit next to) — so the
*byte content* of the digest needs no new projection logic; a `>= @hard_pity
- 1` string round-trips today with zero changes. The open question is
**document-`SideVersion` classification** (`readRevisionSide` /
`isCsuContent`-style precedence), the exact thing `SEMANTICS-R6.md` had to
add for CSU: a graph can contain an activator `expr` that *looks like*
`param-term` syntax with **no Parameter node present at all** (typed, then
the Parameter deleted; copied from elsewhere; hand-edited JSON) — today that
string is simply `not-a-comparison` (inert, PA1's existing fail-closed path,
zero behavioural weight). Once this feature ships, the SAME stored string
gains new engine meaning (attempts `param-term` resolution, PA5). This is
structurally identical to CSU3-5/R6-D2's "an invalid stored value must move
the digest because it now fail-closes differently than before" finding — so
this document flags, without designing the fix, that the implementation PR
needs its own content-classification check (candidate name: `loop-revision/7`
+ `SEMANTICS-R7.md`, the next free numbers as of this writing) analogous to
`isCsuContent()`, or a documented argument for why none is needed. Not
deciding the mechanism here is deliberate — the exact classification
function is genuinely engine work, not authoring-contract work, and CSU's
own design doc ("No `loop-*/N` id yet... a `loop-revision/N` decision") took
the identical stance at this stage.

**PA11-D6 — new engine contract number.** This extends `SEMANTICS-S.md`
§S6's activator grammar, the same lineage as `SEMANTICS-S2.md` (report shape)
and `SEMANTICS-S3.md` (CSU). Candidate: `loop-state/4` + `SEMANTICS-S4.md`,
frozen in the implementation PR once the engine ships (mirrors CSU: the
design doc named the shape, `SEMANTICS-S3.md` itself was written and frozen
in PR #181).

## PA7. Inspector authoring UI

**The off-by-one (PA2) is closed by UX, not by grammar alone.** A free-text
field that merely *accepts* `>= @hard_pity - 1` does not stop an author from
typing `>= @hard_pity` and being wrong by exactly one pull — the same mistake
this whole feature exists to make tunable, now moved from "hardcoded in the
graph" to "hand-typed in a text box," which is not a fix. The design:

1. **A Parameter picker, mirroring `EdgeFlowField`'s existing shape exactly**
   (`Name · Parameter · = value` options + a literal-entry fallback) — same
   component pattern, same `params` prop shape, so an author who already
   knows the flow-field picker recognises this one immediately. Selecting a
   Parameter writes `@id` (or `@id ± N` once an offset is set) into `expr`
   atomically, same one-commit rule as every other structured field in this
   codebase (label-timing LTA-INV-8, register-ref-insert RXA8).
2. **An optional offset control** (a small integer input, default empty =
   `+0`) shown only once a Parameter is picked — not a second free-text
   field to hand-compose the whole expression in.
3. **A live, resolved-value preview line — the actual PA2 fix.** Below the
   picker, at all times: *"Fires when `pity` ≥ 2 (= Hard pity ceiling − 1,
   currently 3)"* — i.e. the EFFECTIVE number, not just the symbolic
   expression, using the exact same "resolved value" precedent
   `EdgeFlowField`'s status line and `RegisterExprField`'s dual read-back
   (`Wallet 3 + Savings 34 = 37`) already established. An author who wants
   "force by the 3rd pull" sets the offset to `-1` and immediately SEES `≥
   2` — the arithmetic is checked by reading, not by trusting a formula.
   Unresolved / bad reference states reuse PA5's exact wording, styled like
   `EdgeFlowField`'s `warn` status (an existing, understood visual class).
4. **Considered and not proposed: a dedicated "ceiling" preset** (an
   `activator` sub-mode specifically phrased as "force by the Nth pull," 
   auto-writing the `-1`). Rejected for THIS document because `activator` is
   a fully generic Pool-threshold gate — most activators are not pity
   ceilings (a stock reorder point, an unlock threshold, a stage gate) — and
   baking one domain's semantics into the general control would be the same
   mistake LTA's round-2 review caught in a different shape (a structured
   control must describe what the STORED VALUE means in general, not one
   scenario). The live-preview approach (item 3) generalises to every use of
   the offset, not just pity.
5. **Locked / mobile:** read-only text, same convention as every other
   structured field this session shipped (LTA-INV-4, register-expr
   locked/mobile) — the resolved-value sentence from item 3, no picker, no
   offset input.
6. **Undo:** one atomic commit per pick/offset-edit, same `setEdgeData`
   single-`commit()` contract every other structured Inspector field uses
   (LTA-INV-8, RXA8's arm-and-click insert).
7. **Existing literal `ExprField` free-text path stays** for an author who
   prefers typing the raw expression directly (parity with `EdgeFlowField`,
   which keeps its own literal `<input>` alongside the picker) — the picker
   is an additive convenience, not a replacement path, so nothing behind a
   currently-working workflow changes (PA1).

## PA8. The 3-zone banner application (feasibility review only)

Per `docs/example-gacha-simulator.md`'s banner table (General/Free · Premium
Standard · Premium Pickup), each zone needs its **own independently tunable**
hard-pity ceiling. Under this design that is simply: one Parameter node per
zone (e.g. `hard_pity_standard`, `hard_pity_pickup`) feeding that zone's own
pair of activators (`< @hard_pity_standard - 1`, `>= @hard_pity_standard - 1`)
— structurally identical to GS10-3's fixed-literal pair, with the literals
replaced by references. No engine or grammar gap: three zones need three
Parameter nodes and six activators (two per zone), all expressible today
under PA4/PA5 with no cross-zone coupling.

**`pity_carry_group`** (Appendix GSA's Track 2 spreadsheet column — a shared
pity counter across e.g. Premium Standard and Premium Pickup, so a near-miss
on one banner "carries" into the other) is explicitly **not** addressed by
this design: it requires a `pity` counter's value to be read/written by
labels attached to a DIFFERENT zone's routing, which is a graph-wiring
question (which Pool is shared, which afterPull labels touch it), not an
activator-grammar one. This design does not preclude it — a shared `pity`
Pool referenced by two zones' activators via `@hard_pity_x - 1` works exactly
the same whether `pity` is zone-local or shared — but building that shared
wiring is out of scope here and left to whichever later slice actually
designs cross-banner carry-over.

## PA9. i18n (EN/KO/JA)

New strings, following the existing `inspector.edge.flowParam.*` /
`inspector.labelTiming.*` naming shape:

- `inspector.activator.paramPicker.literalOption` — "Literal value" (mirrors
  `inspector.edge.flowParam.literalOption`).
- `inspector.activator.paramPicker.pickLabel` — the `aria-label` for the
  `<select>`.
- `inspector.activator.offsetLabel` — the offset input's label (e.g. "Offset").
- `inspector.activator.preview.resolved` — the live sentence, parameterised
  with the operator word, the resolved threshold, the Parameter's label, its
  raw value, and the offset (localises to natural KO/JA phrase order, not a
  template concatenation — same lesson as `regExpr.*`'s dual read-back).
- `inspector.activator.preview.unknown` / `.notParam` / `.nonFinite` — reuse
  PA5's three failure wordings, phrased for the Inspector (mirrors
  `inspector.edge.flowParam.unknown` / `.notParam`).
- `inspector.activator.readOnlyPreview` — the locked/mobile sentence (PA7.5).

No changes to any EXISTING key — `inspector.field.condition`,
`inspector.activator.describe`, and every `ACT_HINT`/`ACT_WHY` string for the
literal path are untouched (PA1).

## PA10. Acceptance (for the implementation PR)

1. A plain literal activator (`>= 5`) parses, describes, evaluates, and
   round-trips byte-identically before and after this feature ships — on the
   engine, the Inspector, and the revision digest.
2. `>= @hard_pity` with `hard_pity = 3` resolves to `>= 3`; a Pool value of 3
   satisfies it (no offset ⇒ direct reference, PA4).
3. **The headline test.** `>= @hard_pity - 1` with `hard_pity = 3`: a
   deterministic non-SSR-until-ceiling run (`gacha-hard-pity.test.ts`'s own
   `non-ssr` fixture, updated to use a Parameter instead of the literal
   `HARD_PITY - 1`) forces SSR on **exactly the 3rd pull**, every ceiling
   window, matching the already-shipped GS10-3 behaviour bit-for-bit — this
   design must not regress GS10-3's own acceptance suite.
4. Unknown id / wrong kind (Pool, Register, Source, …) / non-finite value —
   each inert + exactly one diagnostic per edge per step (not per step
   forever — same de-dup discipline as the existing `randReason` /
   `gateInertReason` caches), and the target's firing is ungated by that
   activator specifically (PA5's fail-open choice), not permanently blocked.
5. Editing the referenced Parameter's value changes the activator's
   effective threshold on the very next step (no stale cache across steps)
   and bumps `simulationRev` (already-existing behaviour, confirmed
   unregressed).
6. Committing a state-edge `activator` `expr` containing a `param-term`
   promotes `modelVersion` 1→2 exactly once, on the user's own edit, never
   on load (PA11-D4); loading a file that already contains one does not
   re-trigger the promotion path.
7. Whatever `loop-revision/N` classification PA11-D5 lands on: a graph using
   ONLY this feature (a `param-term` activator + its Parameter, no other
   model-layer content) round-trips through Apply / selective-Apply / the
   three-way merge without an `R2-INV-2`-style assertion crash (the exact
   regression class `SEMANTICS-R6.md` closed for CSU) — this is the PRIMARY
   acceptance gate for whichever mechanism the impl PR picks.
8. Inspector: picking a Parameter from the dropdown, then setting an offset,
   is ONE additional Undo entry per field commit (not one per keystroke);
   the preview sentence updates live as the Parameter's own value changes
   elsewhere in the session (selection stays on the activator edge).
9. Locked / mobile: the activator field renders the resolved-value sentence
   read-only, no picker, no offset input, matching PA7.5.
10. EN/KO/JA: the preview sentence reads as a natural sentence in each
    locale (not a raw template concatenation), verified the same way
    `register-expr-authoring.spec.ts` verifies its dual read-back.

## PA11. Decisions

- **PA11-D1** — existing literal activators are byte-identical after this
  ships; the new grammar is strictly additive (PA1, PA3).
- **PA11-D2** — open: keep both `+` and `-` offset signs, or `-` only? No
  known use case for `+` yet; recommend keeping both for grammar symmetry
  (PA4).
- **PA11-D3** — a broken `@id` reference makes its OWN activator inert
  (fail-OPEN — ungates, does not permanently block), chosen because a
  disappearing Parameter must not silently freeze a live ceiling forever
  (PA5). Flagged for explicit sign-off since it diverges from the flow
  precedent's "resolves to 0" convention.
- **PA11-D4** — the v1→v2 `modelVersion` latch extends to a state-edge
  `activator` `expr` containing a `param-term`, reusing the one existing
  versioning axis rather than adding a second (PA6).
- **PA11-D5** — open, impl-PR decision: a new `loop-revision/N` document
  classification is likely needed (candidate `loop-revision/7` /
  `SEMANTICS-R7.md`) for the same reason CSU needed `loop-revision/6` — an
  `expr` string that used to be inert-and-harmless can now fail-close with
  new behavioural weight. Not designed here; the impl PR must show its
  acceptance test (PA10-7) either way (PA6).
- **PA11-D6** — new engine-contract number, candidate `loop-state/4` /
  `SEMANTICS-S4.md`, frozen in the implementation PR once written (PA6).
- **PA11-D7** — the Inspector fixes the off-by-one (PA2) via a live
  resolved-value preview sentence, not a domain-specific "ceiling" preset —
  keeps `activator` generic; a pity-specific helper was considered and
  rejected (PA7.4).

## PA12. Work order

1. **This document** — design review, this PR. No code.
2. **Engine implementation** — `SEMANTICS-S4.md` (frozen), `param-term`
   parsing + resolution in `stateExpr.ts` / `step.ts`, the `loop-revision/N`
   classification PA11-D5 requires (with its own acceptance vector, mirroring
   `revision-v6-fixture.test.ts`), the `modelVersion` latch extension
   (PA11-D4). Separate PR.
3. **Inspector authoring UI** — the Parameter picker + offset control + live
   preview (PA7), EN/KO/JA (PA9). Same PR as (2) or its own, per however the
   implementation PR is scoped once started — not decided here.
4. **GS10-3's own fixture updated** to reference a Parameter instead of the
   literal `HARD_PITY - 1`, proving PA10-3 against the real gacha content
   (not just a synthetic engine test).
5. **3-zone public Template** (GS10 slice 6) — after (2)/(3) ship. Not
   started, not designed beyond PA8's feasibility note.

README stays untouched until (2)/(3) actually ship a user-visible feature
(the established rule this session followed for every prior slice).
