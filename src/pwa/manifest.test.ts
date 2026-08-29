import { describe, expect, it } from 'vitest'
import { PWA_BACKGROUND, manifest } from './manifest'

// docs/pwa.md §P1 / §P9 D1 — the manifest object Slice 2's vite-plugin-pwa
// consumes. The icon *files* (existence, PNG size, plain-vs-maskable byte
// difference) are checked by `scripts/check-icons.mjs` in the `checks` job.

describe('web app manifest', () => {
  it('id, start_url and scope are all the origin root "/"', () => {
    expect(manifest.id).toBe('/')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
  })

  it('is a standalone app with names and a description', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toBe('Loop Studio')
    expect(manifest.short_name).toBe('Loop Studio')
    expect(manifest.description.length).toBeGreaterThan(10)
  })

  it('background and theme colours are the app ground token', () => {
    expect(manifest.background_color).toBe('#f0efea')
    expect(manifest.theme_color).toBe('#f0efea')
    expect(PWA_BACKGROUND).toBe('#f0efea')
  })

  it('has plain 192 + 512 "any" icons and one "maskable" icon', () => {
    const any = manifest.icons.filter((i) => i.purpose === 'any')
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable')
    expect(any.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512'])
    expect(maskable).toHaveLength(1)
    expect(maskable[0].sizes).toBe('512x512')
    for (const i of manifest.icons) expect(i.type).toBe('image/png')
  })

  it('the maskable icon is a DIFFERENT file from the plain 512 (not just a purpose flag)', () => {
    const plain512 = manifest.icons.find((i) => i.purpose === 'any' && i.sizes === '512x512')!
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable')!
    expect(maskable.src).not.toBe(plain512.src)
    expect(maskable.src).toMatch(/maskable/)
  })

  it('every icon src is a relative path under icons/', () => {
    for (const i of manifest.icons) {
      expect(i.src.startsWith('icons/')).toBe(true)
      expect(i.src.startsWith('/')).toBe(false) // relative — resolves against the manifest URL
    }
  })
})
