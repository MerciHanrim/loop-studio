// Issue #301 — the ONE exception to "no cryptography library" in
// `check:share-crypto`: `@noble/hashes`, for a synchronous SHA-256 behind the
// workspace and revision digests. Protected share links stay Web Crypto only.
//
// Pure functions over facts the caller gathers (package.json, package-lock.json
// and the source texts), so the rule is tested on made-up inputs in
// `share-crypto-noble.test.mjs`. The exception holds only while ALL of this is
// true:
//
//   - package.json names `@noble/hashes` in `dependencies` as exactly `2.4.0`,
//     and no other package that looks like a cryptography library anywhere;
//   - package-lock.json has exactly one `@noble/*` package, `@noble/hashes` at
//     2.4.0, and it depends on nothing;
//   - exactly one source file imports from `@noble/`: `src/model/workspace.ts`,
//     with `import { sha256 } from '@noble/hashes/sha2.js'` (an alias is fine),
//     one name, no default or namespace import; no other product file, test,
//     end-to-end spec or script imports, re-exports or `import()`s any
//     `@noble/` path;
//   - `src/model/shareProtected.ts`, and every module it imports, directly or
//     through others, is neither `src/model/workspace.ts` nor
//     `src/model/revision.ts` (the two that expose a hash that is not Web
//     Crypto) and imports nothing from `@noble/`; and the module never names
//     one of their hash functions.
import ts from 'typescript'

export const NOBLE = '@noble/hashes'
export const NOBLE_VERSION = '2.4.0'
export const NOBLE_IMPORTER = 'src/model/workspace.ts'
export const NOBLE_SPECIFIER = '@noble/hashes/sha2.js'
export const NOBLE_NAME = 'sha256'
export const PROTECTED_MODULE = 'src/model/shareProtected.ts'
export const NON_WEBCRYPTO_HASH_MODULES = ['src/model/workspace.ts', 'src/model/revision.ts']
export const NON_WEBCRYPTO_HASH_NAMES = ['sha256Js', 'sha256Hex', 'digestOfCanonical', 'fullContentDigest', 'semanticDigest', 'nobleSha256']

export const CRYPTO_LIBRARY = /(^|[-_/@.])(crypto|cryptojs|argon2?|scrypt|bcrypt(js)?|sodium|libsodium|nacl|tweetnacl|forge|sjcl|noble|aes|pbkdf2?|hash-wasm|openpgp|jose|webcrypto)([-_/@.]|$)/i

const KIND = { ts: ts.ScriptKind.TS, mts: ts.ScriptKind.TS, cts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX }

/** package.json: the dependency fields, and the one allowed entry */
export function checkPackage(pkg) {
  const problems = []
  const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  for (const field of fields) {
    for (const [name, range] of Object.entries(pkg?.[field] ?? {})) {
      if (!CRYPTO_LIBRARY.test(name)) continue
      if (name === NOBLE && field === 'dependencies' && range === NOBLE_VERSION) continue
      if (name === NOBLE) problems.push(`package.json: '${NOBLE}' is allowed only in dependencies as exactly ${NOBLE_VERSION} (found ${field}: '${range}')`)
      else problems.push(`package.json: '${name}' looks like a cryptography library - protected links use Web Crypto only`)
    }
  }
  return problems
}

/** package-lock.json (lockfile v2/v3 `packages`): one @noble package, 2.4.0, no dependencies */
export function checkLock(lock) {
  const problems = []
  const packages = lock?.packages
  if (!packages || typeof packages !== 'object') return ['package-lock.json: no `packages` map - cannot verify the @noble/hashes exception']
  const noble = Object.keys(packages).filter((k) => /(^|\/)node_modules\/@noble\//.test(k))
  if (noble.length !== 1 || noble[0] !== 'node_modules/' + NOBLE) problems.push(`package-lock.json: expected exactly one @noble package, node_modules/${NOBLE} (found ${noble.length ? noble.join(', ') : 'none'})`)
  const entry = packages['node_modules/' + NOBLE]
  if (entry) {
    if (entry.version !== NOBLE_VERSION) problems.push(`package-lock.json: ${NOBLE} is ${entry.version}, not ${NOBLE_VERSION}`)
    for (const f of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (entry[f] && Object.keys(entry[f]).length) problems.push(`package-lock.json: ${NOBLE} has ${f} (${Object.keys(entry[f]).join(', ')}) - it must depend on nothing`)
    }
  }
  const root = packages['']?.dependencies?.[NOBLE]
  if (root !== undefined && root !== NOBLE_VERSION) problems.push(`package-lock.json: the root names ${NOBLE} as '${root}', not ${NOBLE_VERSION}`)
  return problems
}

/** every module specifier in a source text, with what it imports */
export function moduleReferences(rel, text) {
  const ext = rel.split('.').pop()
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, KIND[ext] ?? ts.ScriptKind.TS)
  if (sf.parseDiagnostics?.length) return { parsed: false, refs: [], identifiers: [] }
  const refs = []
  const identifiers = []
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const c = n.importClause
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : []
      refs.push({ kind: 'import', specifier: n.moduleSpecifier.text, line: line(n), defaultImport: Boolean(c?.name), namespaceImport: Boolean(c?.namedBindings && ts.isNamespaceImport(c.namedBindings)), named, sideEffectOnly: !c })
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      refs.push({ kind: 'export', specifier: n.moduleSpecifier.text, line: line(n) })
    } else if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      refs.push({ kind: 'dynamic', specifier: n.arguments[0].text, line: line(n) })
    } else if (ts.isImportTypeNode?.(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteralLike(n.argument.literal)) {
      refs.push({ kind: 'type', specifier: n.argument.literal.text, line: line(n) })
    }
    if (ts.isIdentifier(n)) identifiers.push({ text: n.text, line: line(n) })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { parsed: true, refs, identifiers }
}

