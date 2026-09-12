import { describe, expect, it } from 'vitest'
import { BUNDLED_MODULES, cloneModuleDoc } from './modules'

// docs/bundled-module-label-localization.md — `cloneModuleDoc`'s optional
// `labelOverlay` is the one hook a KO/JA insert uses; kept pure here (no i18n
// import) so this file only ever tests plain data in / plain data out.

describe('cloneModuleDoc', () => {
  const block = BUNDLED_MODULES.find((m) => m.id === 'buffered-step')!

  it('with no overlay, every label is the canonical English one, unchanged', () => {
    const clone = cloneModuleDoc(block)
    for (const n of clone.nodes) {
      const canonical = block.doc.nodes.find((c) => c.id === n.id)!
      expect((n.data as { label?: string }).label).toBe((canonical.data as { label?: string }).label)
    }
  })

  it('an overlay relabels only the ids it names; everything else stays canonical English', () => {
    const clone = cloneModuleDoc(block, { supply: '공급원', inbox: '입고 대기' })
    const byId = new Map(clone.nodes.map((n) => [n.id, (n.data as { label?: string }).label]))
    expect(byId.get('supply')).toBe('공급원')
    expect(byId.get('inbox')).toBe('입고 대기')
    // an id the overlay doesn't mention keeps the authored English label
    const canonicalProcess = block.doc.nodes.find((n) => n.id === 'process')!
    expect(byId.get('process')).toBe((canonicalProcess.data as { label?: string }).label)
  })

  it('an overlay never touches a field other than `label`', () => {
    const clone = cloneModuleDoc(block, { supply: '공급원' })
    const n = clone.nodes.find((x) => x.id === 'supply')!
    const canonical = block.doc.nodes.find((x) => x.id === 'supply')!
    expect(n.data.kind).toBe(canonical.data.kind)
    expect((n.data as { activation?: unknown }).activation).toBe(
      (canonical.data as { activation?: unknown }).activation,
    )
    expect(n.position).toEqual(canonical.position)
  })

  it('the canonical BUNDLED_MODULES doc is never mutated by a clone + overlay', () => {
    cloneModuleDoc(block, { supply: '공급원' })
    const stillCanonical = block.doc.nodes.find((n) => n.id === 'supply')!
    expect((stillCanonical.data as { label?: string }).label).toBe('Supply')
  })

  it('an overlay key with no matching node id is silently ignored', () => {
    const clone = cloneModuleDoc(block, { 'no-such-id': 'x' })
    expect(clone.nodes.some((n) => (n.data as { label?: string }).label === 'x')).toBe(false)
  })
})
