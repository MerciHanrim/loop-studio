import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedFrame } from '../../model/serialize'

// docs/template-label-overlay.md §TLO12 — the group-frame TITLE overlay is an
// exact mirror of the node-label path (§TLO11): a fresh menu open seeds the
// active locale's titles, and a later language switch re-seeds an OFFICIAL frame
// title (exact `===` match) while leaving a user rename / `""` default / an
// ambiguous shared id alone. #4A ships this with no real template frames, so
// the logic is exercised here against a stubbed template + stub dictionaries.

const STUB_FRAMES: SavedFrame[] = [
  { id: 'zone_a', label: 'Zone A', rect: { x: 0, y: 0, w: 100, h: 60 } },
  { id: 'zone_b', label: 'Zone B', rect: { x: 120, y: 0, w: 100, h: 60 } },
  { id: 'zone_amb', label: 'Shared', rect: { x: 0, y: 80, w: 100, h: 60 } },
]

vi.mock('../../model/templates', () => ({
  TEMPLATES: [
    {
      id: 'stub-tpl',
      name: 'Stub',
      blurb: '',
      graph: {
        nodes: [{ id: 'n1', type: 'pool', position: { x: 0, y: 0 }, data: { kind: 'pool', label: 'Pool' } }],
        edges: [],
        frames: STUB_FRAMES,
      },
    },
  ],
}))

vi.mock('./known.generated', () => ({
  KNOWN_OFFICIAL_LABELS: { n1: ['Pool', 'プール', '풀'] },
  AMBIGUOUS_NODE_IDS: [],
  KNOWN_OFFICIAL_FRAME_LABELS: {
    zone_a: ['Zone A', 'ゾーンA', '구역 A'],
    zone_b: ['Zone B', 'ゾーンB', '구역 B'],
    zone_amb: ['Shared', '共有', '공유'],
  },
  AMBIGUOUS_FRAME_IDS: ['zone_amb'],
}))

const FRAME_DICTS: Record<string, Record<string, Record<string, string>>> = {
  ko: { 'stub-tpl': { zone_a: '구역 A', zone_b: '구역 B', zone_amb: '공유' } },
  ja: { 'stub-tpl': { zone_a: 'ゾーンA', zone_b: 'ゾーンB', zone_amb: '共有' } },
}
const NODE_DICTS: Record<string, Record<string, Record<string, string>>> = {
  ko: { 'stub-tpl': { n1: '풀' } },
  ja: { 'stub-tpl': { n1: 'プール' } },
}

let jaDictResident = true

vi.mock('./dicts', async (imp) => {
  const actual = await imp<typeof import('./dicts')>()
  const resident = (loc: string) => loc !== 'ja' || jaDictResident
  return {
    ...actual,
    templateLabelDictLocales: ['ko', 'ja'],
    loadedTemplateFrameLabelDict: (loc: string) => (resident(loc) ? FRAME_DICTS[loc] : undefined),
    loadedTemplateLabelDict: (loc: string) => (resident(loc) ? NODE_DICTS[loc] : undefined),
    loadedTemplateOverlay: (loc: string) =>
      resident(loc) && NODE_DICTS[loc]
        ? { nodes: NODE_DICTS[loc], frames: FRAME_DICTS[loc] }
        : undefined,
  }
})

const { relabelFramesForLocale, __rebuildOfficialTemplateLabelIndex } = await import('./relabel')
const { openTemplate } = await import('./index')
const { TEMPLATES } = await import('../../model/templates')

const frame = (id: string, label: string): SavedFrame => ({
  id,
  label,
  rect: { x: 0, y: 0, w: 10, h: 10 },
})
const titles = (fs: readonly SavedFrame[]) => fs.map((f) => f.label)

beforeEach(() => {
  jaDictResident = true
  __rebuildOfficialTemplateLabelIndex()
})

