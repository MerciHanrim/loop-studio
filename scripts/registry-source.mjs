// The one place a build-time checker reads `src/i18n/registry.ts`.
//
// WHY A MODULE AND NOT A REGEX PER CHECKER
//
// A checker cannot `import` the registry: it is TypeScript and it reads
// `import.meta.env.DEV`, so Node would need a transform and a Vite env that a
// plain `node scripts/*.mjs` does not have. So the checkers read the SOURCE.
// That is fine — as long as a read that finds nothing is an ERROR.
//
// It was not. `check-template-labels.mjs` had:
//
//     const shippedBlock = /SHIPPED_LOCALES[^[]*\[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
//     const NON_BASE = [...shippedBlock.matchAll(/code:\s*'([\w-]+)'/g)].map(...)
//
// The `?? ''` turns "the block moved" into an empty locale list, and the four
// `for (const locale of NON_BASE)` loops below it then iterate zero times and
// report success. Re-indenting the registry would have disabled the whole
// template-label check with CI green.
//
// WHY THE TYPESCRIPT PARSER AND NOT A HAND-ROLLED SCAN
//
// The first repair walked brackets and masked comments and strings by hand.
// That fixed two measured defects — a commented-out `code:` counted as a real
// locale, and a `[` inside a string value unbalancing the walk — and then ran
// straight into the next one: a REGEX LITERAL can contain `//`, `/*`, `[`, `]`
// and escaped delimiters, and telling a regex from a division needs the
// grammar. Each patch bought one case and left the class open; finishing the
// job means maintaining an incomplete TypeScript lexer.
//
// `typescript` is already a devDependency, so the real parser is free. Comments,
// strings, template literals, escapes, brackets and regexes are its problem now,
// and this file only asks structural questions.
//
// Every accessor is fail-closed: it throws rather than return a shape a caller
// could mistake for "nothing to check".

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const ROOT = resolve(import.meta.dirname, '..')
const REGISTRY = 'src/i18n/registry.ts'

export class RegistryParseError extends Error {}

const die = (msg) => {
  throw new RegistryParseError(`${REGISTRY}: ${msg}`)
}

let cachedText = null
let cachedAst = null

function text() {
  if (cachedText == null) {
    try {
      cachedText = readFileSync(resolve(ROOT, REGISTRY), 'utf8')
    } catch (e) {
      die(`could not be read (${e.code ?? e.message})`)
    }
  }
  if (cachedText.trim() === '') die('is empty')
  return cachedText
}

function ast() {
  if (cachedAst != null) return cachedAst
  const sf = ts.createSourceFile(REGISTRY, text(), ts.ScriptTarget.Latest, true)

  // `createSourceFile` does NOT throw on a syntax error — it RECOVERS and hands
  // back a tree built from what it could make of the text. MEASURED: a fixture
  // whose `]` was deleted parsed happily, and the failure only surfaced later,
  // as "there are no non-base locales". That is a fail-closed accident, not a
  // contract: the same recovery could equally well produce a tree that reads
  // fine and is wrong. `tsc -b` catching it afterwards is a different check at
  // a different time, and does not make THIS reader honest.
  const diags = sf.parseDiagnostics ?? []
  if (diags.length > 0) {
    const first = diags[0]
    const where =
      typeof first.start === 'number'
        ? (() => {
            const { line, character } = sf.getLineAndCharacterOfPosition(first.start)
            return ` at ${line + 1}:${character + 1}`
          })()
        : ''
    die(
      `is not syntactically valid (${diags.length} parse diagnostic${diags.length === 1 ? '' : 's'}); ` +
        `first: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}${where}`,
    )
  }

  cachedAst = sf
  return cachedAst
}

/** TOP-LEVEL `const <name> = <initializer>` declarations only.
 *
 *  Deliberately not a recursive walk. A local `const SHIPPED_LOCALES` inside
 *  some helper is a different binding, and counting it would let an unrelated
 *  function turn this reader's "exactly one declaration" check into a failure —
 *  or, worse, let it read the wrong array. */
function declarations(name) {
  const out = []
  for (const st of ast().statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) out.push(d)
    }
  }
  return out
}

/** Exactly one declaration of `name`, or throw. */
function theDeclaration(name) {
  const found = declarations(name)
  if (found.length === 0) die(`no \`${name}\` declaration found`)
  if (found.length > 1) die(`\`${name}\` is declared ${found.length} times`)
  return found[0]
}

