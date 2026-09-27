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
  if (cachedAst == null) {
    cachedAst = ts.createSourceFile(REGISTRY, text(), ts.ScriptTarget.Latest, true)
  }
  return cachedAst
}

/** Every `const <name> = <initializer>` in the file, at any nesting depth.
 *  Collected by walking the AST, so a declaration inside a comment or a string
 *  simply does not exist. */
function declarations(name) {
  const out = []
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      out.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast())
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

/** Every shipped locale code, in source order. Throws unless the result is a
 *  non-empty, duplicate-free list that contains the base locale. */
export function shippedCodes() {
  const decl = theDeclaration('SHIPPED_LOCALES')
  const init = decl.initializer && unwrap(decl.initializer)
  if (!init) die('`SHIPPED_LOCALES` has no initializer')
  if (!ts.isArrayLiteralExpression(init)) {
    die(`\`SHIPPED_LOCALES\` is initialised with ${ts.SyntaxKind[init.kind]}, not an array literal`)
  }
  if (init.elements.length === 0) die('`SHIPPED_LOCALES` is an empty array')

  const codes = []
  init.elements.forEach((el, i) => {
    const e = unwrap(el)
    // Only a plain object literal is understood. A spread, a call or a
    // conditional would hide entries from this reader, so it refuses rather
    // than quietly returning fewer locales than the registry has.
    if (!ts.isObjectLiteralExpression(e)) {
      die(`\`SHIPPED_LOCALES[${i}]\` is ${ts.SyntaxKind[e.kind]}, not an object literal`)
    }
    const prop = e.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ((ts.isIdentifier(p.name) && p.name.text === 'code') ||
          (ts.isStringLiteral(p.name) && p.name.text === 'code')),
    )
    if (!prop) die(`\`SHIPPED_LOCALES[${i}]\` has no \`code\` property`)
    const value = unwrap(prop.initializer)
    if (!ts.isStringLiteral(value)) die(`\`SHIPPED_LOCALES[${i}].code\` is not a string literal`)
    codes.push(value.text)
  })

  if (codes.length === 0) die('`SHIPPED_LOCALES` parsed to ZERO codes')
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i)
  if (dupes.length) die(`duplicate locale code(s): ${[...new Set(dupes)].join(', ')}`)
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
