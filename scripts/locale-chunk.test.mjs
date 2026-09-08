import { describe, expect, it } from 'vitest'
import { LOCALE_CHUNK_RE } from './locale-chunk.mjs'

// The pattern is shared by the Workbox runtimeCaching rule and the
// precache-closure check — pin it so the two can never drift, and so a future
// BCP-47 code with a script subtag (zh-Hans / zh-Hant) still routes.
describe('LOCALE_CHUNK_RE', () => {
  const matches = [
    'assets/locale-en-abc123.js',
    'assets/locale-ko-abc123.js',
    'assets/locale-ja-abc123.js',
    'assets/locale-zh-Hans-abc123.js',
    'assets/tmpl-labels-zh-Hant-abc123.js',
    'assets/tmpl-labels-ko-a_b-c.js',
    'https://cozy-loop-studio.pages.dev/assets/locale-ja-DEADBEEF.js',
  ]
  const nonMatches = [
    'assets/index-abc123.js',
    'assets/mc.worker-abc123.js',
    'assets/register-sw-abc.js',
    'assets/index-abc123.css',
    'assets/locale-.js',
    'assets/locale-ko.js',
    'assets/locale-ko-abc123.js.map',
    'assets/localise-ko-abc.js',
  ]

  it.each(matches)('matches %s', (u) => {
    expect(LOCALE_CHUNK_RE.test(u)).toBe(true)
  })
  it.each(nonMatches)('does not match %s', (u) => {
    expect(LOCALE_CHUNK_RE.test(u)).toBe(false)
  })
})