/** Unwrap `x as const`, `x satisfies T` and a parenthesised initializer. */
function unwrap(node) {
  let n = node
  for (;;) {
    if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n)) {
      n = n.expression
      continue
    }
    return n
  }
}

/** `BASE_LOCALE`, or throw. */
export function baseLocale() {
  const decl = theDeclaration('BASE_LOCALE')
  const init = decl.initializer && unwrap(decl.initializer)
  if (!init || !ts.isStringLiteral(init)) die('`BASE_LOCALE` is not initialised with a string literal')
  if (!/^[a-zA-Z][\w-]*$/.test(init.text)) die(`\`BASE_LOCALE\` is not a locale code: ${JSON.stringify(init.text)}`)
  return init.text
}

/** Every `code:` string in an array of locale-entry object literals, in source
 *  order, refusing anything a static read cannot see through.
 *
 *  Extracted from `shippedCodes()` when `pseudoCodes()` was added rather than
 *  copied into it: two copies of this many refusals drift, and the one that
 *  drifts is the one nobody is looking at. `label` only shapes the messages. */
function codesFromEntryArray(init, label) {
  const codes = stringsFromEntryArray(init, label, 'code').map((v) => v.value)
  // duplicates are a defect for `code` specifically — a display name may
  // legitimately repeat across entries, so the check lives here, not in the
  // generic reader
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dupes.length) die(`duplicate locale code(s) in \`${label}\`: ${[...new Set(dupes)].join(', ')}`)
  return codes
}

/** Every value of `field` across an array of locale-entry object literals, with
 *  the same refusals as `codesFromEntryArray` — a spread, a computed key, a
 *  shorthand, a method or a non-literal value all make the read unsound, so it
 *  throws rather than reporting fewer entries than the registry has.
 *
 *  `required: false` allows an entry to omit the field (only `code` is universal);
 *  the entry is then skipped for that field rather than failing the whole read. */
