# Expression grammar & evaluation

```
Spec ID: loop-expr/1
Status:  Draft
```

**Draft for review.** Defines a **small, deterministic expression language** —
its grammar, its reference syntax, its numeric rules, and how it is
evaluated — and nothing else. It is a foundation used by `loop-model/1`
(Register expressions) and, by later amendment only, elsewhere.

Layered under `loop-model/1`. It does **not** change how a diagram runs today:
`SEMANTICS.md`, `SEMANTICS-B1.md` / `-B2.md`, `SEMANTICS-S.md` / `-S2.md`
(`loop-state/1` / `/2`), `SEMANTICS-W.md`, `SEMANTICS-U.md`, `SEMANTICS-R.md`
are unaffected. §X10 records the open decisions to settle before freeze.

---

## X0. Scope

**In**

- a grammar: literals, references, arithmetic, comparison, a conditional, and a
  fixed set of numeric functions;
- an **ID-based** reference token (stable across renames);
- exact rules for non-finite results and division by zero;
- a single-pass, side-effect-free, deterministic evaluation model;
- three error classes (parse / resolve / evaluate) each with a stable
  diagnostic;
- the **canonical text form** used for the `loop-revision/2` digest;
- a compatibility statement toward `loop-state/1` / `/2`.

**Out** (each is a separate spec or a later amendment)

- what an expression is *attached to* and what its result *means* — that is
  `loop-model/1` (Register) and future amendments (Gate condition, Source
  amount, Converter ratio);
- variables, assignment, statements, loops, user-defined functions, string
  values, arrays/objects, property access, method calls;
- randomness, time, or any I/O;
- replacing the `loop-state/1` / `/2` state-edge expression grammar (§X9).

---

## X1. Values

The only value type is a **finite IEEE-754 double** (`float64`). There is no
separate boolean type:

- a comparison (`<`, `<=`, `>`, `>=`, `==`, `!=`) yields **`1`** (true) or
  **`0`** (false);
- the conditional `c ? a : b` treats **`c == 0` as false** and any other finite
  value as true.

`NaN` and `±Infinity` are **never** valid values (§X5): an expression that would
produce one is an **evaluate error**, not a value.

---

## X2. Grammar

```
expr        = conditional
conditional = or_expr ( "?" expr ":" expr )?          // right-assoc; ternary
or_expr     = and_expr                                 // (|| reserved, see X10-2)
and_expr    = compare                                  // (&& reserved, see X10-2)
compare     = additive ( ( "<" | "<=" | ">" | ">=" | "==" | "!=" ) additive )?   // non-assoc: at most one
additive    = multiplic ( ( "+" | "-" ) multiplic )*
multiplic   = unary ( ( "*" | "/" ) unary )*
unary       = ( "-" )? primary                         // unary minus only; no unary "+", no "!"
primary     = number | reference | call | "(" expr ")"
call        = fnname "(" ( expr ( "," expr )* )? ")"
fnname      = "min" | "max" | "clamp" | "abs" | "round"
reference   = "@" id                                   // X3
number      = /-?\d+(\.\d+)?([eE][+-]?\d+)?/            // parsed as float64; must be finite
id          = /[A-Za-z_][A-Za-z0-9_]*/                 // matches the app's node-id charset (X3)
```

- **Precedence**, lowest → highest: `?:` < comparison < `+ -` < `* /` <
  unary `-` < call / grouping.
- **Comparison is non-associative** — `a < b < c` is a **parse error** (write
  `(a < b) < c`). Comparisons chain only through the conditional or parentheses.
- **Whitespace** between tokens is insignificant *to evaluation* (it is
  significant to the canonical text form, §X8).
- No implicit multiplication (`2 @a` is a parse error), no trailing operators,
  no empty parentheses except an empty argument list is disallowed
  (`min()` → parse error; every function needs ≥ 1 argument, §X4).

### X2.1 Functions

| Function | Arity | Result |
|---|---|---|
| `abs(x)` | 1 | `\|x\|` |
| `round(x)` | 1 | nearest integer, **half away from zero** (`round(2.5) == 3`, `round(-2.5) == -3`) |
| `min(a, b, …)` | ≥ 2 | the least argument |
| `max(a, b, …)` | ≥ 2 | the greatest argument |
| `clamp(x, lo, hi)` | 3 | `min(max(x, lo), hi)`; if `lo > hi` the result is **`lo`** (documented, not an error) |

No other names are callable. `round` is the only rounding primitive; there is no
`floor` / `ceil` / `trunc` / `sqrt` / `pow` / `%` in `loop-expr/1` (§X10-3).

