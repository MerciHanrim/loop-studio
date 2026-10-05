import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  checkEntries,
  copyrightLines,
  diffSection,
  escapeHtml,
  findPackageDir,
  injectPortableTemplate,
  judgeLicence,
  LOCAL_PATH,
  manifestSection,
  normaliseText,
  noticesFromManifest,
  packageDirOf,
  parseSpdx,
  portableTemplate,
  readPackage,
  readPortableTemplate,
  renderNotices,
  sha256,
  unescapeHtml,
} from './third-party-notices/core.mjs'

// Issue #301 — the third-party notices, on made-up packages. Each rule the
// build enforces has a case that must fail.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpn-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const MIT = 'MIT License\n\nCopyright (c) 2020 Some Author\n\nPermission is hereby granted, free of charge...\n'
function pkg(name, files, json = {}) {
  const dir = path.join(tmp, 'node_modules', ...name.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...json }))
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t)
  return dir
}
const entry = (over = {}) => ({ name: 'a', version: '1.0.0', spdx: 'MIT', source: 'bundled code', licenceFiles: [{ file: 'LICENSE', sha256: sha256(MIT), text: MIT }], noticeFiles: [], copyright: ['Copyright (c) 2020 Some Author'], ...over })

describe('SPDX', () => {
  it.each([['MIT'], ['(MIT)'], ['BSD-3-Clause']])('%s is one identifier', (e) => {
    expect(parseSpdx(e)?.ids.length).toBe(1)
  })
  it.each([[''], [null], ['UNKNOWN'], ['SEE LICENSE IN LICENSE.md'], ['UNLICENSED'], ['(MIT OR Apache-2.0) AND ISC']])('%s is not accepted', (e) => {
    expect(parseSpdx(e)).toBeNull()
  })
  it('one level of OR / AND is understood', () => {
    expect(parseSpdx('(MIT OR CC0-1.0)')).toEqual({ op: 'OR', ids: ['MIT', 'CC0-1.0'] })
    expect(parseSpdx('MIT AND ISC')).toEqual({ op: 'AND', ids: ['MIT', 'ISC'] })
  })
})

describe('which licences pass', () => {
  it.each([['MIT'], ['ISC'], ['BSD-3-Clause'], ['OFL-1.1']])('%s passes without a review', (id) => {
    expect(judgeLicence(entry({ spdx: id }))).toEqual([])
  })
  it('UNKNOWN or a missing licence fails', () => {
    expect(judgeLicence(entry({ spdx: 'UNKNOWN' })).join()).toMatch(/missing, UNKNOWN/)
    expect(judgeLicence(entry({ spdx: undefined })).join()).toMatch(/missing, UNKNOWN/)
  })
  it('Apache-2.0 passes only with a review entry - a new Apache package never passes by itself', () => {
    expect(judgeLicence(entry({ spdx: 'Apache-2.0' })).join()).toMatch(/allowed only for an entry the registry marks as reviewed/)
    expect(judgeLicence(entry({ spdx: 'Apache-2.0' }), { reviewed: true })).toEqual([])
  })
  it.each([['GPL-3.0-only'], ['LGPL-2.1-or-later'], ['AGPL-3.0'], ['CC-BY-NC-4.0']])('%s never passes, even reviewed', (id) => {
    expect(judgeLicence(entry({ spdx: id }), { reviewed: true }).join()).toMatch(/never allowed automatically/)
  })
  it('an OR expression needs a recorded choice, and the choice must be offered and allowed', () => {
    const e = entry({ spdx: '(MIT OR CC0-1.0)' })
    expect(judgeLicence(e).join()).toMatch(/records none/)
    expect(judgeLicence(e, { choice: 'ISC' }).join()).toMatch(/does not offer/)
    expect(judgeLicence(e, { choice: 'CC0-1.0' }).join()).toMatch(/not in the allow-list/)
    expect(judgeLicence(e, { choice: 'MIT' })).toEqual([])
  })
  it('an AND expression needs every part allowed', () => {
    expect(judgeLicence(entry({ spdx: 'MIT AND BSD-2-Clause' })).join()).toMatch(/BSD-2-Clause is not in the allow-list/)
    expect(judgeLicence(entry({ spdx: 'MIT AND ISC' }))).toEqual([])
  })
  it('BSD-2-Clause, 0BSD and other licences outside the list fail', () => {
    for (const id of ['BSD-2-Clause', '0BSD', 'MPL-2.0', 'Unlicense']) expect(judgeLicence(entry({ spdx: id })).length).toBe(1)
  })
})

