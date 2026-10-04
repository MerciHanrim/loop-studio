import { beforeEach } from 'vitest'
import { storageSession } from '../storage/storagePort'

// Issue #297 - the storage port starts SHUT (its `gate` state throws on every
// call) and is opened by the boot module once the storage gate is answered. The
// unit tests exercise the stores behind the port, not the gate in front of it,
// so each test starts with the port open on the browser door, which is what a
// personal browser is and what every store test was written against. A test
// of the gate itself calls `storageSession.__resetForTests()` and says so.
//
// Registered as a vitest `setupFiles` entry in vite.config.ts.

beforeEach(() => {
  storageSession.__resetForTests()
  storageSession.use('personal')
})
