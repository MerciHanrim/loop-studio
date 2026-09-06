// docs/localization.md §L12 #1 — pure catalog + ICU validation, shared by
// `scripts/check-i18n.mjs` (CI) and the unit tests. Registry-agnostic: it takes
// the base catalog + one other catalog and returns every problem it finds.

import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser'

type Ast = MessageFormatElement[]
type ArgKind = 'slot' | 'number' | 'date' | 'time' | 'plural' | 'select' | 'selectordinal'
export type CatalogLike = Record<string, string>

/** Korean "write both particles" hedges — banned; restructure the sentence. */
const JOSA_ALTERNATION =
  /을\(를\)|를\(을\)|이\(가\)|가\(이\)|은\(는\)|는\(은\)|와\(과\)|과\(와\)|\(으\)로|으로\(로\)|로\(으로\)/

type Analysis = { args: Map<string, ArgKind>; hasTag: boolean; missingOther: string[] }

function analyze(ast: Ast, key: string, code: string, acc?: Analysis): Analysis {
  const a: Analysis = acc ?? { args: new Map(), hasTag: false, missingOther: [] }
  for (const node of ast) {
    switch (node.type) {
      case TYPE.argument:
        a.args.set(node.value, 'slot')
        break
      case TYPE.number:
        a.args.set(node.value, 'number')
        break
      case TYPE.date:
        a.args.set(node.value, 'date')
        break
      case TYPE.time:
        a.args.set(node.value, 'time')
        break
      case TYPE.select:
      case TYPE.plural: {
        const kind: ArgKind =
          node.type === TYPE.select
            ? 'select'
            : node.pluralType === 'ordinal'
              ? 'selectordinal'
              : 'plural'
        a.args.set(node.value, kind)
        const opts = node.options ?? {}
        if (!Object.prototype.hasOwnProperty.call(opts, 'other')) {
          a.missingOther.push(`${code}:${key} — {${node.value}, ${kind}} has no "other" arm`)
        }
        for (const opt of Object.values(opts)) analyze(opt.value ?? [], key, code, a)
        break
      }
      case TYPE.tag:
        a.hasTag = true
        break
      default:
        break
    }
  }
  return a
}

/** Every problem in `catalog` relative to `base`. Empty array ⇒ valid. */
export function validateCatalog(base: CatalogLike, code: string, catalog: CatalogLike): string[] {
  const problems: string[] = []
  const baseKeys = new Set(Object.keys(base))
  const keys = new Set(Object.keys(catalog))

  for (const k of baseKeys) if (!keys.has(k)) problems.push(`${code}: missing key "${k}"`)
  for (const k of keys) if (!baseKeys.has(k)) problems.push(`${code}: extra key "${k}"`)

  for (const [key, msg] of Object.entries(catalog)) {
    if (typeof msg !== 'string' || msg.length === 0) {
      problems.push(`${code}:${key} — empty translation`)
      continue
    }
    // A Korean dual-particle placeholder (`을(를)`, `이(가)`, `은(는)`, `와(과)`,
    // `(으)로`, …) means the sentence dodged josa selection instead of being
    // restructured — an ambiguous read in any catalog that contains Korean.
    // Rewrite so no particle follows a `{slot}` (docs/localization.md §L4.2).
    if (JOSA_ALTERNATION.test(msg)) {
      problems.push(
        `${code}:${key} — dual-particle placeholder ("${JOSA_ALTERNATION.exec(msg)?.[0]}"); ` +
          `restructure so no Korean particle follows a {slot}`,
      )
    }
    let ast: Ast
    try {
      ast = parse(msg)
    } catch (e) {
      problems.push(`${code}:${key} — ICU parse error: ${(e as Error).message}`)
      continue
    }
    const a = analyze(ast, key, code)
    if (a.hasTag) problems.push(`${code}:${key} — rich-text tag syntax not allowed`)
    problems.push(...a.missingOther)

    if (!baseKeys.has(key)) continue
    let bast: Ast
    try {
      bast = parse(base[key])
    } catch {
      continue // base itself is broken — reported when base is validated
    }
    const b = analyze(bast, key, code)
    const an = [...a.args.keys()].sort().join(',')
    const bn = [...b.args.keys()].sort().join(',')
    if (an !== bn) {
      problems.push(`${code}:${key} — argument names {${an}} ≠ base {${bn}}`)
      continue
    }
    for (const [name, kind] of a.args) {
      if (b.args.get(name) !== kind) {
        problems.push(`${code}:${key} — argument "${name}" is ${kind}, base has ${b.args.get(name)}`)
      }
    }
  }
  return problems
}
