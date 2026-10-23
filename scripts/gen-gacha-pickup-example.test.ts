// The runner for scripts/gen-gacha-pickup-example.ts — the generator imports
// the product's TypeScript modules, so it runs under vitest's transform, like
// the standard gacha's (gen-gacha-standard-example.test.ts).
// Regenerate after a deliberate change:
//   GEN_GACHA_PICKUP=1 npx vitest run scripts/gen-gacha-pickup-example.test.ts
// Without the flag this file is a no-op (one skipped test), so the suite never
// rewrites the shipped example by accident.
import { describe, it } from 'vitest'

describe('examples/gacha-pickup.json generator', () => {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_GACHA_PICKUP === '1') {
    it('regenerates examples/gacha-pickup.json', async () => {
      await import('./gen-gacha-pickup-example')
    })
  } else {
    it.skip('regenerates examples/gacha-pickup.json (set GEN_GACHA_PICKUP=1)', () => {})
  }
})
