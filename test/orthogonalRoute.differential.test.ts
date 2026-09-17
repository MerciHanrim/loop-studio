import { describe, expect, it } from 'vitest'
import { computeOrthogonalRoute, type RouteResult } from '../src/components/edges/orthogonalRoute'
import { computeOrthogonalRouteReference } from './orthogonalRoute.reference'
import {
  boundaryCases,
  exampleCases,
  latticeCases,
  ORTHO_EXAMPLES,
  randomCases,
  stressCases,
  type Case,
} from './routeCases'

// docs/edge-routing.md §ER3 — the shipped router against the FROZEN
// pre-optimisation implementation (`./orthogonalRoute.reference.ts`, a verbatim
// copy of `main` at e763eeb).
//
// The golden fixture pins the bytes of a corpus a human can review; this test
// covers what a fixture cannot enumerate — the 144-edge stress graph and
// thousands of seeded random layouts that deliberately straddle the router's
// decision boundaries (coordinates on and just off the ruler lines, degenerate
// and overlapping obstacles, endpoints inside inflated boxes, invalid
// waypoints, parallel fans, self-loops).
//
// EVERY field must match exactly. `d` and `hitD` are compared as strings, the
// numbers with `Object.is` (so a +0/-0 divergence is reported, not swallowed).
// A mismatch means the optimisation is not adoptable — it is never a licence to
// bless a "better" route.

const FIELDS = ['d', 'hitD', 'routeClass', 'invalidWaypoint'] as const

type Mismatch = { name: string; field: string; reference: unknown; shipped: unknown }

const compare = (name: string, ref: RouteResult, got: RouteResult): Mismatch[] => {
  const out: Mismatch[] = []
  for (const f of FIELDS)
    if (ref[f] !== got[f]) out.push({ name, field: f, reference: ref[f], shipped: got[f] })
  if (!Object.is(ref.mid.x, got.mid.x)) out.push({ name, field: 'mid.x', reference: ref.mid.x, shipped: got.mid.x })
  if (!Object.is(ref.mid.y, got.mid.y)) out.push({ name, field: 'mid.y', reference: ref.mid.y, shipped: got.mid.y })
  if (!Object.is(ref.endAngle, got.endAngle))
    out.push({ name, field: 'endAngle', reference: ref.endAngle, shipped: got.endAngle })
  return out
}

/** runs both implementations over the corpus; returns the mismatches and the
 *  route-class histogram (so a corpus that silently stops covering a branch is
 *  visible in the assertion below, not hidden). */
function run(cases: Case[]): { mismatches: Mismatch[]; classes: Record<string, number> } {
  const mismatches: Mismatch[] = []
  const classes: Record<string, number> = {}
  for (const c of cases) {
    const ref = computeOrthogonalRouteReference(c.input)
    const got = computeOrthogonalRoute(c.input)
    classes[ref.routeClass] = (classes[ref.routeClass] ?? 0) + 1
    if (mismatches.length < 20) mismatches.push(...compare(c.name, ref, got))
  }
  return { mismatches, classes }
}

const expectIdentical = (r: { mismatches: Mismatch[] }) => {
  // the whole first mismatch is shown, truncated, so a failure is diagnosable
  const shown = r.mismatches.slice(0, 3).map((m) => ({
    ...m,
    reference: typeof m.reference === 'string' ? m.reference.slice(0, 120) : m.reference,
    shipped: typeof m.shipped === 'string' ? m.shipped.slice(0, 120) : m.shipped,
  }))
  expect(shown).toEqual([])
}

describe('orthogonalRoute — differential against the frozen pre-optimisation router', () => {
  for (const graph of ORTHO_EXAMPLES) {
    it(`${graph} — identical on every orthogonal edge`, { timeout: 120_000 }, () => {
      const r = run(exampleCases(graph))
      expectIdentical(r)
    })
  }

  it('boundary corpus — identical, and it covers every route class', { timeout: 120_000 }, () => {
    const r = run(boundaryCases())
    expectIdentical(r)
    expect(Object.keys(r.classes).sort()).toEqual(['degenerate', 'fallback-lz', 'orthogonal', 'same-side', 'self-loop'])
  })

  it('stress: mmo-progression with all 144 edges orthogonal — identical', { timeout: 180_000 }, () => {
    const cases = stressCases()
    expect(cases.length).toBe(144)
    const r = run(cases)
    expectIdentical(r)
    // the stress graph is the one that drives the search hard enough to hit the
    // expansion budget; if that stops being true the corpus has drifted
    expect(r.classes['fallback-lz'] ?? 0).toBeGreaterThan(0)
  })

  for (const seed of [1, 20260917, 987654321]) {
    it(`seeded random layouts (seed ${seed}) — identical`, { timeout: 180_000 }, () => {
      const r = run(randomCases(seed, 500))
      expectIdentical(r)
      // a corpus that degenerated into trivial inputs would pass vacuously
      expect(r.classes['orthogonal'] ?? 0).toBeGreaterThan(100)
    })
  }

  // The corpus that carries the byte-identity claim. Fractional layouts almost
  // never tie, so they cannot see a change to the A* pick order or to the
  // wide-channel ruler threshold; lattice layouts tie constantly. Both
  // mutations are caught here and nowhere else.
  for (const seed of [7, 20260917, 424242]) {
    it(`lattice-aligned layouts (seed ${seed}) — identical`, { timeout: 180_000 }, () => {
      const r = run(latticeCases(seed, 500))
      expectIdentical(r)
      expect(r.classes['orthogonal'] ?? 0).toBeGreaterThan(100)
    })
  }

  it('the reference oracle is itself deterministic (same input twice ⇒ same bytes)', () => {
    for (const c of boundaryCases()) {
      const a = computeOrthogonalRouteReference(c.input)
      const b = computeOrthogonalRouteReference(c.input)
      expect(b.d).toBe(a.d)
      expect(b.hitD).toBe(a.hitD)
    }
  })
})
