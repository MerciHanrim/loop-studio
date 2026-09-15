# Expression grammar & evaluation

```
Spec ID: loop-expr/1
Status:  Frozen
```

**Frozen (2026-08-30, rev 4).** This document is the fixed target for the
implementation. A behavioural change after this is a new spec id in a new
document (`loop-expr/1.1` for the deferred function / comparison / conditional
layer — §X11 X-1 — or `loop-expr/2`), exactly as with
`loop-state/1 → loop-state/2`; this file only takes typo / clarifying-prose
fixes. §X11 records the settled decisions X-1…X-6.

Defines a **small, deterministic expression language** — its grammar, its
reference syntax, its numeric rules, its canonical form, and how it is
evaluated — and nothing else. Used by `loop-model/1` (Register expressions);
everything beyond the arithmetic core is a later amendment.

Layered under `loop-model/1`. Does **not** change how a diagram runs today:
`SEMANTICS.md`, `SEMANTICS-B1.md` / `-B2.md`, `SEMANTICS-S.md` / `-S2.md`
(`loop-state/1` / `/2`), `SEMANTICS-W.md`, `SEMANTICS-U.md`, `SEMANTICS-R.md`
are unaffected. §X11 records the decisions (each Decided or Deferred).

---

## X0. Scope

**In `loop-expr/1` (this rev):** finite number literals; `@id` references;
grouping `( )`; unary minus; binary `+ - * /`. A single-pass, side-effect-free,
deterministic evaluation. An **AST-canonical** text form for the
`loop-revision/2` digest. Enumerated parse / resolve / evaluate error codes.

**Deferred to `loop-expr/1.1` (sketch in §X11):** the function set
`{ abs, round, min, max, clamp }`; comparison operators; the `?:` conditional.

**Out (separate specs / later):** `&&` / `||`; `%` / `^` / `sqrt` / `floor` /
`ceil`; variables, assignment, statements, loops, user functions; strings,
arrays, objects, property access, method calls; randomness, time, I/O;
references to `source` / `drain` / `gate` / `converter` outputs; replacing the
`loop-state/1` / `/2` state-edge grammar (§X10).

---

## X1. Values

The only value type is a **finite IEEE-754 double** (`float64`). There is no
boolean type in this rev (comparisons and the conditional are deferred).

`NaN` and `±Infinity` are **never** valid values: an operation that would
produce one is an **evaluate error** (§X5, §X7), not a value.

---

## X2. Grammar

Fully closed. EBNF (`*` = zero-or-more, left-associative unless stated):

```
expr    = add
add     = mul ( ( "+" | "-" ) mul )*            ; left-assoc
mul     = unary ( ( "*" | "/" ) unary )*        ; left-assoc
unary   = "-" unary | primary                   ; prefix minus, right-assoc, may stack
primary = number | ref | "(" expr ")"

ref       = "@" ( safe-id | "{" braced-id "}" )     ; §X3
safe-id   = ALPHA (ALPHA | DIGIT)*                  ; matches SAFE_ID
braced-id = ( braced-char | "\\}" | "\\\\" )+       ; the escape form; §X3.1
braced-char = any char that is NOT "\" , "}" , or a Unicode control char (U+0000–U+001F, U+007F–U+009F)
ALPHA     = "A"…"Z" | "a"…"z" | "_"
DIGIT     = "0"…"9"

number  = DIGIT+ ( "." DIGIT+ )? ( ("e"|"E") ("+"|"-")? DIGIT+ )?
```

- **Operators:** binary `+ - * /` (left-assoc); unary `-` (prefix, right-assoc,
  stackable — `--@a` parses as `@a`). **No** unary `+`, `%`, `^`, `**`, `!`,
  comparison, `?:`, `&&`, `||`, function call, or any identifier other than an
  `@id` / `@{id}`.
- **Precedence**, lowest → highest: `+ -` < `* /` < unary `-` < grouping /
  `primary`.
