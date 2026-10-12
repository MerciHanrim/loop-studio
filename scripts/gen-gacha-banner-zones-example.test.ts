// The runner for scripts/gen-gacha-banner-zones-example.ts — the generator
// imports the product's TypeScript modules, so it runs under vitest's
// transform, like the Coffee roastery's own regeneration gate
// (src/engine/coffee-roastery.test.ts). Regenerate after a deliberate change:
//   GEN_GACHA_BANNER_ZONES=1 npx vitest run scripts/gen-gacha-banner-zones-example.test.ts
// Without the flag this file is a no-op (one skipped test), so the suite never
// rewrites the shipped example by accident.
import { describe, it } from 'vitest'

describe('examples/gacha-banner-zones.json generator', () => {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_GACHA_BANNER_ZONES === '1') {
    it('regenerates examples/gacha-banner-zones.json', async () => {
      await import('./gen-gacha-banner-zones-example')
    })
  } else {
    it.skip('regenerates examples/gacha-banner-zones.json (set GEN_GACHA_BANNER_ZONES=1)', () => {})
  }
})