describe('reading a package', () => {
  it('takes every licence file and NOTICE file, normalised, with copyright lines', () => {
    const dir = pkg('read-me', { LICENSE: MIT.replace(/\n/g, '\r\n'), NOTICE: 'Some notice\r\n' })
    const p = readPackage(dir)
    expect(p.licenceFiles.map((f) => f.file)).toEqual(['LICENSE'])
    expect(p.licenceFiles[0].text).toBe(MIT)
    expect(p.noticeFiles.map((f) => f.file)).toEqual(['NOTICE'])
    expect(p.copyright).toEqual(['Copyright (c) 2020 Some Author'])
  })
  it('a package without a licence file is reported, not skipped', () => {
    const p = readPackage(pkg('no-licence', {}))
    expect(checkEntries([{ ...p, source: 'x' }]).join()).toMatch(/no licence file/)
  })
  it('licence boilerplate is not taken for a copyright line', () => {
    const apache = 'Apache License\n\n"Licensor" shall mean the copyright owner\nCopyright [yyyy] [name of copyright owner]\n'
    expect(copyrightLines(apache)).toEqual([])
    expect(checkEntries([{ ...entry(), copyright: [] }]).join()).toMatch(/no copyright line/)
  })
  it('a registry entry still marked unresolved fails', () => {
    expect(checkEntries([entry({ provenance: 'unresolved' })]).join()).toMatch(/unresolved/)
  })
  it('the package of a module id is its innermost node_modules folder', () => {
    expect(packageDirOf('/r/node_modules/@xyflow/react/node_modules/zustand/esm/index.mjs')).toBe('/r/node_modules/@xyflow/react/node_modules/zustand')
    expect(packageDirOf('/r/node_modules/d3-color/src/color.js?x')).toBe('/r/node_modules/d3-color')
    expect(packageDirOf('/r/src/main.tsx')).toBeNull()
  })
})

describe('the manifest turns red on any change', () => {
  const base = [entry(), entry({ name: 'b' })]
  const text = renderNotices(base)
  const section = manifestSection(base, text)
  const again = (entries) => diffSection(section, manifestSection(entries, renderNotices(entries)))
  it('the same entries give no difference', () => {
    expect(again(base)).toEqual([])
  })
  it('a new package, a removed one, a new version', () => {
    expect(again([...base, entry({ name: 'c' })]).join()).toMatch(/\+ c@1\.0\.0 is shipped but not in the manifest/)
    expect(again([base[0]]).join()).toMatch(/- b@1\.0\.0 is in the manifest but not shipped/)
    expect(again([base[0], entry({ name: 'b', version: '1.0.1' })]).join()).toMatch(/b@1\.0\.1 is shipped .*|b@1\.0\.0 is in the manifest/)
  })
  it('a licence change, a licence text change, a NOTICE added', () => {
    expect(again([base[0], entry({ name: 'b', spdx: 'ISC' })]).join()).toMatch(/spdx "MIT" -> "ISC"/)
    const other = MIT + 'extra\n'
    expect(again([base[0], entry({ name: 'b', licenceFiles: [{ file: 'LICENSE', sha256: sha256(other), text: other }] })]).join()).toMatch(/licence files or their SHA-256 changed/)
    expect(again([base[0], entry({ name: 'b', noticeFiles: [{ file: 'NOTICE', sha256: sha256('n\n'), text: 'n\n' }] })]).join()).toMatch(/NOTICE files changed \(0 -> 1\)/)
  })
  it('no section at all fails', () => {
    expect(diffSection(undefined, section).join()).toMatch(/no section/)
  })
})

