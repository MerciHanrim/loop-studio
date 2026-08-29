import { test } from './support/loop'
import { fixtureFlow } from './support/revision-fixture'

// The committed loop-revision/1 oracle (examples/revision/*, guarded by
// test/revision-fixture.test.ts), replayed through the real UI. The mobile
// project runs the same `fixtureFlow('mobile')` from mobile.spec.ts.
test.describe('loop-revision/1 — verification fixture (desktop)', () => {
  test('Import → Review → whole & selective Apply → Undo → Redo matches the oracle', fixtureFlow('toolbar'))
})
