import { describe, expect, it } from 'vitest'
import BOXES from './layout/templateBoxes.json'
import { TEMPLATES } from './templates'

// issue #344 (docs/diagram-layout.md §DL5.6) — the MMO opening view's `keep`
// rect holds the core start nodes at their widest box over the 18 languages
// (`layout/templateBoxes.json`), so a wider translation or a moved node cannot
// silently fall outside it.

const CORE = ['char_creation', 'active_char', 'z1_enc_src', 'z1_enc']

describe('MMO initialView keep', () => {
  const tpl = TEMPLATES.find((t) => t.id === 'mmo-progression')!
  const keep = tpl.initialView!.keep!
  const boxes = BOXES['mmo-progression'] as Record<string, number[]>

  it.each(CORE)('%s is inside keep at its widest box', (id) => {
    const n = tpl.graph.nodes.find((m) => m.id === id)!
    const [w, h] = boxes[id]!
    expect(n.position.x).toBeGreaterThanOrEqual(keep.x)
    expect(n.position.y).toBeGreaterThanOrEqual(keep.y)
    expect(n.position.x + w!).toBeLessThanOrEqual(keep.x + keep.width)
    expect(n.position.y + h!).toBeLessThanOrEqual(keep.y + keep.height)
  })

  it('keep is the tight union of the core boxes (no slack that would lower the zoom)', () => {
    const b = CORE.map((id) => {
      const n = tpl.graph.nodes.find((m) => m.id === id)!
      const [w, h] = boxes[id]!
      return { l: n.position.x, t: n.position.y, r: n.position.x + w!, b: n.position.y + h! }
    })
    expect({ x: keep.x, y: keep.y, right: keep.x + keep.width, bottom: keep.y + keep.height }).toEqual({
      x: Math.min(...b.map((v) => v.l)),
      y: Math.min(...b.map((v) => v.t)),
      right: Math.max(...b.map((v) => v.r)),
      bottom: Math.max(...b.map((v) => v.b)),
    })
  })
})
