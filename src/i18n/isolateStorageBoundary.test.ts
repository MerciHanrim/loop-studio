import { describe, expect, it } from 'vitest'
import { serialize } from '../model/serialize'
import type { LoopEdge, LoopNode } from '../model/types'
import { hasAnyBidiControl } from './bidiControls'
import { isolateAuto, isolateLtr, unwrapIsolates } from './bidiIsolate'

// docs/localization.md §L9.4 — the isolate is DISPLAY ONLY.
//
// The helpers in `./bidiIsolate` insert real characters. Those characters
// belong in a rendered argument and nowhere else: a control that reached the
// stored document would change its digest, travel inside an exported file and a
// share link into someone else's copy, and come back as part of a label the
// next time the document was opened. Nothing would report it — the characters
// are zero-width, so a reviewer comparing two files by eye sees nothing.
//
// The obligations implemented in this branch all wrap at the CALL SITE, over a
// copy, and never mutate the value they read. This file is the assertion that
// this stays true, stated over the real serializer rather than by inspecting
// the call sites again.

const ARABIC_FRAME = 'مبيعات Q1'
const ARABIC_LABEL = 'مَجمَع البن'
const CELL = '(Draft) 2024 Sales'

const node = (id: string, label: string): LoopNode =>
  ({
    id,
    type: 'pool',
    position: { x: 0, y: 0 },
    data: { label, kind: 'pool', capacity: null, value: 0 },
  }) as unknown as LoopNode

const edge = (id: string, source: string, target: string): LoopEdge =>
  ({ id, source, target, data: { flow: '1' } }) as unknown as LoopEdge

describe('an isolate never reaches the stored document', () => {
  const nodes = [node('a', ARABIC_LABEL), node('b', 'Latin pool')]
  const edges = [edge('e1', 'a', 'b')]
  const frames = [
    { id: 'f1', label: ARABIC_FRAME, rect: { x: 0, y: 0, w: 100, h: 100 } },
  ] as unknown as Parameters<typeof serialize>[6]

  it('serializing RTL content produces a document with zero bidi controls', () => {
    const json = serialize(nodes, edges, undefined, undefined, undefined, 1, frames)
    expect(hasAnyBidiControl(json), 'the serialized document carries a bidi control').toBe(false)
    // and the Arabic text itself is present and intact — the assertion above
    // must not be passing because the content went missing
    expect(json).toContain(ARABIC_LABEL)
    expect(json).toContain(ARABIC_FRAME)
  })

  it('wrapping a label for DISPLAY does not change what serializing it produces', () => {
    const before = serialize(nodes, edges, undefined, undefined, undefined, 1, frames)
    // a render layer isolates the same values; the model objects are untouched
    const displayed = {
      label: isolateAuto(nodes[0]!.data.label as string),
      frame: isolateAuto(ARABIC_FRAME),
      id: isolateLtr('param_7'),
    }
    expect(hasAnyBidiControl(displayed.label)).toBe(true)
    expect(hasAnyBidiControl(displayed.frame)).toBe(true)
    expect(hasAnyBidiControl(displayed.id)).toBe(true)

    const after = serialize(nodes, edges, undefined, undefined, undefined, 1, frames)
    expect(after, 'serializing after a render must be byte-identical').toBe(before)
    expect(hasAnyBidiControl(after)).toBe(false)
  })

  it('the displayed value and the stored value differ only by the isolation', () => {
    for (const raw of [ARABIC_LABEL, ARABIC_FRAME, CELL, 'param_7']) {
      expect(unwrapIsolates(isolateAuto(raw))).toBe(raw)
      expect(unwrapIsolates(isolateLtr(raw))).toBe(raw)
    }
  })

  it('a value that already carried a control is stored raw and displayed clean', () => {
    // the strip happens on the DISPLAY copy; a document that already contains a
    // stray control keeps it, because rewriting stored bytes is not this
    // feature's job and would move the digest
    const RLM = String.fromCharCode(0x200f)
    const dirty = 'a' + RLM + 'b'
    const withDirty = [node('c', dirty)]
    const json = serialize(withDirty, [], undefined, undefined, undefined, 1)
    expect(hasAnyBidiControl(json), 'a pre-existing control must survive serialization').toBe(true)
    // but what the UI shows is bounded and clean inside
    const shown = isolateAuto(dirty)
    expect(unwrapIsolates(shown)).toBe('ab')
  })
})

describe('the same guarantee, stated over the digest', () => {
  it('two serializations of the same model are identical regardless of rendering', () => {
    const nodes = [node('a', ARABIC_LABEL)]
    const first = serialize(nodes, [], undefined, undefined, undefined, 1)
    // simulate a full render pass over every value the obligations touch
    for (const n of nodes) {
      void isolateAuto(n.data.label as string)
      void isolateLtr(n.id)
    }
    const second = serialize(nodes, [], undefined, undefined, undefined, 1)
    expect(second).toBe(first)
  })
})