function stringsFromEntryArray(init, label, field, required = true) {
  if (!ts.isArrayLiteralExpression(init)) {
    die(`\`${label}\` is ${ts.SyntaxKind[init.kind]}, not an array literal`)
  }
  if (init.elements.length === 0) die(`\`${label}\` is an empty array`)

  const out = []
  init.elements.forEach((el, i) => {
    const e = unwrap(el)
    // Only a plain object literal is understood. A spread, a call or a
    // conditional would hide entries from this reader, so it refuses rather
    // than quietly returning fewer locales than the registry has.
    if (!ts.isObjectLiteralExpression(e)) {
      die(`\`${label}[${i}]\` is ${ts.SyntaxKind[e.kind]}, not an object literal`)
    }
    // A spread ANYWHERE in the entry can supply or overwrite the field at
    // runtime, so a static read of the literal would be reporting something the
    // program does not do. `{ code: 'ko', ...x }` is the obvious case; `{ ...x }`
    // alone is the same problem with the evidence removed.
    const spread = e.properties.find((p) => ts.isSpreadAssignment(p))
    if (spread) die(`\`${label}[${i}]\` contains a spread, so its \`${field}\` is not statically known`)

    const named = e.properties.filter((p) => {
      const n = p.name
      if (!n) return false
      if (ts.isComputedPropertyName(n)) return false // `[k]: …` is not statically the field
      return (ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === field
    })
    if (named.length === 0) {
      if (!required) return // an optional field this entry simply does not set
      die(`\`${label}[${i}]\` has no \`${field}\` property`)
    }
    if (named.length > 1) die(`\`${label}[${i}]\` has ${named.length} \`${field}\` properties`)

    const prop = named[0]
    // shorthand (`{ code }`), a method (`code() {}`) or an accessor all hide
    // the value from a static read.
    if (!ts.isPropertyAssignment(prop)) {
      die(`\`${label}[${i}].${field}\` is ${ts.SyntaxKind[prop.kind]}, not a plain \`${field}: '…'\``)
    }
    const value = unwrap(prop.initializer)
    if (!ts.isStringLiteral(value)) die(`\`${label}[${i}].${field}\` is not a string literal`)
    out.push({ index: i, value: value.text })
  })

  if (out.length === 0) die(`\`${label}\` parsed to ZERO \`${field}\` values`)
  return out
}

/** Every shipped locale code, in source order. Throws unless the result is a
 *  non-empty, duplicate-free list that contains the base locale. */
export function shippedCodes() {
  const decl = theDeclaration('SHIPPED_LOCALES')
  const init = decl.initializer && unwrap(decl.initializer)
  if (!init) die('`SHIPPED_LOCALES` has no initializer')
  const codes = codesFromEntryArray(init, 'SHIPPED_LOCALES')
  const base = baseLocale()
  if (!codes.includes(base)) {
    die(`BASE_LOCALE \`${base}\` is not among the shipped codes (${codes.join(', ')})`)
  }
  return codes
}

/** The shipped codes except the base one. The relationship to `shippedCodes()`
 *  is asserted rather than assumed: exactly one code is removed. */
export function nonBaseCodes() {
  const all = shippedCodes()
  const base = baseLocale()
  const rest = all.filter((c) => c !== base)
  if (rest.length !== all.length - 1) {
    die(`removing the base locale \`${base}\` changed the count by ${all.length - rest.length}, not 1`)
  }
  if (rest.length === 0) die('there are no non-base locales, which cannot be right for this registry')
  return rest
}

/**
 * Every DEV-only pseudo-locale code, in source order — the codes that must be
 * byte-absent from every production artefact (§L5.4 / §L9.2).
 *
 * Derived from the source, never hand-listed: a checker with a hardcoded marker
 * list silently stops covering the newest pseudo-locale, which is exactly what
 * happened when `ar-XB` joined `en-XA` and only `en-XA` was in the list.
 *
 * It also asserts the TREE-SHAKE GATE itself. The codes are safe to ship only
 * because `devPseudoLocales()` returns early on `import.meta.env.DEV`, which the
 * bundler evaluates as statically false in production. If that guard is edited
 * away, the entries become unconditional and every downstream byte check would
 * go on passing against a bundle that now contains them — so its absence is a
 * hard failure here rather than a silent change of meaning.
 */
/** Every `return [ … ]` with at least one element, at any depth inside `node`,
 *  excluding the bodies of nested functions (their returns are not this one's). */
function returnsWithEntries(node) {
  const out = []
  const visit = (n) => {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isClassDeclaration(n)
    ) {
      return // a different function's return statements
    }
    if (ts.isReturnStatement(n) && n.expression) {
      const arg = unwrap(n.expression)
      if (ts.isArrayLiteralExpression(arg) && arg.elements.length > 0) out.push(n)
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return out
}

export function pseudoCodes() {
  const fns = ast().statements.filter(
    (st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === 'devPseudoLocales',
  )
  if (fns.length === 0) die('no `devPseudoLocales` function declaration found')
  if (fns.length > 1) die(`\`devPseudoLocales\` is declared ${fns.length} times`)
  const fn = fns[0]
  if (!fn.body) die('`devPseudoLocales` has no body')

  // The DEV gate: an `if` whose condition mentions `import.meta.env.DEV` and
  // whose branch returns an empty array literal.
  const gate = fn.body.statements.find((st) => {
    if (!ts.isIfStatement(st)) return false
    if (!/import\s*\.\s*meta\s*\.\s*env\s*\.\s*DEV/.test(st.expression.getText(ast()))) return false
    const then = ts.isBlock(st.thenStatement) ? st.thenStatement.statements[0] : st.thenStatement
    if (!then || !ts.isReturnStatement(then) || !then.expression) return false
    const arg = unwrap(then.expression)
    return ts.isArrayLiteralExpression(arg) && arg.elements.length === 0
  })
  if (!gate) {
    die(
      '`devPseudoLocales` has no `import.meta.env.DEV` guard returning `[]`, so the pseudo-locales ' +
        'are NOT tree-shaken out of production',
    )
  }

  // The entries: exactly one return of a non-empty array literal, found ANYWHERE
  // in the function.
  //
  // This walked only the body's TOP-LEVEL statements at first, and a fixture
  // caught it: `if (x) return [{ code: 'en-XA' }]` is nested one level down, so
  // the reader did not see it and would have reported just the last array — a
  // pseudo-locale that really can ship, invisible to every downstream check. It
  // does not descend into a nested function, whose `return` is not this one's.
  const withEntries = returnsWithEntries(fn.body)
  if (withEntries.length === 0) die('`devPseudoLocales` returns no pseudo-locale entries')
  if (withEntries.length > 1) {
    die(`\`devPseudoLocales\` has ${withEntries.length} returns carrying entries, so its list is not statically one array`)
  }

  const codes = codesFromEntryArray(unwrap(withEntries[0].expression), 'devPseudoLocales()')
  const shipped = shippedCodes()
  const clash = codes.filter((c) => shipped.includes(c))
  if (clash.length) die(`pseudo-locale code(s) also appear in SHIPPED_LOCALES: ${clash.join(', ')}`)
  return codes
}

/** The array literal `devPseudoLocales()` returns, for the readers below. */
function pseudoEntriesNode() {
  pseudoCodes() // runs every structural refusal, including the DEV-gate assertion
  const fn = ast().statements.find(
    (st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === 'devPseudoLocales',
  )
  // the SHARED walk, not a second copy of the filter — the copy that lived here
  // had the same top-level-only blind spot the fixture caught in `pseudoCodes()`
  const withEntries = returnsWithEntries(fn.body)
  return unwrap(withEntries[0].expression)
}

/**
 * Every string a production artefact must not contain because of a DEV-only
 * pseudo-locale: its `code` AND the names a user would SEE.
 *
 * Codes alone are not the agreed contract and are not enough. `ar-XB` could be
 * tree-shaken while the literal `Pseudo RTL (QA)` survived in a bundle — a
 * code-only check passes and a QA string still ships. So `englishName` and
 * `nativeName` are derived too, de-duplicated (both pseudo entries set them to
 * the same text) and sorted longest-first so a report names the most specific
 * marker it found.
 *
 * `displayNameKey` is deliberately NOT a marker: both pseudo entries reuse
 * `language.english`, which the real English locale needs, so checking it would
 * fail every build. Only values that belong to the pseudo entries alone qualify,
 * and that is asserted below rather than assumed.
 */
export function pseudoMarkers() {
  const node = pseudoEntriesNode()
  const label = 'devPseudoLocales()'
  const codes = pseudoCodes()
  const names = [
    ...stringsFromEntryArray(node, label, 'englishName', false).map((v) => v.value),
    ...stringsFromEntryArray(node, label, 'nativeName', false).map((v) => v.value),
  ]
  if (names.length === 0) die('`devPseudoLocales()` entries carry no `englishName` / `nativeName` to check')

  const markers = [...new Set([...codes, ...names])].sort((a, b) => b.length - a.length || a.localeCompare(b))

  // A marker must be unique to the pseudo entries. If a shipped locale uses the
  // same string, checking for it would fail every production build — which is a
  // broken checker, not a finding, so it is refused here.
  const shippedDecl = theDeclaration('SHIPPED_LOCALES')
  const shippedNode = unwrap(shippedDecl.initializer)
  const shippedStrings = new Set([
    ...codesFromEntryArray(shippedNode, 'SHIPPED_LOCALES'),
    ...stringsFromEntryArray(shippedNode, 'SHIPPED_LOCALES', 'englishName', false).map((v) => v.value),
    ...stringsFromEntryArray(shippedNode, 'SHIPPED_LOCALES', 'nativeName', false).map((v) => v.value),
  ])
  const shared = markers.filter((m) => shippedStrings.has(m))
  if (shared.length) {
    die(
      `pseudo-locale marker(s) are also used by a SHIPPED locale, so they cannot be checked for: ${shared.join(', ')}`,
    )
  }
  return markers
}

/** For tests: forget the cached source. */
export function __reset() {
  cachedText = null
  cachedAst = null
}

/** The whole parse, over TEXT rather than the file on disk.
 *
 *  Exported so the lexical cases can be tested with fixtures instead of by
 *  mutating the real registry: a test that has to edit `registry.ts` to make
 *  its point cannot run in parallel and cannot show a case the registry does
 *  not happen to contain. */
export function parsePseudoText(src) {
  const prevText = cachedText
  const prevAst = cachedAst
  cachedText = src
  cachedAst = null
  try {
    return { codes: pseudoCodes(), markers: pseudoMarkers() }
  } finally {
    cachedText = prevText
    cachedAst = prevAst
  }
}

export function parseRegistryText(src) {
  const prevText = cachedText
  const prevAst = cachedAst
  cachedText = src
  cachedAst = null
  try {
    return { baseLocale: baseLocale(), shipped: shippedCodes(), nonBase: nonBaseCodes() }
  } finally {
    cachedText = prevText
    cachedAst = prevAst
  }
}
