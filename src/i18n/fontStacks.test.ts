// Issue #607 — the Japanese font stack names the platform's own Japanese UI fonts
// before 'Noto Sans JP'. A machine with Noto Sans JP installed in ONE weight (Bold
// alone, measured on the reporter's Windows machine with CDP
// `CSS.getPlatformFontsForNode`) drew every Japanese glyph in that face, at 400,
// 500 and 700 alike, because the stack named it right after IBM Plex Sans (which
// has no Japanese glyphs). Which font a browser takes depends on the machine, so
// this is a static check of the ORDER in the stylesheet, not a rendering test.
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

/** the families of `--font-sans` in the first rule whose selector is exactly `selector` */
function stack(selector: string): string[] {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  const body = css.slice(at, css.indexOf('}', at))
  const m = /--font-sans:\s*([^;]+);/.exec(body)
  if (!m) throw new Error(`no --font-sans in ${selector}`)
  return m[1]
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

describe('the Japanese font stack (#607)', () => {
  const ja = stack(':lang(ja)')

  it('IBM Plex Sans first, for the Latin letters and digits, and sans-serif last', () => {
    expect(ja[0]).toBe('IBM Plex Sans')
    expect(ja[ja.length - 1]).toBe('sans-serif')
  })

  it('names every platform Japanese UI font before Noto Sans JP', () => {
    const noto = ja.indexOf('Noto Sans JP')
    expect(noto, 'Noto Sans JP stays as the fallback').toBeGreaterThan(-1)
    for (const platform of ['Hiragino Sans', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo']) {
      const at = ja.indexOf(platform)
      expect(at, `${platform} is in the stack`).toBeGreaterThan(-1)
      expect(at, `${platform} before Noto Sans JP`).toBeLessThan(noto)
    }
  })

  it('names no Korean or Chinese family, whose shared Han glyphs have other stroke shapes', () => {
    expect(ja.filter((f) => /KR|Korean|Malgun|SC|TC|YaHei|JhengHei|PingFang/.test(f))).toEqual([])
  })
})

describe('the other stacks are not part of #607 and stay as they are', () => {
  it('the base stack (English, Korean and every other language)', () => {
    expect(stack(':root')).toEqual(['IBM Plex Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans KR', 'sans-serif'])
  })

  it('the two Chinese stacks', () => {
    expect(stack(':lang(zh-Hans)')).toEqual(['LS CJK Punct SC', 'IBM Plex Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Source Han Sans SC', 'Hiragino Sans GB', 'sans-serif'])
    expect(stack(':lang(zh-Hant)')).toEqual(['LS CJK Punct TC', 'IBM Plex Sans', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei UI', 'Microsoft JhengHei', 'Source Han Sans TC', 'PMingLiU', 'sans-serif'])
  })
})