---

## X3. References — `@id`

A reference is `@` immediately followed by an identifier that is the **stable
node id** of the referenced element (e.g. `@pool_mtc00jt3_2`). It is **not** a
label.

- **Resolution** is `loop-model/1`'s job — this spec only fixes the *syntax* and
  the *stored form*. `loop-model/1` decides which node kinds are referenceable
  and what a reference evaluates to.
- **Rename stability** — a reference holds an id, so renaming the target's
  `label` never changes an expression's bytes (§X-INV-3).
- **Editor display** — an editor MAY render `@id` as the target's current label
  in a token/chip and offer a picker, but what it stores and digests is always
  the `@id` form.
- **Unknown / wrong-kind id** — a **resolve error** (§X7), surfaced by the
  consumer; it does not throw and does not halt anything.
- An `@` not followed by a valid id, or an id that is not a known reference at
  parse time is still a valid *parse* (the grammar accepts any `@id`); it fails
  at **resolve**, so a diagnostic can name the missing id.

---

## X4. Static (parse-time) checks

At parse time, with no values yet:

- syntax per §X2;
- every function name is in §X2.1 and its **arity** is satisfied
  (`clamp` needs exactly 3; `min`/`max` need ≥ 2; `abs`/`round` need exactly 1);
- every numeric literal is finite (`1e999` → parse error);
- comparison non-associativity (§X2).

A parse failure yields a **parse error** (§X7) with a 1-based column and a short
message; the expression has no AST and never evaluates.

---

## X5. Numeric rules

Evaluation is over `float64`. After **every** operation and function call the
result must be **finite**; otherwise the whole expression is an **evaluate
error** (§X7) — it does **not** yield `Infinity` / `NaN` / a clamped stand-in.

- **`/` by zero** — `x / 0` (any `x`, including `0`) → evaluate error
  (`division by zero`).
- **overflow** — a `+`, `-`, `*` result with magnitude `> Number.MAX_VALUE`
  (i.e. `±Infinity`) → evaluate error (`result is not finite`).
- **`NaN`** — cannot arise from finite inputs under this grammar except via
  `0/0` (already caught) — but any `NaN` anywhere → evaluate error.
- inputs (referenced values, resolved by `loop-model/1`) are **guaranteed
  finite** by their source specs; if a consumer ever supplies a non-finite
  input, that is a resolve error at the reference, not an evaluate error.
- **`-0`** normalises to `0` before it can be observed (matches `SEMANTICS-R.md`
  §R4.1).
- results are **not** rounded or clamped implicitly — use `round` / `clamp`.

---

## X6. Evaluation model

- **Pure.** No side effects, no state, no RNG, no clock. `eval(ast, lookup)` is
  a function of the AST and the values `lookup` returns for each `@id`.
- **Deterministic.** Same AST + same resolved inputs ⇒ bit-identical result,
  on any platform, on any run, on reset / replay.
- **Single pass, no recursion in the language.** The AST is walked once,
  depth-first, left-to-right. The **conditional short-circuits**: `c ? a : b`
  evaluates `c`, then exactly one of `a` / `b`. (This matters for §X5: the
  branch not taken cannot raise an evaluate error.) `min` / `max` / `clamp`
  arguments are all evaluated (no short-circuit).
- Evaluation order among siblings is **left-to-right** and fixed, so the *first*
  evaluate error encountered is the one reported (stable diagnostics).
- The language cannot reference itself or iterate; any cross-expression cycle is
  the consumer's concern (`loop-model/1` §M3 for Registers).

---

## X7. Errors

Three classes, checked in this order; the first hit is reported:

| Class | When | Carries |
|---|---|---|
| **parse** | §X4 fails | `{ kind: 'parse', column, message }` |
| **resolve** | an `@id` is unknown or of a kind the consumer does not allow | `{ kind: 'resolve', id, message }` |
| **evaluate** | §X5 (`division by zero`, `result is not finite`) | `{ kind: 'evaluate', message }` (no column — it is a runtime fact, not a text position) |

- An expression in **any** error class produces **no value**. What that means
  for the thing holding the expression — whether it shows `—`, whether
  dependents cascade, whether the run is affected — is defined by the consumer
  spec, **not here**. For `loop-model/1` Registers: `invalid`, cascading, and
  **non-fatal to the simulation** (`loop-model/1` §M6).
