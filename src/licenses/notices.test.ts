import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadNotices, noticesFileUrl, noticesHaveFile, resetNoticesForTest } from './notices'

// Issue #301 — where each build keeps its notices, and how the licence view
// reads them, against stand-ins for the page (the unit tests run in Node; the
// real pages are covered in e2e: dev, production bundle, PWA offline, portable).

const TEXT = 'Loop Studio\nCopyright © 2026 Hanrim. All rights reserved.\n\nThird-party open-source licenses\n'

class FakeTemplate {
  content: { textContent: string | null }
  constructor(text: string | null) {
    this.content = { textContent: text }
  }
}

function page({ portable, template }: { portable: boolean; template?: unknown }) {
  vi.stubGlobal('HTMLTemplateElement', FakeTemplate)
  vi.stubGlobal('document', {
    baseURI: 'https://example.test/app/index.html',
    documentElement: { getAttribute: (n: string) => (n === 'data-build' && portable ? 'portable' : null) },
    getElementById: (id: string) => (id === 'third-party-notices' ? (template ?? null) : null),
  })
}
const response = (body: string, { status = 200, type = 'text/plain; charset=utf-8' } = {}) =>
  new Response(body, { status, headers: { 'content-type': type } })

beforeEach(() => resetNoticesForTest())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('web, PWA and dev: the same-origin file', () => {
  it('is fetched next to the page and read as text', async () => {
    page({ portable: false })
    const fetchMock = vi.fn(async () => response(TEXT))
    vi.stubGlobal('fetch', fetchMock)
    expect(noticesHaveFile()).toBe(true)
    expect(noticesFileUrl()).toBe('https://example.test/app/THIRD_PARTY_NOTICES.txt')
    await expect(loadNotices()).resolves.toBe(TEXT)
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/app/THIRD_PARTY_NOTICES.txt')
  })
  it('is read once per page: a second call shares the first read', async () => {
    page({ portable: false })
    const fetchMock = vi.fn(async () => response(TEXT))
    vi.stubGlobal('fetch', fetchMock)
    await loadNotices()
    await loadNotices()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['a 404', response('not found', { status: 404 }), /answered 404/],
    ['the host’s index.html fallback', response('<!doctype html><html></html>', { type: 'text/html' }), /not plain text/],
    ['plain text that is not the notices', response('hello\n'), /does not hold the notices/],
  ])('%s is not the notices', async (_name, res, re) => {
    page({ portable: false })
    vi.stubGlobal('fetch', vi.fn(async () => res))
    await expect(loadNotices()).rejects.toThrow(re)
  })
  it('a failed read is not remembered: trying again reads again', async () => {
    page({ portable: false })
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response(TEXT))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadNotices()).rejects.toThrow('offline')
    await expect(loadNotices()).resolves.toBe(TEXT)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('portable: the template in the file itself', () => {
  it('reads template.content.textContent and fetches nothing', async () => {
    page({ portable: true, template: new FakeTemplate(TEXT) })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(noticesHaveFile()).toBe(false)
    await expect(loadNotices()).resolves.toBe(TEXT)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    ['no template', undefined, /no <template/],
    ['an element that is not a template', { content: { textContent: TEXT } }, /no <template/],
    ['a template without the notices', new FakeTemplate(''), /does not hold/],
  ])('%s is reported, not shown', async (_name, template, re) => {
    page({ portable: true, template })
    await expect(loadNotices()).rejects.toThrow(re)
  })
})
