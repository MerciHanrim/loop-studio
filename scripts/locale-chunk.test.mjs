import { describe, expect, it } from 'vitest'
import { LOCALE_CHUNK_RE, localeChunkCacheWillUpdate } from './locale-chunk.mjs'

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

// issue #625 item 4 — the runtime cache's rule for a locale chunk response, as the
// service worker runs it (`generateSW` writes this function's text into sw.js).
const res = (status, type, body = '') => new Response(body, { status, headers: type ? { 'content-type': type } : {} })

describe('localeChunkCacheWillUpdate (#625 item 4)', () => {
  it('the host’s answer to a missing chunk — the HTML page with a 200 — is not kept', async () => {
    expect(await localeChunkCacheWillUpdate({ response: res(200, 'text/html; charset=utf-8', '<!doctype html><html lang="en">') })).toBeNull()
  })

  it('control: a chunk served as JavaScript is kept, as the host and Vite type it', async () => {
    for (const type of ['application/javascript', 'text/javascript; charset=utf-8', 'application/x-javascript', 'text/ecmascript']) {
      const r = res(200, type, 'export default {}')
      expect(await localeChunkCacheWillUpdate({ response: r }), type).toBe(r)
    }
  })

  it('nothing else is kept: another status, no content type, another type, no response', async () => {
    expect(await localeChunkCacheWillUpdate({ response: res(404, 'text/html') })).toBeNull()
    expect(await localeChunkCacheWillUpdate({ response: res(500, 'application/javascript') })).toBeNull()
    expect(await localeChunkCacheWillUpdate({ response: res(200, '') })).toBeNull()
    expect(await localeChunkCacheWillUpdate({ response: res(200, 'application/json') })).toBeNull()
    expect(await localeChunkCacheWillUpdate({ response: undefined })).toBeNull()
  })

  it('it refers to nothing outside its own body, so its text in sw.js runs as written', async () => {
    const text = localeChunkCacheWillUpdate.toString()
    expect(text).not.toMatch(/LOCALE_CHUNK_RE|import\(|require\(/)
    const rebuilt = new Function(`return (${text})`)()
    expect(await rebuilt({ response: res(200, 'text/html') })).toBeNull()
    const js = res(200, 'application/javascript')
    expect(await rebuilt({ response: js })).toBe(js)
  })
})