describe('relabelFramesForLocale (§TLO12)', () => {
  it('switches an official title to the target locale', () => {
    const out = relabelFramesForLocale([frame('zone_a', 'Zone A'), frame('zone_b', 'Zone B')], 'ko')
    expect(titles(out)).toEqual(['구역 A', '구역 B'])
  })

  it('switches between two non-base locales and back to the EN canonical', () => {
    const ko = relabelFramesForLocale([frame('zone_a', 'Zone A')], 'ko')
    expect(titles(ko)).toEqual(['구역 A'])
    const ja = relabelFramesForLocale(ko, 'ja')
    expect(titles(ja)).toEqual(['ゾーンA'])
    const en = relabelFramesForLocale(ja, 'en')
    expect(titles(en)).toEqual(['Zone A'])
  })

  it('preserves a user-renamed title (not one of the official strings) — same ref', () => {
    const input = [frame('zone_a', 'My inbound area')]
    const out = relabelFramesForLocale(input, 'ko')
    expect(out).toBe(input)
    expect(titles(out)).toEqual(['My inbound area'])
  })

  it('preserves the empty-string default title', () => {
    const out = relabelFramesForLocale([frame('zone_a', '')], 'ko')
    expect(titles(out)).toEqual([''])
  })

  it('never switches an ambiguous shared frame id — same ref, title kept', () => {
    const input = [frame('zone_amb', 'Shared')]
    const out = relabelFramesForLocale(input, 'ko')
    expect(out).toBe(input)
    expect(titles(out)).toEqual(['Shared'])
  })

  it('is idempotent — a title already in the target locale returns the same array reference', () => {
    const input = [frame('zone_a', '구역 A'), frame('zone_b', '구역 B')]
    expect(relabelFramesForLocale(input, 'ko')).toBe(input)
  })

  it('an empty frame set returns the same reference', () => {
    const input: SavedFrame[] = []
    expect(relabelFramesForLocale(input, 'ko')).toBe(input)
  })

  it('an unknown target locale falls back to the EN canonical', () => {
    const out = relabelFramesForLocale([frame('zone_a', '구역 A')], 'fr')
    expect(titles(out)).toEqual(['Zone A'])
  })

  it('a registered locale whose frame dict is not resident leaves the frames untouched (no half-English)', () => {
    jaDictResident = false
    __rebuildOfficialTemplateLabelIndex()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = [frame('zone_a', 'Zone A')]
    const out = relabelFramesForLocale(input, 'ja')
    expect(out).toBe(input)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('switches only the official frames in a mixed set', () => {
    const input = [frame('zone_a', 'Zone A'), frame('zone_b', 'my roasting'), frame('zone_amb', 'Shared')]
    const out = relabelFramesForLocale(input, 'ja')
    expect(out).not.toBe(input)
    expect(titles(out)).toEqual(['ゾーンA', 'my roasting', 'Shared'])
  })
})

describe('openTemplate — the frame-title overlay (§TLO12)', () => {
  const stub = () => TEMPLATES[0]

  it('en (base locale): every frame title equals the canonical', () => {
    const { graph } = openTemplate(stub(), 'en')
    expect(graph.frames?.map((f) => f.label)).toEqual(['Zone A', 'Zone B', 'Shared'])
  })

  it('ko: each frame id with a dict entry takes its localized title', () => {
    const { graph } = openTemplate(stub(), 'ko')
    expect(graph.frames?.map((f) => f.label)).toEqual(['구역 A', '구역 B', '공유'])
  })

  it('deep-cloned — mutating the opened frames never touches TEMPLATES[i]', () => {
    const src = stub()
    const { graph } = openTemplate(src, 'ko')
    expect(graph.frames).not.toBe(src.graph.frames)
    graph.frames![0].label = 'edited'
    graph.frames![0].rect.x = 999
    graph.frames!.push(frame('__extra__', 'x'))
    // canonical untouched
    expect(src.graph.frames!.map((f) => f.label)).toEqual(['Zone A', 'Zone B', 'Shared'])
    expect(src.graph.frames![0].rect.x).toBe(0)
    expect(src.graph.frames!).toHaveLength(3)
    // a fresh open is pristine again
    expect(openTemplate(src, 'ko').graph.frames?.map((f) => f.label)).toEqual(['구역 A', '구역 B', '공유'])
  })

  it('only `label` changes — id / rect identical to the en open', () => {
    const en = openTemplate(stub(), 'en').graph
    const ja = openTemplate(stub(), 'ja').graph
    expect(ja.frames?.map((f) => f.id)).toEqual(en.frames?.map((f) => f.id))
    en.frames?.forEach((f, i) => expect(ja.frames![i].rect).toEqual(f.rect))
  })
})