- **Number literals:** ≥ 1 digit, then optionally `.` + ≥ 1 digit (**both sides
  required** — `.5` and `5.` are parse errors), then optionally an exponent
  `e`/`E` with an optional sign and ≥ 1 digit. Leading zeros allowed (`007` = 7).
  No hex / binary / octal, no digit separators, no `Infinity` / `NaN` keyword,
  no leading `+`. Parsed to `float64`; a literal whose value is not finite
  (e.g. `1e400`) is a **parse error** (`EXPR_NUMBER_RANGE`).
- **Whitespace** (space, tab, CR, LF) between tokens is allowed and ignored by
  the parser. It is **not** allowed inside a token: `@ a`, `1 . 5`, `1 e5` are
  parse errors.
- The **empty string** (or all-whitespace) is a parse error (`EXPR_EMPTY`).

There is exactly one way to parse any accepted string; the grammar is
unambiguous.

---

## X3. References — `@id` and the `@{id}` escape

A reference names a target by its **node id**, never a label. **Any id that is
valid in a GraphDoc today can be referenced** — `loop-expr/1` puts **no**
restriction on node ids and does not require the app to change its id minter.
`SAFE_ID` only decides which of the two written forms is *canonical*.

### X3.1 Two written forms; one meaning

`SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/`.

