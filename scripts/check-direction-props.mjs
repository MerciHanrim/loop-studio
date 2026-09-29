// docs/localization.md §L9.3 — the caller-supplied direction contract.
//
// Three components inside the ltr-pinned canvas render text they did not choose:
// NodeFrame, CanvasHintNote and FilterPanel's Row. Each takes a direction from
// its caller, and each has to keep three properties that a normal review will
// not notice going away:
//
//   REQUIRED     the prop is not optional. `dir?:` lets a caller forget.
//   NO DEFAULT   no `= 'ltr'` in the destructuring and no `??` fallback in the
//                render. A default answers on behalf of a caller who never
//                considered the question, which is exactly how a user's Arabic
//                label ends up pinned ltr.
//   EVERY CALLER every JSX call site passes it. TypeScript enforces this for a
//                required prop, but only while the prop stays required - and
//                the point of this check is the day someone makes it optional.
//
// The direction type is checked too: a contract that re-types 'ltr' | 'rtl'
// beside the registry's own LocaleDir drifts from it silently.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** component -> the direction props it must require */
const CONTRACTS = [
  { file: 'src/components/nodes/nodes.tsx', component: 'NodeFrame', props: ['titleDir', 'subDir'] },
  { file: 'src/components/HintNote.tsx', component: 'CanvasHintNote', props: ['dir'] },
  { file: 'src/components/FilterPanel.tsx', component: 'Row', props: ['labelDir'] },
]

const problems = []
const rows = []

const parse = (rel) => {
  const abs = path.join(ROOT, rel)
  const sf = ts.createSourceFile(rel, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (sf.parseDiagnostics?.length) problems.push(`${rel}: did not parse cleanly - refusing to report it as clean`)
  return sf
}

for (const c of CONTRACTS) {
  const sf = parse(c.file)
  const text = sf.getFullText()

  // the declaration
  let decl = null
  const findDecl = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === c.component) decl = n
    ts.forEachChild(n, findDecl)
  }
  findDecl(sf)
  if (!decl) {
    problems.push(`${c.file}: no function \`${c.component}\` - the contract names a component that is gone`)
    continue
  }
  const declText = decl.getText(sf)
  // a default can only appear in the parameter list; the body legitimately
  // contains `dir={dir}` and that is not a default
  const params = decl.parameters.map((p) => p.getText(sf)).join(' | ')

  for (const prop of c.props) {
    // REQUIRED: the prop must appear in a type position without `?`
    // Regex-matching optionality was the wrong instrument: `subDir` appears
    // twice - once as `subDir?: undefined`, the ABSENT arm of a pair, and once
    // as `subDir: ContentDir`, the present one. Whether a prop can be forgotten
    // is a question about the TYPE, so ask the AST.
    const sigs = []
    const collectSigs = (n) => {
      if (ts.isPropertySignature(n) && n.name && n.name.getText(sf) === prop) {
        sigs.push({ optional: Boolean(n.questionToken), type: n.type ? n.type.getText(sf).trim() : "" })
      }
      ts.forEachChild(n, collectSigs)
    }
    collectSigs(sf)
    const badOptional = sigs.filter((x) => x.optional && x.type !== 'undefined')
    const requiredArm = sigs.some((x) => !x.optional)
    // FALSIFIED: deleting `titleDir: CallerDir` from the props type but leaving
    // `titleDir` in the destructuring left this check silent - the destructuring
    // still mentions the name, so the `present` test below passed and there were
    // no signatures to call optional. TypeScript would object, but a checker
    // that only reports what tsc already reports is not carrying its own weight.
    if (sigs.length === 0) {
      problems.push(`${c.file}: \`${prop}\` has no type declaration on ${c.component} - nothing obliges a caller to pass it`)
    }
    if (badOptional.length) {
      problems.push(`${c.file}: \`${prop}\` is optional on ${c.component} (declared \`${prop}?: ${badOptional[0].type}\`) - a caller can forget it`)
    }
    if (sigs.length && !requiredArm) {
      problems.push(`${c.file}: \`${prop}\` has no required declaration on ${c.component}`)
    }
    const optional = badOptional.length > 0 || (sigs.length > 0 && !requiredArm)

    const present = new RegExp('\\b' + prop + '\\b').test(declText)
    if (!present) problems.push(`${c.file}: ${c.component} does not take \`${prop}\` at all`)

    // NO DEFAULT: neither a destructuring default nor a render-time fallback
    const destructuringDefault = new RegExp('\\b' + prop + '\\s*=\\s*[^,}\\n]').test(params)
    if (destructuringDefault) problems.push(`${c.file}: \`${prop}\` has a default in ${c.component} - it answers for a caller who did not`)
    const nullish = new RegExp('\\b' + prop + '\\s*\\?\\?').test(decl.getText(sf))
    if (nullish) problems.push(`${c.file}: \`${prop}\` has a \`??\` fallback in ${c.component}`)

    rows.push({ component: c.component, prop, required: !optional, present })
  }

  // EVERY CALLER, across the whole tree, resolved by tag name within the file
  // that declares it and the files that import it
  const callers = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/')
        const sf2 = rel === c.file ? sf : parse(rel)
        const visit = (n) => {
          const open = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxElement(n) ? n.openingElement : null
          if (open && open.tagName.getText(sf2) === c.component) {
            const names = open.attributes.properties
              .filter((a) => ts.isJsxAttribute(a))
              .map((a) => a.name.getText(sf2))
            callers.push({ rel, line: sf2.getLineAndCharacterOfPosition(n.getStart(sf2)).line + 1, names })
          }
          ts.forEachChild(n, visit)
        }
        visit(sf2)
      }
    }
  }
  walk(path.join(ROOT, 'src'))

  if (callers.length === 0) problems.push(`${c.file}: ${c.component} has no call sites at all - the reader is broken, not the source`)
  for (const call of callers) {
    for (const prop of c.props) {
      // subDir is required only where a subtitle is passed; the TYPE pairs them
      if (prop === 'subDir' && !call.names.includes('sub')) continue
      if (!call.names.includes(prop)) {
        problems.push(`${call.rel}:${call.line} <${c.component}> does not pass \`${prop}\``)
      }
    }
  }
  rows.push({ component: c.component, callers: callers.length })
}

