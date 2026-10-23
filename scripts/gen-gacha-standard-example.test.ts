// The runner for scripts/gen-gacha-standard-example.ts — the generator imports
// the product's TypeScript modules, so it runs under vitest's transform, like
// the general gacha's (gen-gacha-general-example.test.ts).
// Regenerate after a deliberate change:
//   GEN_GACHA_STANDARD=1 npx vitest run scripts/gen-gacha-standard-example.test.ts
// Without the flag this file is a no-op (one skipped test), so the suite never
// rewrites the shipped example by accident.
import { describe, it } from 'vitest'

describe('examples/gacha-standard.json generator', () => {
  if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEN_GACHA_STANDARD === '1') {
    it('regenerates examples/gacha-standard.json', async () => {
      await import('./gen-gacha-standard-example')
    })
  } else {
    it.skip('regenerates examples/gacha-standard.json (set GEN_GACHA_STANDARD=1)', () => {})
  }
})
