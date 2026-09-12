# `@parameter` activator contract (design doc)

**Status: design — pending review (draft 2).** GS10 slice 5 — the prerequisite
named in [`docs/example-gacha-simulator.md`](example-gacha-simulator.md) GS11-D1
rev 4 ("a tunable per-banner ceiling needs `@parameter` activator support = new
slice, a prerequisite before the 3-zone Template") and confirmed as the next
kickoff after GS10-3 (hard-pity content, PR #184). No engine code, no Inspector
code ships in this PR — this document is the contract (including the frozen
`loop-state/4` / `loop-revision/7` numbers, PA6); engine + Inspector
implementation is a separate PR after this is approved, exactly as CSU
(`docs/conditional-state-update.md` → PR #181) and label-timing
(`docs/label-timing-authoring.md` → PR #182/#183) were each split.

**Draft 2 (Hanrim, round 1)** fixed three problems in draft 1: (1) PA5/PA11-D3
described fail-open reference resolution while the summary called it
fail-closed — a real contradiction, not a wording slip; resolved by splitting
"grammar-invalid" from "grammar-valid-but-unresolvable" and giving them
opposite outcomes (PA5). (2) The grammar was under-specified as an informal
description rather than an unambiguous one — rewritten as a single fixed
production with explicit, named rejections (PA4). (3) `loop-state/4` and
`loop-revision/7` were left as "candidate, impl-PR's call" — frozen here
instead, including the exact rule for which activators count as
`loop-revision/7` content (PA6). A fourth point — which pity Pool the 3-zone
review assumes — is also made explicit rather than left implicit (PA8).

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
- Resolution rules for every way a syntactically-valid reference can fail —
  unknown id, wrong node kind, non-finite Parameter value, an overflowing
  computed threshold — and the fail-CLOSED consequence for the target
  (PA5), a genuinely different outcome from a grammar-invalid `expr`
  (unchanged, fail-open, PA1).
- The `loop-revision`/`loop-state` numbers this raises: **frozen in this
  document** (`loop-state/4`, `loop-revision/7`, including the exact
  classification rule for the latter) — only the two files' prose and the
  engine wiring are left to the implementation PR (PA6).
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

## PA4. Fixed grammar

Extends `ACT_RE` (`SEMANTICS-S.md` §S6) with exactly ONE new right-hand-side
production, reusing the **same reference token** `loop-expr/1` §X3 already
defines for Register/flow (`@id` / `@{id}`, tokenized by the shared
`tokenize()` used by `flow.ts`'s `parseParamRef` and `RegisterExprField`) —
not a new token, and unambiguous by construction (no case falls through two
rules):

```
activator-expr = op ws (literal | param-term)
op             = ">=" | "<=" | "==" | "!=" | ">" | "<"
literal        = <finite real>                        (unchanged, PA1)
param-term     = ref [ws ("+" | "-") ws offset]
ref            = "@" id | "@{" id "}"                  (loop-expr/1 §X3, unchanged)
offset         = <non-negative safe integer>           (/^\d+$/, i.e. Number.isSafeInteger, ≥ 0)
```

In Hanrim's own shorthand: `<비교연산자> @<parameter-id> [("+" | "-")
<음이 아닌 안전한 정수>]` — i.e. `>= @hard_pity - 1` is `param-term`; every one
of the following is explicitly **rejected** (parses as `not-a-comparison`,
the existing PA1 literal-invalid path, not a crash):

- `+ -1` / `- -1` — the sign token and the offset are two separate grammar
  positions; `offset` itself may never carry its own sign (no `\d+` match on
  a string starting with `-`), so a doubled sign cannot occur by construction,
  not by a runtime check.
- `1.5`, `1e3`, any non-integer or non-finite-as-a-token spelling — `offset`
  is `/^\d+$/` only.
- An offset outside `Number.isSafeInteger` range — rejected at parse time,
  not left to silently lose precision.
- `@a - @b`, `@a - 1 - 1`, any second reference or second operator — at most
  ONE `ref` and at most ONE signed `offset`, full stop.
- `(`, `)`, `*`, `/`, or any other arithmetic — `param-term` has no
  sub-grammar for expressions; this is a **closed, fixed** extension of
  `ACT_RE`, not a doorway into `src/model/expr/`'s full Register-formula
  grammar (substantially more surface to review/test/keep in sync between
  engine and Inspector, for a feature whose only known need is "one tunable
  ceiling minus one" — see PA3's "out" list).

`@id` alone (no offset) is exactly `@id + 0` — comparing directly against the
Parameter's resolved value (PA5).

**The FINAL computed threshold must also be checked for finiteness**, not
just the raw Parameter value: `resolvedValue ± offset` is computed as a
JavaScript number and MUST itself pass `Number.isFinite` before use as the
comparison RHS (a resolved value near `Number.MAX_SAFE_INTEGER` combined with
a large offset can overflow to `Infinity`; PA5's resolution table's third row
covers this explicitly, not just "the stored `.value` field itself is
non-finite").

**PA11-D2 (open for review): is `+` actually needed, or only `-`?** Hanrim's
own example is `- 1` specifically (a ceiling always fires *before* reaching
the configured count); `+` has no known use case yet. Symmetric grammar is no
harder to specify or test than an asymmetric one, and either direction is
equally cheap to validate — but if there's a reason to keep the surface even
smaller, dropping `+` costs nothing. Recommend keeping both for symmetry;
flagged as an explicit yes/no, not assumed. (This is the one open grammar
question left after draft 2 — everything else in this section is fixed.)

## PA5. Resolution & fail-closed rules

**Two genuinely different failure classes, with opposite outcomes — this is
the fix draft 1 got backwards by conflating them into one "inert" bucket.**

**Class 1 — `expr` does not even PARSE as a comparison** (today's existing
PA1 cases: empty, op-only, `not-a-comparison`, `non-finite` literal — plus
every grammar rejection PA4 names, e.g. `+ -1`, two references, an
out-of-range offset). **Unchanged from today, byte-for-byte**: the edge is
inert — it contributes nothing to `enabledByNode`, the target's firing is
decided by whatever OTHER activators target it, and with none it fires
normally (fail-open for the TARGET). This is existing, frozen behaviour
(PA1/PA11-D1) for a literal mistyped comparison and stays exactly as-is; PA4
is written precisely so that every rejected shape lands here, not in a new
bucket.

**Class 2 — `expr` DOES parse as `param-term` (the grammar is valid) but the
reference cannot be RESOLVED to a usable number.** This is new with this
feature and gets the opposite treatment: the activator counts as an activator
that evaluated to **not satisfied**, joining the same `enabledByNode` AND
every other activator on that target already uses
(`prevOk === undefined ? false : prevOk && false`) — the target is gated OFF
by this activator, exactly as if the comparison had been evaluated and come
out false. One diagnostic per edge per step (same de-dup discipline as
`randReason`/`gateInertReason`):

| condition | `satisfied` | diagnostic (once per edge per step) |
|---|---|---|
| `ref`'s id does not exist | `false` | `Activator "<id>" references an unknown parameter "@<id>"; target not gated on this comparison.` |
| id exists, not a Parameter (Pool / Register / Source / …) | `false` | `Activator "<id>" reference "@<id>" must be a parameter node (got <kind>); target not gated on this comparison.` |
| Parameter's `value` is not a finite number (`NaN`, `±Infinity`, missing) | `false` | `Activator "<id>" parameter "@<id>" is not a finite number; target not gated on this comparison.` |
| resolves to a finite `v`, but `v ± offset` overflows (not finite — PA4) | `false` | `Activator "<id>" parameter "@<id>" resolves to a non-finite threshold; target not gated on this comparison.` |
| resolves to a finite `v`, `v ± offset` is finite | `cmp(S[source], op, v ± offset)` | none |

**Why the reversal from draft 1's fail-open framing.** A syntactically valid
`@parameter` reference is, by construction, an author's DECLARED intent to
gate on that value — unlike a garbled literal (Class 1, which is simply not
a comparison at all, and never was). If the referenced Parameter disappears
or breaks, the SAFE default for a construct whose entire job is "control
whether resources move" is to **stop them moving**, not to let an unbounded,
now-uncontrolled probabilistic draw continue as if no ceiling were ever
configured — exactly Hanrim's concrete danger: a deleted hard-pity Parameter
must not let plain-probability rolling continue forever. This also removes
the contradiction draft 1 had between its own summary text ("references are
fail-closed") and PA11-D3's mechanism ("fail-open, ungates") — they now
agree: **Class 2 is fail-closed.**

**Digest / `simulationRev` — corrected reasoning.** Draft 1 attributed this
to "flow references make Parameter values engine-observable," which is
inaccurate: a Parameter node's `value` field is projected into the canonical
revision digest **unconditionally**, by `revision.ts`'s `projectNode()` —
any node whose `kind` is in `MODEL_NODE_KINDS` (`parameter`/`register`) is
already required to be model-layer content and has every one of its declared
fields (`MODEL_NODE_FIELDS['parameter']`, which includes `value`) projected
regardless of whether any edge anywhere references it. Likewise `expr` on a
state edge is already emitted verbatim by `projectEdge()` for every state
edge, unconditionally (PA6). So both edits already move the digest and
(`graphStore.ts`'s `updateNodeData`/`setEdgeData` — any patched key other
than a pure `label` rename calls `bump()`) already move `simulationRev`
TODAY, with or without this feature, with or without any `@id` reference
existing anywhere in the graph. This document adds **no new stored field and
no new digest-affecting mechanism** for this part — PA6 covers the one part
that IS new (document-`SideVersion` *classification*, a different question
from digest *content*).

## PA6. Revision / digest / the v1→v2 latch — frozen this round

Per Hanrim's round-1 review, the version contract is decided NOW, not left to
the implementation PR — mirroring how `SEMANTICS-R6.md` itself was a
complete, numbered contract before PR #181 wrote a line of engine code.

**PA11-D6 — new engine-contract number: `loop-state/4`, `SEMANTICS-S4.md`.**
This extends `SEMANTICS-S.md` §S6's activator grammar — same lineage as
`SEMANTICS-S2.md` (report shape) and `SEMANTICS-S3.md` (CSU). The file is
still *written and frozen in the implementation PR* (there is no engine yet
to describe precisely in prose the way `SEMANTICS-S3.md`'s finished text
was), but the **number** `loop-state/4` is fixed by this document, not left
open.

**PA11-D5 — new document classification: `loop-revision/7`,
`SEMANTICS-R7.md`, with the exact rule fixed here.** `revision.ts`'s
`projectEdge()` already emits a state edge's `expr` **verbatim** for every
kind of state edge, unconditionally (the same code path CSU's `timing`/`when`
fields sit next to) — so the *byte content* of the digest needs zero new
projection logic; a `>= @hard_pity - 1` string round-trips today with no
changes. What DOES need a new `SideVersion` (`readRevisionSide` /
`isCsuContent`-style precedence — the exact mechanism `SEMANTICS-R6.md` added
for CSU) is that an activator `expr` can look like valid `param-term` syntax
with **no resolvable Parameter behind it at all** (the id deleted, wrong
kind, hand-edited JSON) — today that string is simply `not-a-comparison`,
inert, zero behavioural weight (PA5 Class 1). Once this feature ships, the
SAME stored string gains new engine meaning: it becomes a Class 2
resolution failure that **actively gates its target off** (PA5) — a strictly
bigger behavioural change than CSU3-5/R6-D2's own finding, since this one
can newly *block* resource movement that used to happen unconditionally.

**The rule, fixed:** a state edge counts as `loop-revision/7` content **the
moment its `expr` parses as `param-term` under PA4's grammar (`mode ===
'activator'`, RHS matches `param-term`) — independent of whether the
referenced id exists, is the right kind, or holds a finite value.**
Classification is a syntactic check, not a resolution — it must not need a
`byId` node lookup to decide the document's `SideVersion`, for the same
reason `isCsuContent()` doesn't try to resolve anything either: classifying
by RESOLVED state would make the digest depend on which OTHER nodes happen
to exist elsewhere in the same document, an even worse coupling than the one
being fixed. This mirrors CSU's own precedent exactly (a `label` with any
non-default `timing`/`when` moved the digest regardless of whether the
label's source/target were even the right kind — SEMANTICS-R6.md §R6-2) and
gives the implementation PR a single, purely-syntactic predicate to add to
`readRevisionSide`'s precedence list, checked before the existing
model/routing/frames checks (same ordering CSU's `isCsuContent()` needed, and
for the identical reason: a pure `loop-revision/7` graph may have no
Parameter, Register, routing, or frame content at all — e.g. an
`@hard_pity - 1` activator whose Parameter was since deleted).

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

**No new stored field, either version.** Both `loop-state/4` and
`loop-revision/7` describe new MEANING attached to the existing `expr`
string column — nothing new is written to a `LoopEdge`/`LoopNode` beyond
what `activator`/`parameter` already store today (PA5's corrected digest
note applies here too: `expr` and `parameter.value` are already
unconditionally engine-affecting projection content).

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
   A Class-2 resolution failure (PA5) reuses PA5's exact wording but must say
   what it now DOES, not just that it's wrong — e.g. *"Unknown parameter
   `@ghost` — this activator is currently blocking its target"* — styled
   like `EdgeFlowField`'s `warn` status (an existing, understood visual
   class) but worded as a live consequence, not a passive validation note,
   since draft 1's Class-2 outcome (block) is materially more dangerous to
   miss than a merely-cosmetic warning would suggest.
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

**Explicit assumption for this review: SEPARATE `pity` Pools per zone, not
shared.** This design's 3-zone example — General/Free with no pity (or its
own independent one), Premium Standard with its own `pity_standard` Pool +
`hard_pity_standard` Parameter, Premium Pickup with its own `pity_pickup`
Pool + `hard_pity_pickup` Parameter — has THREE independent pity Pools, zero
Pools shared across zones, and zero activators that reference a Parameter
belonging to a different zone's ceiling. This is a deliberate, statable
choice (not an accidental omission): it is the simplest wiring that
satisfies "each zone has its own tunable ceiling," and it is what GS10-3's
own test graph already generalises to directly.

**`pity_carry_group`** (Appendix GSA's Track 2 spreadsheet column — a SHARED
pity counter across e.g. Premium Standard and Premium Pickup, so a near-miss
on one banner "carries" into the other) would instead require Premium
Standard's and Premium Pickup's routing to both read and write the SAME
`pity` Pool (one shared Pool, not one per zone) while still allowing each
zone's activator to compare against its OWN `hard_pity_x` Parameter against
that shared value — e.g. `pity >= @hard_pity_pickup - 1` and
`pity >= @hard_pity_standard - 1` both reading one shared `pity`. Nothing in
PA4/PA5's grammar or resolution rules prevents this (a `param-term`'s LHS is
still just "whatever Pool source this activator edge starts from" — the
grammar does not know or care whether that Pool is zone-local or shared) —
but the graph-wiring design of WHICH afterPull labels touch the shared Pool,
and how a pickup-banner switch interacts with an in-progress carried pity
count, is real design work this document does not attempt. **Confirmed: this
design does not block `pity_carry_group` later; it also does not build the
separate-vs-shared decision for it — that is left, unresolved, to whichever
later slice designs cross-banner carry-over.**

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
- `inspector.activator.preview.unknown` / `.notParam` / `.nonFinite` /
  `.overflow` — reuse PA5's four Class-2 failure wordings, phrased as a live
  consequence ("…is currently blocking its target"), not a passive
  validation note (PA7.3) — mirrors `inspector.edge.flowParam.unknown` /
  `.notParam` in shape but not in tone, since the outcome here is materially
  more consequential than a flow edge silently contributing 0.
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
4. Unknown id / wrong kind (Pool, Register, Source, …) / non-finite value /
   an overflowing `v ± offset` — each is a Class-2 failure (PA5): exactly one
   diagnostic per edge per step (not per step forever — same de-dup
   discipline as the existing `randReason`/`gateInertReason` caches), AND the
   target is actively **gated off** by that activator (`satisfied: false`
   joins the AND with any other activators on the same target) — not merely
   left ungated. A grammar-invalid `expr` (PA1's existing cases, unchanged)
   stays the OPPOSITE: inert, target ungated by that edge — the two must not
   be conflated (this was draft 1's bug).
5. Editing the referenced Parameter's value changes the activator's
   effective threshold on the very next step (no stale cache across steps)
   and bumps `simulationRev` (already-existing behaviour, confirmed
   unregressed).
6. Committing a state-edge `activator` `expr` containing a `param-term`
   promotes `modelVersion` 1→2 exactly once, on the user's own edit, never
   on load (PA11-D4); loading a file that already contains one does not
   re-trigger the promotion path.
7. A graph containing ONLY a `param-term` activator (its Parameter present,
   absent, or wrong-kind — classification is syntactic, PA6) and no other
   model-layer content classifies as `loop-revision/7`, and round-trips
   through Apply / selective-Apply / the three-way merge without an
   `R2-INV-2`-style assertion crash (the exact regression class
   `SEMANTICS-R6.md` closed for CSU). A graph with ONLY literal activators
   (PA1, unchanged) continues to classify exactly as it does today — this
   feature's classification check must not fire for content it doesn't
   apply to.
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
- **PA11-D3 (reversed in draft 2)** — a syntactically-valid `param-term`
  reference that fails to RESOLVE (unknown id / wrong kind / non-finite /
  overflowing threshold) makes its activator evaluate to **not satisfied**,
  gating its target OFF (fail-CLOSED) — the opposite of a grammar-invalid
  `expr` (PA1, unchanged, stays fail-open/inert). Chosen because an author
  writing `@id` has declared explicit gating intent, and a construct whose
  job is controlling resource movement must default to STOPPING it when its
  own condition breaks, not silently removing the gate (PA5).
- **PA11-D4** — the v1→v2 `modelVersion` latch extends to a state-edge
  `activator` `expr` containing a `param-term`, reusing the one existing
  versioning axis rather than adding a second (PA6).
- **PA11-D5 (frozen in draft 2)** — new document classification
  `loop-revision/7` / `SEMANTICS-R7.md`. The rule is fixed here: a state
  edge counts as `loop-revision/7` content the moment its `expr` parses as
  `param-term` (PA4), independent of whether the reference resolves — a
  purely syntactic check, mirroring `isCsuContent()`'s own precedent of
  never resolving anything to decide `SideVersion` (PA6).
- **PA11-D6 (frozen in draft 2)** — new engine-contract number
  `loop-state/4` / `SEMANTICS-S4.md`. The number is fixed now; the file's
  prose is written and frozen in the implementation PR, once there is an
  engine to describe (PA6).
- **PA11-D7** — the Inspector fixes the off-by-one (PA2) via a live
  resolved-value preview sentence, not a domain-specific "ceiling" preset —
  keeps `activator` generic; a pity-specific helper was considered and
  rejected (PA7.4).
- **PA11-D8** — the 3-zone review (PA8) assumes SEPARATE `pity` Pools per
  zone (three Pools, three Parameters, zero cross-zone references) as its
  baseline example; `pity_carry_group` (a single SHARED `pity` Pool across
  zones) is confirmed not blocked by this grammar but is explicitly left
  undesigned, for a later slice.

## PA12. Work order

1. **This document** — design review, this PR. No code.
2. **Engine implementation** — `SEMANTICS-S4.md` (`loop-state/4`, number
   frozen here, prose written in this PR) + `SEMANTICS-R7.md` (`loop-revision/7`,
   number and classification rule frozen here, `readRevisionSide` wiring
   written in this PR), `param-term` parsing + Class-1/Class-2 resolution in
   `stateExpr.ts`/`step.ts` (PA5), the `modelVersion` latch extension
   (PA11-D4), and a golden-vector test mirroring
   `revision-v6-fixture.test.ts`. Separate PR.
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
