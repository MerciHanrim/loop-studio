import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { computeOrthogonalRoute, ROUTER_VERSION, type RouteResult } from '../src/components/edges/orthogonalRoute'
import { boundaryCases, exampleCases, goldenCases, ORTHO_EXAMPLES, type Case } from './routeCases'

// docs/edge-routing.md §ER3 — the FROZEN route bytes.
//
// `fixtures/routes/golden-routes.json` pins the exact `d` / `hitD` /
// routeClass / mid / endAngle / invalidWaypoint the router produced on `main`
// at e763eeb, for every orthogonal edge of every bundled example (with the real
// measured node sizes) and for the whole boundary corpus.
//
// The router is RENDER-ONLY but it is not cosmetic: a route that changes moves
// every edge on every saved diagram. So the rule is: the bytes do not change
// unless the change is INTENDED, in which case `ROUTER_VERSION` is bumped and
// the fixture is regenerated in the same reviewed commit — never to make a red
// test green.
//
//   regenerate (deliberately):  UPDATE_ROUTE_GOLDEN=1 npx vitest run test/orthogonalRoute.golden.test.ts
//
// The fixture stores OUTPUTS only. The inputs are rebuilt from `examples/*.json`
// plus `fixtures/routes/measured-node-sizes.json` by `./routeCases.ts`, which
// replicates `src/store/routeMap.ts` `rebuild` exactly — so a change to how the
// app FEEDS the router shows up here too.

type Snap = {
  d: string
  hitD: string
  routeClass: string
  mid: [number, number]
  endAngle: number
  invalidWaypoint: boolean
}
type Fixture = {
  generatedFrom: string
  routerVersion: number
  note: string
  cases: Record<string, Snap>
}

const FIXTURE_URL = new URL('./fixtures/routes/golden-routes.json', import.meta.url)

/** The commit the fixture was generated from: `main` as it stood BEFORE the
 *  router's internals were cost-reduced. Pinned, not merely "present", because
 *  the whole point of the fixture is that it predates the change: regenerating
 *  it rewrites `generatedFrom`, so an accidental regeneration on a later commit
 *  fails here loudly instead of quietly blessing whatever the router does
 *  today. Changing this constant is a deliberate act and belongs in the same
 *  reviewed commit as an intended route change and a ROUTER_VERSION bump. */
const FIXTURE_SOURCE_COMMIT = 'e763eeb'

/** both sides go through the same JSON normalisation, so -0 and +0 cannot
 *  produce a phantom mismatch that the rendered path string does not have */
const snap = (r: RouteResult): Snap =>
  JSON.parse(
    JSON.stringify({
      d: r.d,
      hitD: r.hitD,
      routeClass: r.routeClass,
      mid: [r.mid.x, r.mid.y],
      endAngle: r.endAngle,
      invalidWaypoint: r.invalidWaypoint,
    }),
  ) as Snap

const UPDATE = process.env.UPDATE_ROUTE_GOLDEN === '1'

if (UPDATE) {
  const cases = goldenCases()
  const out: Record<string, Snap> = {}
  for (const c of [...cases].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
    out[c.name] = snap(computeOrthogonalRoute(c.input))
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    /* not a git checkout — leave 'unknown' */
  }
  const fixture: Fixture = {
    generatedFrom: sha,
    routerVersion: ROUTER_VERSION,
    note:
      'Frozen §ER3 router output. Regenerate ONLY together with an intended route change and a ROUTER_VERSION bump. ' +
      'Inputs are rebuilt from examples/*.json + measured-node-sizes.json by test/routeCases.ts.',
    cases: out,
  }
  writeFileSync(FIXTURE_URL, JSON.stringify(fixture, null, 1) + '\n')
}

const fixture = JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as Fixture

const checkGroup = (cases: Case[]) => {
  const missing: string[] = []
  const mismatched: { name: string; field: string; expected: unknown; actual: unknown }[] = []
  for (const c of cases) {
    const want = fixture.cases[c.name]
    if (!want) {
      missing.push(c.name)
      continue
    }
    const got = snap(computeOrthogonalRoute(c.input))
    for (const k of ['d', 'hitD', 'routeClass', 'endAngle', 'invalidWaypoint'] as const)
      if (got[k] !== want[k]) mismatched.push({ name: c.name, field: k, expected: want[k], actual: got[k] })
    if (got.mid[0] !== want.mid[0] || got.mid[1] !== want.mid[1])
      mismatched.push({ name: c.name, field: 'mid', expected: want.mid, actual: got.mid })
  }
  return { missing, mismatched }
}

describe('orthogonalRoute — golden route bytes', () => {
  it('the fixture was generated from the pre-optimisation router and pins this ROUTER_VERSION', () => {
    expect(fixture.routerVersion).toBe(ROUTER_VERSION)
    expect(fixture.generatedFrom).toBe(FIXTURE_SOURCE_COMMIT)
    expect(Object.keys(fixture.cases).length).toBeGreaterThan(100)
  })

  it('pins exactly the cases the corpus produces — no silent additions or drops', () => {
    const corpus = goldenCases()
      .map((c) => c.name)
      .sort()
    expect(new Set(corpus).size).toBe(corpus.length) // case names are unique
    expect(corpus).toEqual(Object.keys(fixture.cases).sort())
  })

  for (const graph of ORTHO_EXAMPLES) {
    it(`${graph} — every orthogonal edge routes byte-identically`, { timeout: 60_000 }, () => {
      const { missing, mismatched } = checkGroup(exampleCases(graph))
      expect({ missing, mismatched: mismatched.slice(0, 5) }).toEqual({ missing: [], mismatched: [] })
      expect(mismatched.length).toBe(0)
    })
  }

  it('boundary corpus — every case routes byte-identically', { timeout: 60_000 }, () => {
    const { missing, mismatched } = checkGroup(boundaryCases())
    expect({ missing, mismatched: mismatched.slice(0, 5) }).toEqual({ missing: [], mismatched: [] })
    expect(mismatched.length).toBe(0)
  })

  it('the corpus actually exercises every route class, including both fallbacks', () => {
    const classes = new Set(Object.values(fixture.cases).map((c) => c.routeClass))
    expect([...classes].sort()).toEqual(['degenerate', 'fallback-lz', 'orthogonal', 'same-side', 'self-loop'])
    const invalid = Object.values(fixture.cases).filter((c) => c.invalidWaypoint)
    expect(invalid.length).toBeGreaterThan(0) // §ER4 invalid-waypoint path is pinned too
  })
})
