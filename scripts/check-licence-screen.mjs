// Issue #301 - the licence view shows the third-party notices as text.
//
//   node scripts/check-licence-screen.mjs
//
// The rule is in `licence-screen-rules.mjs`. The files are the loader and the
// view that touch the notices text; every one must exist (a renamed file is a
// failure, not a pass), parse cleanly, use no HTML sink, and the loader must
// read the portable template through `.content.textContent`.
import fs from 'node:fs'
import path from 'node:path'
import { checkLicenceSource, readsTemplateContentText } from './licence-screen-rules.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const FILES = ['src/licenses/notices.ts', 'src/components/LicensesView.tsx', 'src/components/AboutDialog.tsx']
const LOADER = 'src/licenses/notices.ts'

const problems = []
for (const rel of FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    problems.push(`${rel}: missing - the check covers it by name; update FILES if it moved`)
    continue
  }
  const text = fs.readFileSync(abs, 'utf8')
  problems.push(...checkLicenceSource(rel, text))
  if (rel === LOADER && !readsTemplateContentText(rel, text)) problems.push(`${rel}: the portable template is not read through .content.textContent`)
}
for (const p of problems) console.error(`  FAIL  ${p}`)
if (problems.length) {
  console.error('\n  The licence view must show the notices as text. See licenses/README.md.')
  process.exit(1)
}
console.log(`  ok    ${FILES.length} files show the third-party notices as text, and the loader reads the template's content`)