| form | used when | escape rules |
|---|---|---|
| **`@id`** — bare | the id matches `SAFE_ID` (e.g. `@pool_mtc00jt3_2`) | none |
| **`@{id}`** — braced | any other id — an imported / hand-authored graph whose ids contain `-`, `.`, a leading digit, spaces, non-ASCII, etc. | inside the braces, a literal `}` is written `\}` and a literal `\` is written `\\`; every other character stands for itself. An unescaped `}` ends the reference. A `\` **not** followed by `}` or `\` is `EXPR_BAD_ESCAPE`. A raw **Unicode control character** inside the braces is `EXPR_BAD_TOKEN`. |

Both forms denote the **same** target id: `@{pool_x}` ≡ `@pool_x`, and
`@{a-b.c}` denotes the id `a-b.c`. Decoding `@{…}` reverses the escapes
(`\}` → `}`, `\\` → `\`).

**Canonical form** (§X8): `@id` when the id matches `SAFE_ID`, otherwise
`@{` + the id with `\` → `\\` and `}` → `\}` + `}`. So every target has exactly
one canonical spelling, and `canonicalise` maps a bare `@{pool_x}` back to
`@pool_x`.

### X3.2 Ids that cannot be written at all

An id containing a **Unicode control character** (U+0000–U+001F, U+007F–U+009F)
**cannot** be expressed by either form. This is **not** an expression bug: it is
an **id-validity problem of the GraphDoc itself** (id validity is
`SEMANTICS.md` / the serializer's concern). `loop-model/1` surfaces it as
`REF_INVALID_ID` at the *node*, distinct from a parse error at the expression's
column (§X7). Any id **without** a control character is representable — `\` and
`}` are always escapable. The app's minter (`nextId(prefix)` →
`<prefix>_<base36>_<base36>`) and every committed example / template already
produce `SAFE_ID`s, so the common case never uses the escape.

### X3.3 Resolution, rename, errors

- **Resolution** — which kinds a reference may name and what it evaluates to is
  `loop-model/1`'s decision (§M3). This spec fixes only the *syntax*, the
  *stored form*, and the *error codes*.
- **`label` rename** — a reference holds an *id*, so renaming the target's
  `label` changes **no** bytes of the expression (X-INV-3).
- **`id` rename** — changing a node's **id** (not its `label`) changes the
  reference key. If an operation (an "assign id", a merge / import remap) does
  this, the **same operation MUST rewrite** every `@old` / `@{old}` to the new
  id, as a graph edit; absent that rewrite the references become `REF_UNKNOWN`.
  (The app's editor does not offer id-editing today; this fixes the rule for
  any tool that does.)
- **Editor display** — an editor MAY render a reference as the target's current
  label in a token and offer a picker; what it stores and digests is always the
  canonical `@id` / `@{id}` form.
- **Unknown vs deleted** — indistinguishable at resolve time: a deleted node's
  id is simply not in the graph. Both are `REF_UNKNOWN` (§X7). A node that
  exists but is of a disallowed kind is `REF_WRONG_KIND`.

---

## X4. Static (parse-time) checks

With no values yet: syntax per §X2; every number literal finite; no
whitespace-in-token; non-empty. A failure yields a **parse error** (§X7) with a
1-based `column` into the raw text and one of the enumerated codes. A
parse-failed expression has no AST and never resolves or evaluates.

---

## X5. Numeric rules

Evaluation is over `float64`. After **every** operation the result must be
**finite**; otherwise the whole expression is an **evaluate error** (§X7) — it
does **not** yield `Infinity` / `NaN` / a clamped stand-in.

- **`/` by zero** — `x / 0` for any `x` (including `0 / 0`) → `EVAL_DIV_ZERO`.
- **overflow** — a `+` / `-` / `*` result of magnitude `> Number.MAX_VALUE`
  (i.e. `±Infinity`) → `EVAL_NOT_FINITE`.
- **`NaN`** — cannot arise from finite inputs under this grammar except `0/0`
  (already `EVAL_DIV_ZERO`); any `NaN` observed anywhere → `EVAL_NOT_FINITE`.
- **inputs** (values returned for each `@id`) are **guaranteed finite** by
  `loop-model/1`. If a consumer ever returns a non-finite value for a reference,
  that is a **resolve error** at that reference (`REF_NOT_FINITE`), not an
  evaluate error.
- **`-0`** normalises to `0` before it can be observed (matches
  `SEMANTICS-R.md` §R4.1).
- results are **not** implicitly rounded or clamped.

---

## X6. Evaluation model

- **Pure & deterministic.** `eval(ast, resolve)` is a function of the AST and
  the finite numbers `resolve` returns per `@id`. Same AST + same resolved
  inputs ⇒ **bit-identical** result on every platform, run, reset, and replay.
- **Single pass, left-to-right, no language-level recursion or iteration.** The
  AST is walked once, depth-first, left-to-right; every operand is evaluated
  (there is no short-circuit in this rev — the conditional is deferred). The
  **first** evaluate error in left-to-right order is the one reported.
- The language cannot reference itself; any cross-expression cycle is the
  consumer's concern (`loop-model/1` §M3).

---

## X7. Errors

Three classes, checked in this order; the first hit is reported. Every code is a
**stable string** and part of the compatibility surface (X-INV-8).

| Class | Code | When |
|---|---|---|
| **parse** | `EXPR_EMPTY` | the text is empty or all-whitespace |
| | `EXPR_SYNTAX` | a general grammar violation (unexpected / missing token) — carries `column` |
| | `EXPR_UNCLOSED_PAREN` | a `(` with no matching `)` |
| | `EXPR_UNCLOSED_REF` | a `@{` with no matching unescaped `}` |
| | `EXPR_BAD_ESCAPE` | inside `@{…}`, a `\` not followed by `}` or `\` |
| | `EXPR_NUMBER_RANGE` | a numeric literal that parses to a non-finite `float64` |
| | `EXPR_BAD_TOKEN` | a stray character, whitespace inside a token (`@ a`, `1 . 5`), or a raw Unicode control char inside `@{…}` |
| **resolve** | `REF_UNKNOWN` | the reference names no node in the current graph (never existed **or** deleted — indistinguishable) |
| | `REF_WRONG_KIND` | the reference names a node that exists but is of a kind the consumer disallows |
| | `REF_INVALID_ID` | a node whose id contains a Unicode control character and therefore cannot be referenced by any syntax — a GraphDoc id-validity problem, reported at the **node** (§X3.2), not at an expression column |
| | `REF_NOT_FINITE` | the consumer returned a non-finite value for a resolvable reference (should not happen; defensive) |
| **evaluate** | `EVAL_DIV_ZERO` | division by zero |
| | `EVAL_NOT_FINITE` | any non-finite intermediate or final result |

- An expression in **any** error class produces **no value**. What the holder
  does about it — placeholder shown, dependents cascaded, run affected — is the
  consumer spec's call. For `loop-model/1` Registers: `invalid`, cascading,
  **non-fatal** to the simulation, shown as *value-absent + the code*
  (`loop-model/1` §M6, §M6.1).
- `parse` codes carry a 1-based `column`; `resolve` codes carry the offending
  `id`; `evaluate` codes carry neither (a runtime fact, not a text position).
- Human-readable messages accompany the codes; the **codes** are the pinned
  contract, the messages may be reworded.

---

## X8. Canonical form — for the `loop-revision/2` digest

An expression is stored and digested as a **canonical re-serialisation of its
AST**, not as the raw text the user typed. **Structurally-equal expressions have
byte-identical canonical text and therefore an identical `loop-revision/2`
digest** (X-INV-4). This mirrors how `SEMANTICS-R.md` §R4 treats *numbers* and
*arrays* (normalise, then hash) — an expression is a structured value, not an
opaque string like `label`.

**canonicalise(expr) =** parse → AST → pretty-print with these exact rules:

- **binary operator:** exactly one space on each side — `@a + @b`, `@a * @c`,
  `@a - @b`.
- **unary minus:** no space — `-@a`, `-(@a + @b)`, `--@a`.
- **grouping:** `(expr)` with **no** interior space. Parentheses are kept
  **iff** removing them would change the parse (precedence or left-assoc
  grouping): `@a + @b * @c` (none), `(@a + @b) * @c` (kept),
  `@a - (@b - @c)` (kept), `@a - @b - @c` (none), `-(@a * @b)` vs `-@a * @b`
  (kept where it matters).
- **number literals:** the shortest round-tripping decimal — exactly
  `String(Number(literal))` after `-0 → 0` (`SEMANTICS-R.md` §R4.1 / §R4.3):
  `007` → `7`, `1.50` → `1.5`, `2.0` → `2`, `1e3` → `1000`, `1e21` → `1e+21`.
- **references:** the canonical form per §X3.1 — `@id` when the target id
  matches `SAFE_ID`; otherwise `@{` + the id with `\` → `\\` and `}` → `\}` +
  `}`. A source `@{pool_x}` where `pool_x` is `SAFE_ID` canonicalises to
  `@pool_x`; so a reference to a given target has exactly one canonical
  spelling.

**Not** canonicalised (these change the AST, so they change the digest):
operand order (`@a + @b` ≠ `@b + @a` — no commutativity folding), constant
folding (`1 + 1` stays `1 + 1`), reassociation, distribution.

The editor stores the canonical form. On load it re-parses and re-canonicalises;
`canonicalise` is **idempotent** (`canonicalise(canonicalise(x)) ===
canonicalise(x)`). A user typing `@a+@b` has `@a + @b` saved and digested; a
whitespace or redundant-parenthesis or `1.0`-vs-`1` edit does **not** mint a new
revision.

`loop-revision/2` (`SEMANTICS-M.md` §M8) names the field that holds this text.

---

## X9. (reserved — the deferred function/comparison/conditional layer, §X11)

## X10. Compatibility with `loop-state/1` / `/2`

- `loop-expr/1` **does not replace** the state-edge expression grammar.
  `stateExpr.ts`'s `activator` / `label` / `delay` expressions keep their
  **exact current grammar and diagnostic strings**; `loop-state/1` / `/2` are
  untouched (X-INV-6).
- Implementations MAY share a tokenizer / parser core; that is invisible at the
  spec level and must change **no** `loop-state` observable.
- Extending `loop-expr/1` to **Gate conditions / Source amounts / Converter
  ratios** is **out of scope** and needs its own slice **and** a spec amendment
  — it changes how the engine computes a step.

---

## X-INV. Invariants

| # | Invariant |
|---|---|
| **X-INV-1** | Every accepted expression evaluates to a **finite** `float64` or raises exactly one §X7 error — never `NaN`, `±Infinity`, or a silent stand-in. |
| **X-INV-2** | `eval` is pure and deterministic: same AST + same resolved inputs ⇒ bit-identical result on every platform and replay. |
| **X-INV-3** | A reference is a stable node id (`@id`); renaming the target's label changes no expression bytes and no revision digest. |
| **X-INV-4** | The canonical form is a function of the **AST**: structurally-equal expressions have byte-identical canonical text and identical `loop-revision/2` digest; whitespace, redundant parentheses, and `1.0`-vs-`1` never change it. Operand order, constant folding, and reassociation **do** change it. |
| **X-INV-5** | `canonicalise` is idempotent; a save→load round-trip is byte-stable. |
| **X-INV-6** | `loop-state/1` / `/2` observable behaviour (grammar accepted, values, diagnostics) is unchanged by the existence of `loop-expr/1`. |
| **X-INV-7** | The operator set is exactly binary `+ - * /` and unary `-`; the only callable-free primaries are number literals, `@id`, and `( expr )`. Any other token is a parse error. |
| **X-INV-8** | The §X7 error **codes** are a fixed, enumerated contract; tooling and tests may pin them. |

---

## X11. Decisions

Every item is **Decided** (fixed by this spec) or **Deferred** (explicitly out
of `loop-expr/1`).

| # | Item | Resolution |
|---|---|---|
| **X-1** | Function / comparison / conditional layer | **Deferred — out of `loop-expr/1`.** `loop-expr/1` is arithmetic-only (§X2). A future `loop-expr/1.1` amendment adds `{ abs, round, min, max, clamp }` (pure numeric, per-arg evaluated, each with its own non-finite rule), the six comparisons (non-associative, `1`/`0`), and `c ? a : b` (short-circuiting, `0` = false). The sketch below is informative, not normative. |
| **X-2** | `round` tie rule | **Deferred** — part of the X-1 function layer. When it lands: half-away-from-zero (`round(2.5) = 3`, `round(-2.5) = -3`). |
| **X-3** | `&&` / `||` | **Deferred indefinitely — out of `loop-expr/1` and `1.1`.** Not reserved. A later amendment only if a real need appears; the conditional covers the known cases. |
| **X-4** | Diagnostic message catalogue | **Decided.** The §X7 **codes** are the frozen contract (X-INV-8). The exact human **strings** are non-normative implementation wording (may be reworded), as with `loop-state/1`. Appendix X-A gives the current strings for reference. |
| **X-5** | Exponent canonical form | **Decided: verbatim `String(Number(x))`** — `1e+21` keeps its `+`, matching `SEMANTICS-R.md` §R4.3 ("numbers as `String(n)`"). No special-casing. |
| **X-6** | `@id` charset vs existing node ids | **Decided (rev 4).** No restriction on node ids — any id valid in a GraphDoc today can be referenced. `SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/` only picks the canonical spelling: bare `@id` for a `SAFE_ID`, the `@{…}` escape (with `\}` / `\\`) for anything else (§X3.1). The only unrepresentable ids are those containing a Unicode control character — a GraphDoc id-validity problem (`REF_INVALID_ID`, §X3.2), not an expression error, and not something `loop-expr/1` or `loop-model/1` forces the id minter to prevent. |

### Appendix X-A — diagnostic strings (non-normative)

| code | string |
|---|---|
| `EXPR_EMPTY` | `the expression is empty` |
| `EXPR_SYNTAX` | `unexpected "<tok>" at column <n>` / `expected <what> at column <n>` |
| `EXPR_UNCLOSED_PAREN` | `"(" at column <n> is never closed` |
| `EXPR_UNCLOSED_REF` | `"@{" at column <n> is never closed` |
| `EXPR_BAD_ESCAPE` | `"\" at column <n> must be followed by "}" or "\"` |
| `EXPR_NUMBER_RANGE` | `the number at column <n> is too large` |
| `EXPR_BAD_TOKEN` | `stray "<char>" at column <n>` |
| `REF_UNKNOWN` | `no node with id "<id>"` |
| `REF_WRONG_KIND` | `"<id>" is a <kind>; only pools, parameters and registers can be referenced` |
| `REF_INVALID_ID` | `node "<id-ish>" has an invalid id (contains a control character) and cannot be referenced` |
| `REF_NOT_FINITE` | `"<id>" has no finite value` |
| `EVAL_DIV_ZERO` | `division by zero` |
| `EVAL_NOT_FINITE` | `the result is not a finite number` |
