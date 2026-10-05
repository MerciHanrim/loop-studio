import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLicenceSource, readsTemplateContentText } from './licence-screen-rules.mjs'

// Issue #301 — the licence view shows the third-party notices as text. Each
// way of handing a string to the HTML parser has a case that must fail.

const ok = (src, name = 'a.tsx') => expect(checkLicenceSource(name, src)).toEqual([])
const bad = (src, re, name = 'a.tsx') => expect(checkLicenceSource(name, src).join('\n')).toMatch(re)

describe('the licence view and loader show the notices as text', () => {
  it('a text child, textContent and a template content read are fine', () => {
    ok('export const V = ({ text }: { text: string }) => <pre>{text}</pre>')
    ok('const t = document.getElementById("x") as HTMLTemplateElement; export const s = t.content.textContent', 'b.ts')
    ok('export function w(el: HTMLElement, s: string) { el.textContent = s }', 'b.ts')
  })
  it('dangerouslySetInnerHTML fails', () => {
    bad('export const V = ({ html }: { html: string }) => <pre dangerouslySetInnerHTML={{ __html: html }} />', /dangerouslySetInnerHTML/)
  })
  it.each([
    ['el.innerHTML = s', /\.innerHTML/],
    ['const x = el.innerHTML', /\.innerHTML/],
    ['el.outerHTML = s', /\.outerHTML/],
    ['el["innerHTML"] = s', /\['innerHTML'\]/],
    ['el.insertAdjacentHTML("beforeend", s)', /insertAdjacentHTML/],
    ['document.write(s)', /\.write/],
    ['document.createRange().createContextualFragment(s)', /createContextualFragment/],
    ['new DOMParser().parseFromString(s, "text/html")', /DOMParser parses HTML/],
    ['el.setHTMLUnsafe(s)', /setHTMLUnsafe/],
  ])('%s fails', (stmt, re) => {
    bad(`declare const el: any; declare const s: string; ${stmt}`, re, 'b.ts')
  })
  it('a write() that is not document.write is not an HTML sink', () => {
    ok('declare const stream: { write(s: string): void }; stream.write("x")', 'b.ts')
  })
  it('a file that does not parse is a problem, never clean', () => {
    bad('export const V = () => <pre>{text</pre>', /did not parse cleanly/)
  })
  it('the loader must read a template through .content.textContent', () => {
    expect(readsTemplateContentText('b.ts', 'declare const t: HTMLTemplateElement; t.content.textContent')).toBe(true)
    expect(readsTemplateContentText('b.ts', 'declare const t: HTMLTemplateElement; t.textContent')).toBe(false)
  })
  it('the real files pass', () => {
    const root = path.resolve(import.meta.dirname, '..')
    for (const rel of ['src/licenses/notices.ts', 'src/components/LicensesView.tsx', 'src/components/AboutDialog.tsx']) {
      expect(checkLicenceSource(rel, fs.readFileSync(path.join(root, rel), 'utf8'))).toEqual([])
    }
    expect(readsTemplateContentText('notices.ts', fs.readFileSync(path.join(root, 'src/licenses/notices.ts'), 'utf8'))).toBe(true)
  })
})
