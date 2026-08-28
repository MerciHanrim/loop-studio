import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from '@playwright/test'

// Dependency of the `portable` project: produce dist-portable/loop-studio.html
// (git-ignored, so always built fresh in CI).
test('build the portable single-file bundle', () => {
  test.setTimeout(180_000)
  execSync('npm run build:portable', { stdio: 'inherit' })
  const out = resolve('dist-portable/loop-studio.html')
  if (!existsSync(out)) throw new Error(`build:portable did not produce ${out}`)
})