/** resolve a relative specifier against `rel` to one of the known source paths */
function resolveRelative(rel, specifier, known) {
  if (!specifier.startsWith('.')) return null
  const dir = rel.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') dir.pop()
    else dir.push(part)
  }
  const base = dir.join('/')
  const stem = base.replace(/\.(js|mjs|cjs|jsx)$/, '')
  for (const c of [base, stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.js', stem + '.mjs', base + '/index.ts', base + '/index.tsx']) if (known.has(c)) return c
  return null
}

/**
 * `sources`: every source file the caller can see - product code, unit tests,
 * end-to-end specs and scripts - as `{ rel, text }` with `/`-separated paths.
 * Returns the problems; empty means the exception holds.
 */
export function checkNobleUse(sources) {
  const problems = []
  const parsed = new Map()
  for (const { rel, text } of sources) {
    const r = moduleReferences(rel, text)
    if (!r.parsed) problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
    parsed.set(rel, r)
  }

  let allowed = 0
  for (const [rel, r] of parsed) {
    for (const ref of r.refs) {
      if (!ref.specifier.startsWith('@noble/')) continue
      const ok =
        rel === NOBLE_IMPORTER &&
        ref.kind === 'import' &&
        ref.specifier === NOBLE_SPECIFIER &&
        !ref.defaultImport &&
        !ref.namespaceImport &&
        ref.named.length === 1 &&
        ref.named[0] === NOBLE_NAME
      if (ok) allowed++
      else if (rel !== NOBLE_IMPORTER) problems.push(`${rel}:${ref.line}  imports '${ref.specifier}' - only ${NOBLE_IMPORTER} may use ${NOBLE}`)
      else problems.push(`${rel}:${ref.line}  '${ref.specifier}' as ${ref.kind}${ref.named?.length ? ' {' + ref.named.join(', ') + '}' : ''} - only \`import { ${NOBLE_NAME} } from '${NOBLE_SPECIFIER}'\` is allowed`)
    }
  }
  if (allowed > 1) problems.push(`${NOBLE_IMPORTER}: ${NOBLE_SPECIFIER} is imported ${allowed} times - once`)

  // the protected module and everything it reaches
  if (!parsed.has(PROTECTED_MODULE)) problems.push(`${PROTECTED_MODULE}: not among the sources - cannot check what it reaches`)
  else {
    const known = new Set(parsed.keys())
    const seen = new Set([PROTECTED_MODULE])
    const queue = [[PROTECTED_MODULE, [PROTECTED_MODULE]]]
    while (queue.length) {
      const [rel, chain] = queue.shift()
      for (const ref of parsed.get(rel)?.refs ?? []) {
        if (ref.specifier.startsWith('@noble/')) problems.push(`${chain.join(' -> ')}: imports '${ref.specifier}' - protected links use Web Crypto only`)
        const next = resolveRelative(rel, ref.specifier, known)
        if (!next) continue
        if (NON_WEBCRYPTO_HASH_MODULES.includes(next)) problems.push(`${[...chain, next].join(' -> ')}: reaches a hash that is not Web Crypto - protected links use Web Crypto only`)
        if (!seen.has(next)) {
          seen.add(next)
          queue.push([next, [...chain, next]])
        }
      }
    }
    for (const id of parsed.get(PROTECTED_MODULE).identifiers) {
      if (NON_WEBCRYPTO_HASH_NAMES.includes(id.text)) problems.push(`${PROTECTED_MODULE}:${id.line}  names ${id.text} - protected links use Web Crypto only`)
    }
  }
  return problems
}