describe('the notices text', () => {
  it('is the same bytes whatever the input order, with LF only', () => {
    const a = renderNotices([entry({ name: 'z' }), entry({ name: 'a' })])
    const b = renderNotices([entry({ name: 'a' }), entry({ name: 'z' })])
    expect(a).toBe(b)
    expect(a.includes('\r')).toBe(false)
    expect(a.endsWith('\n') && !a.endsWith('\n\n')).toBe(true)
  })
  it('prints a shared licence text once and points to it after', () => {
    const t = renderNotices([entry({ name: 'a' }), entry({ name: 'b' })])
    expect(t.split('Permission is hereby granted').length - 1).toBe(1)
    expect(t).toMatch(/\(identical to a 1\.0\.0 LICENSE above\)/)
  })
  it('names Loop Studio as all-rights-reserved and never as open source', () => {
    const t = renderNotices([entry()])
    expect(t).toMatch(/Copyright © 2026 Hanrim\. All rights reserved\./)
    expect(t).toMatch(/Third-party open-source licenses/)
    expect(t).not.toMatch(/Loop Studio is open[- ]source/i)
  })
  it('survives the HTML <template> round trip of the portable build', () => {
    const t = renderNotices([entry({ copyright: ['Copyright <a@b.c> & co'] })])
    expect(unescapeHtml(escapeHtml(t))).toBe(t)
    expect(escapeHtml(t)).not.toMatch(/<a@b/)
  })
  it('normalising is idempotent', () => {
    expect(normaliseText(normaliseText('a\r\nb  \n\n'))).toBe('a\nb\n')
  })
  it('a component whose licence file also carries bundled licences says so, and each file says what it covers', () => {
    const e = entry({ licenceSummary: 'MIT + bundled third-party notices', licenceFiles: [{ file: 'LICENSE', sha256: sha256(MIT), text: MIT, covers: 'its own MIT license' }, { file: 'THIRD-PARTY-LICENSE', sha256: sha256('x\n'), text: 'x\n', covers: 'the code it bundles' }] })
    const t = renderNotices([e])
    expect(t).toMatch(/^License: MIT \+ bundled third-party notices$/m)
    expect(t).toMatch(/^--- THIRD-PARTY-LICENSE \(the code it bundles\) ---$/m)
    expect(manifestSection([e], t).entries[0]).toMatchObject({ spdx: 'MIT', licenceSummary: 'MIT + bundled third-party notices', licenceFiles: [{ file: 'LICENSE', covers: 'its own MIT license' }, { file: 'THIRD-PARTY-LICENSE', covers: 'the code it bundles' }] })
    expect(checkEntries([e])).toEqual([])
    // the summary must start from the judged SPDX licence, never replace it
    expect(checkEntries([{ ...e, licenceSummary: 'Apache-2.0 + more' }]).join()).toMatch(/must read 'MIT \+ \.\.\.'/)
    expect(checkEntries([{ ...e, licenceSummary: 'MIT' }]).join()).toMatch(/must read/)
    const section = manifestSection([e], t)
    expect(diffSection(section, manifestSection([{ ...e, licenceSummary: undefined }], renderNotices([{ ...e, licenceSummary: undefined }]))).join()).toMatch(/licenceSummary/)
  })
})

// The portable build carries the notices as text in an HTML <template>. The
// HTML tokenizer leaves its data state only at a '<', so text holding no '<'
// cannot close the template, open a <script> or add any element; the browser
// half of this proof (DOMParser and a real page) is in
// e2e/portable-file.spec.ts.
describe('the portable <template>', () => {
  const HOSTILE = [
    'MIT License',
    '</template><script>window.__pwned = 1</script>',
    '<img src=x onerror="window.__pwned = 2"><!-- a comment --><![CDATA[ x ]]>',
    '</body></html><template id="third-party-notices">a second one',
    '&lt;already escaped&gt; &amp; &copy; &#60;script&#62; &',
    "$& $' $` $1 $$",
    '',
  ].join('\n')
  const page = '<!doctype html><html><head></head><body><div id="root"></div><script>/* "</body>" inside a script */</script></body></html>'

  it('holds no raw < and exactly one </template>, whatever the licence text says', () => {
    const el = portableTemplate(HOSTILE)
    const inner = el.slice(el.indexOf('>') + 1, el.lastIndexOf('</template>'))
    expect(inner.includes('<')).toBe(false)
    expect(inner.includes('>')).toBe(false)
    expect(el.split('</template>').length - 1).toBe(1)
    expect(el.split('<').length - 1).toBe(2) // the opening and the closing tag, nothing else
    expect(/&(?!(amp|lt|gt);)/.test(inner)).toBe(false)
  })
  it('reads back the exact text', () => {
    const html = injectPortableTemplate(page, HOSTILE)
    expect(readPortableTemplate(html)).toBe(HOSTILE)
    expect(unescapeHtml(escapeHtml('&amp;lt;'))).toBe('&amp;lt;')
  })
  it('goes before the last </body>, keeps $-sequences literal and changes nothing else', () => {
    const html = injectPortableTemplate(page, HOSTILE)
    const at = page.lastIndexOf('</body>')
    expect(html.startsWith(page.slice(0, at))).toBe(true)
    expect(html.endsWith(`\n${page.slice(at)}`)).toBe(true)
    expect(html.slice(at, html.length - page.length + at - 1)).toBe(portableTemplate(HOSTILE))
  })
  it('refuses U+0000 and CR, which an HTML parser would drop or rewrite', () => {
    expect(() => portableTemplate('a\u0000b')).toThrow(/U\+0000/)
    expect(() => portableTemplate('a\rb')).toThrow(/U\+000D/)
  })
  it('refuses a page without </body> or with the template already in it', () => {
    expect(() => injectPortableTemplate('<html></html>', 'x')).toThrow(/no <\/body>/)
    expect(() => injectPortableTemplate(injectPortableTemplate(page, 'x'), 'x')).toThrow(/already/)
  })
  it('reading fails closed on a template that was not written by portableTemplate', () => {
    const wrap = (inner) => `<body><template id="third-party-notices">${inner}</template></body>`
    expect(() => readPortableTemplate('<body></body>')).toThrow(/found 0/)
    expect(() => readPortableTemplate(wrap('a') + wrap('b'))).toThrow(/found 2/)
    expect(() => readPortableTemplate(wrap('a <b>bold</b>'))).toThrow(/raw '<'/)
    expect(() => readPortableTemplate(wrap('&copy; 2020'))).toThrow(/'&'/)
    expect(() => readPortableTemplate(wrap('a &amp b'))).toThrow(/'&'/)
    expect(() => readPortableTemplate(wrap('a\rb'))).toThrow(/U\+0000 or CR/)
    expect(() => readPortableTemplate(wrap('a\u0000b'))).toThrow(/U\+0000 or CR/)
    expect(() => readPortableTemplate('<body><template id="third-party-notices">a')).toThrow(/not closed/)
  })
})

