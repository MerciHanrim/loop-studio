// #471 (the kinds contract, version boundary) — a model-semantics version is a
// point on one axis, and what a version enables is kept by every version after
// it. Product code therefore never asks `modelVersion === 2` (or `=== 1`,
// `!== 2`, or collapses the value with `=== 2 ? 2 : 1`): each of those reads a
// later document as v1. It asks a capability — `hasModelLayer()` in
// `src/model/modelVersion.ts` — which is a `>=`.
//
//   node scripts/check-model-version.mjs            (scans src/)
//   node scripts/check-model-version.mjs <dir>      (scans another tree — how the check itself is tested)
//
// THE RULE IS LEXICAL. In every `src/**/*.ts(x)` that is not a test or a fixture,
// outside comments, no line matches
//
//   modelVersion  ===|!==  1|2|3        or          === 2 ? 2 : 1
//
// A new version comparison that is genuinely about identity — the serializer
// mapping a version to its schema string — is written as a table lookup
// (`SCHEMA_BY_MODEL_VERSION`) and never trips this. The exceptions list below
// is deliberately empty: a site that needs one has a capability to name.
//
// What it CANNOT see: a comparison through an alias (`const v = modelVersion;
// v === 2`) or a `switch`. The unit test `src/model/modelVersion.test.ts` pins
// the behaviour the other way round — a version-3 document through the engine,
// the canonical projection and the envelope.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = process.argv[2] ?? join(ROOT, 'src')
const PATTERNS = [/modelVersion\s*[!=]==\s*[123]\b/, /===\s*2\s*\?\s*2\s*:\s*1\b/]

const offenders = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(p)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|fixture)\.tsx?$/.test(entry.name)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    let inBlock = false
    lines.forEach((line, i) => {
      let code = line
      if (inBlock) {
        const end = code.indexOf('*/')
        if (end < 0) return
        code = code.slice(end + 2)
        inBlock = false
      }
      code = code.replace(/\/\*.*?\*\//g, '')
      const start = code.indexOf('/*')
      if (start >= 0) {
        code = code.slice(0, start)
        inBlock = true
      }
      code = code.replace(/\/\/.*$/, '')
      if (PATTERNS.some((re) => re.test(code))) offenders.push(`${relative(ROOT, p).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
    })
  }
}
walk(SRC)

if (offenders.length) {
  console.error('check-model-version: a model-semantics version is compared for equality; ask a capability (hasModelLayer) instead:')
  for (const o of offenders) console.error(`  ${o}`)
  process.exit(1)
}
console.log('check-model-version: ok — no modelVersion equality check in src')
