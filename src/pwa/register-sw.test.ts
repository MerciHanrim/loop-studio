import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decideUpdate, selectUpdateReady, usePwaStore } from '../store/pwaStore'
import { wireRegistration } from './register-sw'

// docs/pwa.md §P4 — the waiting-worker boundary. Fakes stand in for the real
// service-worker objects; `wireRegistration` is pure of `navigator` lookups.

class FakeTarget {
  private ls: Record<string, Set<() => void>> = {}
  addEventListener(t: string, fn: () => void) {
    ;(this.ls[t] ??= new Set()).add(fn)
  }
  removeEventListener(t: string, fn: () => void) {
    this.ls[t]?.delete(fn)
  }
  dispatch(t: string) {
    for (const fn of [...(this.ls[t] ?? [])]) fn()
  }
  count(t: string) {
    return this.ls[t]?.size ?? 0
  }
}
class FakeWorker extends FakeTarget {
  postMessage = vi.fn()
  state: string
  constructor(state = 'installed') {
    super()
    this.state = state
  }
  setState(s: string) {
    this.state = s
    this.dispatch('statechange')
  }
}
class FakeReg extends FakeTarget {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  update = vi.fn(() => Promise.resolve())
}
class FakeContainer extends FakeTarget {
  controller: object | null = null
}

const wire = (reg: FakeReg, container: FakeContainer) =>
  wireRegistration(
    reg as unknown as ServiceWorkerRegistration,
    container as unknown as ServiceWorkerContainer,
    usePwaStore.getState(),
  )
const ready = () => selectUpdateReady(usePwaStore.getState())

let realWindow: unknown
beforeEach(() => {
  usePwaStore.setState({ waitingWorker: null, dismissedWorker: null, applyFn: null }, false)
  realWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { location: { reload: vi.fn() } }
})
afterEach(() => {
  ;(globalThis as { window?: unknown }).window = realWindow
})
const reloadSpy = () =>
  ((globalThis as unknown as { window: { location: { reload: ReturnType<typeof vi.fn> } } }).window
    .location.reload)

describe('wireRegistration — waiting-worker boundary', () => {
  it('1. a worker already waiting + a controller ⇒ the bar shows immediately', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    reg.waiting = new FakeWorker('installed')
    container.controller = {}
    wire(reg, container)
    expect(ready()).toBe(true)
    expect(usePwaStore.getState().waitingWorker).toBe(reg.waiting)
  })

  it('7. no controller (first install) ⇒ no bar', () => {
    const reg = new FakeReg()
    const container = new FakeContainer() // controller stays null
    reg.waiting = new FakeWorker('installed')
    wire(reg, container)
    expect(ready()).toBe(false)

    // …and the install-later path is equally quiet without a controller
    reg.installing = new FakeWorker('installing')
    reg.dispatch('updatefound')
    reg.installing.setState('installed')
    expect(ready()).toBe(false)
  })

  it('2. Dismiss on a worker, then a re-check of the SAME worker ⇒ still hidden', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    reg.waiting = new FakeWorker('installed')
    container.controller = {}
    const { recheck } = wire(reg, container)
    expect(ready()).toBe(true)

    usePwaStore.getState().dismiss()
    expect(ready()).toBe(false)

    recheck() // visibilitychange / hourly poll — same worker object
    recheck()
    expect(ready()).toBe(false)
    expect(usePwaStore.getState().dismissedWorker).toBe(reg.waiting)
  })

  it('3. a DIFFERENT worker arrives ⇒ the bar re-shows', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    container.controller = {}
    reg.waiting = new FakeWorker('installed')
    const { recheck } = wire(reg, container)
    usePwaStore.getState().dismiss()
    expect(ready()).toBe(false)

    reg.waiting = new FakeWorker('installed') // a new deploy → a new object
    recheck()
    expect(ready()).toBe(true)
    expect(usePwaStore.getState().waitingWorker).toBe(reg.waiting)
    expect(usePwaStore.getState().dismissedWorker).toBeNull()
  })

  it('4. Update registers the controllerchange listener BEFORE postMessage', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    container.controller = {}
    reg.waiting = new FakeWorker('installed')
    const addSpy = vi.spyOn(container, 'addEventListener')
    wire(reg, container)

    usePwaStore.getState().apply()

    expect(addSpy).toHaveBeenCalledWith('controllerchange', expect.any(Function))
    expect(addSpy.mock.invocationCallOrder[0]).toBeLessThan(
      reg.waiting.postMessage.mock.invocationCallOrder[0],
    )
    expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('5. controllerchange firing many times ⇒ reload exactly once, listener removed', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    container.controller = {}
    reg.waiting = new FakeWorker('installed')
    wire(reg, container)
    usePwaStore.getState().apply()

    container.dispatch('controllerchange')
    container.dispatch('controllerchange')
    container.dispatch('controllerchange')

    expect(reloadSpy()).toHaveBeenCalledTimes(1)
    expect(container.count('controllerchange')).toBe(0)
  })

  it('6b. Update when the waiting worker has vanished ⇒ resync, no message, no reload', () => {
    const reg = new FakeReg()
    const container = new FakeContainer()
    container.controller = {}
    reg.waiting = new FakeWorker('installed')
    wire(reg, container)
    expect(ready()).toBe(true)

    reg.waiting = null // gone (activated / redundant elsewhere)
    usePwaStore.getState().apply()

    expect(reloadSpy()).not.toHaveBeenCalled()
    expect(ready()).toBe(false) // cleared / resynced
  })
})

describe('decideUpdate (test 6 — run-in-progress confirm)', () => {
  it('no run in progress ⇒ apply without asking', () => {
    expect(
      decideUpdate(false, () => {
        throw new Error('confirm must not be called')
      }),
    ).toBe(true)
  })
  it('run in progress + confirm cancelled ⇒ do not apply', () => {
    expect(decideUpdate(true, () => false)).toBe(false)
  })
  it('run in progress + confirm accepted ⇒ apply', () => {
    expect(decideUpdate(true, () => true)).toBe(true)
  })
})
