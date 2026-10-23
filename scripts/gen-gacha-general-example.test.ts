// The runner for scripts/gen-gacha-general-example.ts — the generator imports
// the product's TypeScript modules, so it runs under vitest's transform, like
// the 3-zone comparison's (gen-gacha-banner-zones-example.test.ts).
// Regenerate after a deliberate change:
//   GEN_GACHA_GENERAL=1 npx vitest run scripts/gen-gacha-general-example.test.ts
// Without the flag this file is a no-op (one skipped test), so the suite never
// rewrites the shipped example by accident.
import { describe, it } from 'vitest'

describe('examples/gacha-general.json generator', () => {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_GACHA_GENERAL === '1') {
    it('regenerates examples/gacha-general.json', async () => {
      await import('./gen-gacha-general-example')
    })
  } else {
    it.skip('regenerates examples/gacha-general.json (set GEN_GACHA_GENERAL=1)', () => {})
  }
})
