import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../model/templates'
import { openTemplate } from './index'
import { ko } from './ko'

// docs/template-label-overlay.md §TLO3 / §TLO6 / §TLO8 — the fresh-open overlay:
// a full deep clone of the canonical Template payload with the current locale's
// node-label overlay applied (label only), never touching TEMPLATES[i].

const tpl = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`no template ${id}`)
  return t
}

describe('openTemplate — deep clone', () => {
  it('shares no reference with the canonical (nodes / data / position / edges)', () => {
    const src = tpl('mmo-progression')
    const { graph } = openTemplate(src, 'en')

    expect(graph).not.toBe(src.graph)
    expect(graph.nodes).not.toBe(src.graph.nodes)
    expect(graph.edges).not.toBe(src.graph.edges)
    for (let i = 0; i < src.graph.nodes.length; i++) {
      expect(graph.nodes[i]).not.toBe(src.graph.nodes[i])
      expect(graph.nodes[i].data).not.toBe(src.graph.nodes[i].data)
      expect(graph.nodes[i].position).not.toBe(src.graph.nodes[i].position)
    }
    for (let i = 0; i < src.graph.edges.length; i++) {
      expect(graph.edges[i]).not.toBe(src.graph.edges[i])
      if (src.graph.edges[i].data) expect(graph.edges[i].data).not.toBe(src.graph.edges[i].data)
    }
  })

  it('clones recommendedRunConfig and its arrays', () => {
    const src = tpl('mmo-progression')
    const { recommendedRunConfig } = openTemplate(src, 'en')
    expect(recommendedRunConfig).toEqual(src.recommendedRunConfig)
    expect(recommendedRunConfig).not.toBe(src.recommendedRunConfig)
    if (src.recommendedRunConfig?.timelineSeries) {
      expect(recommendedRunConfig?.timelineSeries).not.toBe(src.recommendedRunConfig.timelineSeries)
    }
    if (src.recommendedRunConfig?.tracked) {
      expect(recommendedRunConfig?.tracked).not.toBe(src.recommendedRunConfig.tracked)
    }
  })

  it('a template with no recommendedRunConfig returns undefined', () => {
    expect(openTemplate(tpl('equilibrium'), 'en').recommendedRunConfig).toBeUndefined()
  })
})

describe('openTemplate — the label overlay', () => {
  it('en (base locale): every label equals the canonical', () => {
    const src = tpl('mmo-progression')
    const { graph } = openTemplate(src, 'en')
    for (let i = 0; i < src.graph.nodes.length; i++) {
      expect((graph.nodes[i].data as { label: string }).label).toBe(
        (src.graph.nodes[i].data as { label: string }).label,
      )
    }
  })

  it('ko: every mmo node label equals the ko dictionary value', () => {
    const src = tpl('mmo-progression')
    const { graph } = openTemplate(src, 'ko')
    const dict = ko['mmo-progression']
    for (const n of graph.nodes) {
      expect((n.data as { label: string }).label).toBe(dict[n.id])
    }
  })

  it('ko: only `label` changes — structure / expr / resourceType / position identical', () => {
    const src = tpl('mmo-progression')
    const en = openTemplate(src, 'en').graph
    const koG = openTemplate(src, 'ko').graph

    expect(koG.nodes.map((n) => n.id)).toEqual(en.nodes.map((n) => n.id))
    expect(koG.edges.map((e) => `${e.source}->${e.target}`)).toEqual(
      en.edges.map((e) => `${e.source}->${e.target}`),
    )
    for (let i = 0; i < en.nodes.length; i++) {
      const a = en.nodes[i]
      const b = koG.nodes[i]
      expect(b.position).toEqual(a.position)
      const { label: _al, ...aRest } = a.data as Record<string, unknown>
      const { label: _bl, ...bRest } = b.data as Record<string, unknown>
      expect(bRest).toEqual(aRest) // kind, expr, resourceType, unit, … all identical
    }
  })

  it('a template with no dictionary for the locale stays English (allow-listed 1 & 2)', () => {
    for (const id of ['equilibrium', 'deadlock']) {
      const src = tpl(id)
      const { graph } = openTemplate(src, 'ko')
      for (let i = 0; i < src.graph.nodes.length; i++) {
        expect((graph.nodes[i].data as { label: string }).label).toBe(
          (src.graph.nodes[i].data as { label: string }).label,
        )
      }
    }
  })
})

describe('openTemplate — model-semantics version (loop-model/2, §CR2.1a)', () => {
  it('coffee-roastery opens as v2; the v1 templates open as v1', () => {
    expect(openTemplate(tpl('coffee-roastery'), 'en').modelVersion).toBe(2)
    for (const id of ['equilibrium', 'deadlock', 'mmo-progression']) {
      expect(openTemplate(tpl(id), 'en').modelVersion).toBe(1)
    }
  })

  it('ko: every coffee node label equals the ko dictionary value; the five `@param` flows are untouched', () => {
    const src = tpl('coffee-roastery')
    const dict = ko['coffee-roastery']
    const { graph } = openTemplate(src, 'ko')
    for (const n of graph.nodes) expect((n.data as { label: string }).label).toBe(dict[n.id])
    // overlay is label-only — the parameter-reference flows stay English / stable
    const atFlows = graph.edges
      .filter((e) => String((e.data as { flow?: string }).flow ?? '').startsWith('@'))
      .map((e) => (e.data as { flow: string }).flow)
    expect(atFlows.sort()).toEqual([
      '@daily_customers',
      '@daily_roast_kg',
      '@dessert_prep',
      '@green_wholesale_kg',
      '@online_orders',
    ])
  })
})

describe('openTemplate — re-open isolation (§TLO6-INV-7)', () => {
  it('mutating a ko document does not leak into a later en / ko open', () => {
    const src = tpl('mmo-progression')
    const enBefore = openTemplate(src, 'en').graph.nodes.map((n) => (n.data as { label: string }).label)

    // open in ko, then mutate the returned document every way a doc can be
    const first = openTemplate(src, 'ko')
    ;(first.graph.nodes[0].data as { label: string }).label = 'edited'
    first.graph.nodes[0].position.x += 999
    ;(first.graph.nodes[0] as { selected?: boolean }).selected = true
    if (first.graph.edges[0]) {
      ;(first.graph.edges[0].data as Record<string, unknown>).flow = 'tampered'
      ;(first.graph.edges[0] as { selected?: boolean }).selected = true
    }
    first.graph.nodes.push({ ...first.graph.nodes[0], id: '__extra__' })

    // a fresh en open is the pristine English canonical
    const en = openTemplate(src, 'en').graph
    expect(en.nodes).toHaveLength(src.graph.nodes.length)
    expect(en.nodes.map((n) => (n.data as { label: string }).label)).toEqual(enBefore)
    expect(en.nodes.some((n) => (n as { selected?: boolean }).selected)).toBe(false)
    expect(en.nodes[0].position).toEqual(src.graph.nodes[0].position)

    // and a fresh ko open still yields the correct Korean
    const koAgain = openTemplate(src, 'ko').graph
    expect((koAgain.nodes[0].data as { label: string }).label).toBe(ko['mmo-progression'][koAgain.nodes[0].id])
    expect(koAgain.nodes.some((n) => (n as { selected?: boolean }).selected)).toBe(false)
  })
})
