import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalContent, digestOfCanonical, planRevisionExport, readRevisionSideAndProject, REVISION_SEMANTICS } from '../src/model/revision'
import { deserialize } from '../src/model/serialize'

// SEMANTICS-R14.md §R14-1 / R14-INV-1 — `loop-revision/14` changes what a chosen Apply can
// take and what counts as a conflict. It changes no projection: the canonical bytes and the
// digest of every document are those of `loop-revision/13`.
//
// The two digests below were measured with the reader of main before this change
// (0d6f14b7, extracted with `git archive`) and with this one, on every bundled example:
// byte-identical canonical content, equal digests. They are pinned here so that a later
// change of the projection cannot pass as "no change".

const COFFEE = readFileSync(resolve(import.meta.dirname, '..', 'examples', 'coffee-roasting-batch.json'), 'utf8')
const PINNED = {
  withPhases: 'cfbb603bbbb32440647ccf983602c143e539c5654e8d3fdb82112fe4791cce5a',
  withoutPhases: '0f82dce9f8cb76550fa66d25fc74f9f60af31d8a36273e035aefd1f3ff2d7862',
}
const doc = (dropPhases: boolean) => {
  const d = deserialize(COFFEE)
  return { d, content: { nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, dataImports: d.dataImports, kinds: d.kinds, time: d.time, timetables: d.timetables, phases: dropPhases ? [] : d.phases } }
}

describe('loop-revision/14 keeps every document’s bytes and digest', () => {
  it('a document with phases digests as it did under /13', () => {
    const { d, content } = doc(false)
    expect(digestOfCanonical(canonicalContent(content, { modelVersion: d.modelVersion }))).toBe(PINNED.withPhases)
  })

  it('a document without phases digests as it did, and has no `phases` key in its canonical bytes', () => {
    const { d, content } = doc(true)
    const c = canonicalContent(content, { modelVersion: d.modelVersion })
    expect(digestOfCanonical(c)).toBe(PINNED.withoutPhases)
    expect(JSON.stringify(c)).not.toContain('"phases"')
  })

  it('a written revision file declares the current semantics in its header, outside the digest, and unmarked content is still read as /13 or earlier', () => {
    expect(REVISION_SEMANTICS).toBe('loop-revision/15')
    for (const dropPhases of [false, true]) {
      const { d, content } = doc(dropPhases)
      const r = planRevisionExport({
        modelVersion: d.modelVersion,
        doc: content,
        project: { projectId: `proj_${'0'.repeat(26)}`, revisionId: `rev_${'0'.repeat(26)}`, parentId: null, lineage: [] },
        dirty: false,
        meta: { createdAt: '2026-11-14T00:00:00Z' },
        now: '2026-11-14T00:00:00Z',
      })
      if (!r.ok) throw new Error('revision export')
      const file = JSON.parse(r.text)
      expect(file.project.semantics).toBe('loop-revision/15')
      expect(file.project.contentDigest).toBe(dropPhases ? PINNED.withoutPhases : PINNED.withPhases)
      // the label of a side is inferred from its content, and no content is /14
      const back = deserialize(r.text)
      const read = readRevisionSideAndProject({ ...back, recommendedRunConfig: back.recommendedRunConfig } as never, file.project, d.modelVersion)
      if (!read.ok) throw new Error('side and project')
      expect(read.side.version).not.toBe('loop-revision/14')
      expect(read.side.version).not.toBe('loop-revision/15')
      expect(read.side.version === 'loop-revision/13').toBe(!dropPhases)
    }
  })
})