describe('the committed manifest', () => {
  const ROOT = path.resolve(import.meta.dirname, '..')
  const text = fs.readFileSync(path.join(ROOT, 'licenses', 'third-party-manifest.json'), 'utf8')
  const manifest = JSON.parse(text)
  const find = (build, name) => manifest.builds[build].entries.find((e) => e.name === name)

  it('holds no local absolute path', () => {
    expect(text.match(LOCAL_PATH)).toBeNull()
    expect(LOCAL_PATH.test('"D:\\work\\x"')).toBe(true)
    expect(LOCAL_PATH.test(' /Users/someone/x')).toBe(true)
    expect(LOCAL_PATH.test(' /home/runner/work')).toBe(true)
    expect(LOCAL_PATH.test('https://github.com/vitejs/vite')).toBe(false)
  })
  // the dev server serves this rebuild: it must be the build's text, byte for byte
  it.each([['web'], ['pwa'], ['portable']])('%s: the text rebuilt from the manifest and node_modules is the build text the manifest pins', (build) => {
    const text = noticesFromManifest(manifest.builds[build], ROOT)
    expect(sha256(text)).toBe(manifest.builds[build].noticesSha256)
  })
  it('the rebuild fails closed: another licence hash, a missing NOTICE, a version not installed, a changed copyright line', () => {
    const copy = () => JSON.parse(JSON.stringify(manifest.builds.web))
    const a = copy()
    a.entries.find((e) => e.name === 'react').licenceFiles[0].sha256 = '0'.repeat(64)
    expect(() => noticesFromManifest(a, ROOT)).toThrow(/react@.*LICENSE is not the text the manifest pins/)
    const b = copy()
    b.entries.find((e) => e.name === 'react').noticeFiles = [{ file: 'NOTICE', sha256: '1'.repeat(64) }]
    expect(() => noticesFromManifest(b, ROOT)).toThrow(/NOTICE files are not the ones/)
    const c = copy()
    c.entries.find((e) => e.name === 'classcat').version = '9.9.9'
    expect(() => noticesFromManifest(c, ROOT)).toThrow(/classcat@9\.9\.9: not installed/)
    const d = copy()
    d.entries.find((e) => e.name === 'classcat').copyright = ['Copyright (c) Someone Else']
    expect(() => noticesFromManifest(d, ROOT)).toThrow(/rebuilt notices .* are not the manifest's/)
  })
  it('finds the second, nested copy of a package by its version', () => {
    const v4 = findPackageDir(ROOT, 'zustand', '4.5.7')
    const v5 = findPackageDir(ROOT, 'zustand', '5.0.15')
    expect(v4 && v5 && v4 !== v5).toBe(true)
    expect(findPackageDir(ROOT, 'zustand', '0.0.1')).toBeNull()
  })
  it('pins the same notices bytes for the web and portable builds', () => {
    expect(manifest.builds.portable.noticesSha256).toBe(manifest.builds.web.noticesSha256)
  })
  it.each([['web'], ['pwa'], ['portable']])('%s: Vite is MIT + bundled third-party notices, Rolldown pins its own licence and THIRD-PARTY-LICENSE separately', (build) => {
    const vite = find(build, 'vite')
    expect(vite).toMatchObject({ spdx: 'MIT', licenceSummary: 'MIT + bundled third-party notices' })
    expect(vite.licenceFiles.map((f) => f.file)).toEqual(['LICENSE.md'])
    const rolldown = find(build, 'rolldown')
    expect(rolldown).toMatchObject({ spdx: 'MIT', licenceSummary: 'MIT + bundled third-party notices' })
    expect(rolldown.licenceFiles.map((f) => f.file)).toEqual(['LICENSE', 'THIRD-PARTY-LICENSE'])
    expect(rolldown.licenceFiles[0].sha256).not.toBe(rolldown.licenceFiles[1].sha256)
    for (const f of [...vite.licenceFiles, ...rolldown.licenceFiles]) expect(f.covers).toMatch(/\S/)
  })
})