// The shared type, not a re-typed pair - and the name has to come FROM the
// registry. FALSIFIED: the first version tested the file for the string
// `LocaleDir`, which a local `type LocaleDir = 'ltr' | 'rtl'` satisfies while
// being the exact drift the check exists to prevent. So the import is resolved
// as an import, and `ContentDir` has to name it.
{
  const rel = 'src/i18n/contentDirection.ts'
  const sf = parse(rel)
  let importsLocaleDir = false
  let contentDirText = null
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && /\.\/registry/.test(n.moduleSpecifier.getText(sf))) {
      const named = n.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) {
        for (const e of named.elements) if ((e.propertyName ?? e.name).getText(sf) === 'LocaleDir') importsLocaleDir = true
      }
    }
    if (ts.isTypeAliasDeclaration(n) && n.name.getText(sf) === 'ContentDir') contentDirText = n.type.getText(sf)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!importsLocaleDir) problems.push(`${rel}: LocaleDir is not imported from the registry - the direction type has drifted from it`)
  if (contentDirText == null) problems.push(`${rel}: no \`ContentDir\` type alias here`)
  else if (!/\bLocaleDir\b/.test(contentDirText)) problems.push(`${rel}: ContentDir no longer builds on the registry's LocaleDir (it is \`${contentDirText}\`)`)
}
for (const c of CONTRACTS) {
  const t = fs.readFileSync(path.join(ROOT, c.file), 'utf8')
  if (/:\s*'auto'\s*\|\s*'ltr'\s*\|\s*'rtl'/.test(t) || /'ltr'\s*\|\s*'rtl'\s*\|\s*'auto'/.test(t)) {
    problems.push(`${c.file}: a direction union is re-typed here instead of importing ContentDir`)
  }
}

console.log('check-direction-props')
for (const r of rows) {
  if (r.prop) console.log('  ' + r.component.padEnd(16) + r.prop.padEnd(10) + (r.required ? 'required' : 'OPTIONAL'))
  else console.log('  ' + r.component.padEnd(16) + 'callers'.padEnd(10) + r.callers)
}
console.log('  problems        :', problems.length)
for (const p of problems) console.log('     ' + p)
if (problems.length) process.exitCode = 1
else console.log('  every caller-supplied direction is required, has no default, and is passed everywhere')