- Diagnostic **messages are stable strings** (part of the spec's compatibility
  surface, like `loop-state/1`'s). The message set is enumerated at freeze
  (§X10-5).
- `column` is 1-based over the raw expression text.

---

## X8. Canonical text form (for `loop-revision/2`)

An expression is stored and digested as **text**, exactly as written, with one
normalisation:

- **outer** whitespace is trimmed;
- **inner** whitespace is preserved **verbatim** — `@a+@b` and `@a + @b` are
  different bytes and therefore different revision content (consistent with
  `SEMANTICS-R.md` §R4: strings are compared as exact UTF-8 bytes). An editor
  MAY offer a one-click "format" that rewrites to a canonical spacing, but the
  spec never rewrites silently.
- references are always in `@id` form (never a label), so a rename does not
  change the bytes.
- there is **no** AST-level canonicalisation (no constant folding, no
  reassociation, no dropping of redundant parentheses).

`loop-revision/2` (`SEMANTICS-M.md` §M8) adds the field that holds this text to
the canonical projection.

---

## X9. Compatibility with `loop-state/1` / `/2`

- `loop-expr/1` **does not replace** the state-edge expression grammar.
  `stateExpr.ts`'s `activator` / `label` / `delay` expressions keep their
  **exact current grammar and diagnostic strings**; `loop-state/1` and
  `loop-state/2` are untouched.
- Implementations MAY share a tokenizer / parser core between the two — that is
  an internal detail, invisible at the spec level. A shared core must not
  change any `loop-state` observable (grammar accepted, values produced,
  message text).
- Extending `loop-expr/1` to **Gate conditions / Source amounts / Converter
  ratios** is explicitly **out of scope** for `loop-expr/1` and requires its
  own slice **and** a spec amendment (a `loop-expr/1` §X-future section or a new
  `loop-state/3` / `loop-engine-expr/1`), because it changes how the engine
  computes a step.

---

## X-INV. Invariants

| # | Invariant |
|---|---|
| **X-INV-1** | Every valid expression evaluates to a **finite** `float64` or raises one of the three §X7 errors — never `NaN`, never `±Infinity`, never a silent stand-in. |
| **X-INV-2** | `eval` is pure and deterministic: same AST + same resolved inputs ⇒ bit-identical result on every platform and every replay. |
| **X-INV-3** | A reference is a stable node id (`@id`); renaming the target's label changes **no** bytes of any expression and **no** revision digest. |
| **X-INV-4** | The canonical text form is the user's text with only outer-whitespace trimmed and references in `@id` form; there is no AST-level rewrite, so a round-trip through save/load is byte-stable. |
| **X-INV-5** | `loop-state/1` / `/2` observable behaviour (grammar accepted, values, diagnostics) is unchanged by the existence of `loop-expr/1`. |
| **X-INV-6** | The conditional short-circuits; the untaken branch cannot cause an evaluate error. All other operands (incl. every `min`/`max`/`clamp` argument) are always evaluated, left-to-right. |
| **X-INV-7** | The function set is exactly `{ abs, round, min, max, clamp }` with the arities in §X2.1; any other name is a parse error. |

---

## X10. Open decisions — settle before freeze

1. **Reference token** — `@id` (chosen here) vs `${id}` / `{id}` / a structured
   non-inline ref list. `@id` reads cleanly and the `id` charset already
   excludes `@`; confirm no collision with any planned syntax.
2. **`&&` / `||`** — reserved in the grammar, not defined. Add now (with
   short-circuit + `0`/non-`0` truthiness) or defer to a `loop-expr/1.1`
   amendment? Lumi's initial list did not include them; the ternary covers the
   given examples. **Leaning: defer.**
3. **Function set** — is `{ abs, round, min, max, clamp }` enough for v0.6.0, or
   do Registers realistically need `floor` / `ceil` / `%` / `sqrt`? Adding is
   cheap; each needs its own non-finite rule. **Leaning: ship the five, add on
   demand via amendment.**
4. **`round` tie rule** — half-away-from-zero (chosen) vs half-to-even. Away
   ‑from-zero matches most spreadsheet intuition; even reduces bias in
   aggregates. Registers are mostly single readouts, so intuition wins.
   **Leaning: away-from-zero, as written.**
5. **Diagnostic message catalogue** — enumerate the exact strings for every
   parse / resolve / evaluate error at freeze, so tooling and tests can pin
   them (as `loop-state/1` did).
6. **`clamp(lo > hi)`** — return `lo` (chosen) vs raise. Returning `lo` keeps
   the run going; confirm this is the desired failure mode.
7. **Number literal range** — reject `> Number.MAX_VALUE` at parse (chosen) vs
   allow and fail at evaluate. Parse-time is friendlier.
