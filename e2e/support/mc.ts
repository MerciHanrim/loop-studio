import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

// Slice-2 harness: instrument the Monte-Carlo execution path (Worker vs
// cooperative) and capture Blob exports — all as page-side Web-API spies, no
// product-code change. Install BEFORE any app script runs (page.addInitScript).

export type PathProbe = {
  wk: { ctor: number; init: number; job: number; msgIn: number }
  ticks: number
}

/** Everything the specs read back out of the instrumented page. */
declare global {
  interface Window {
    __wk: { ctor: number; init: number; job: number; msgIn: number }
    __ticks: number
    __downloads: { name: string; textP: Promise<string> }[]
  }
}

/**
 * addInitScript payload. Wraps `Worker` in a `Proxy` construct trap (real
 * prototype preserved), counts `postMessage({type})` on the prototype, runs a
 * macrotask ticker, and captures `download()`-helper Blob exports via
 * `URL.createObjectURL` + anchor-click.
 */
function probeSource(): string {
  return `(() => {
    const w = window;
    w.__wk = { ctor: 0, init: 0, job: 0, msgIn: 0 };
    w.__ticks = 0;
    w.__downloads = [];

    if (typeof Worker === 'function' && !w.__wkPatched) {
      w.__wkPatched = true;
      const RealWorker = Worker;
      const realPost = RealWorker.prototype.postMessage;
      RealWorker.prototype.postMessage = function (m, ...rest) {
        const t = m && typeof m === 'object' && !ArrayBuffer.isView(m) ? m.type : undefined;
        if (t === 'init') w.__wk.init++;
        else if (t === 'job') w.__wk.job++;
        return realPost.call(this, m, ...rest);
      };
      w.Worker = new Proxy(RealWorker, {
        construct(target, args) {
          w.__wk.ctor++;
          const inst = Reflect.construct(target, args);
          inst.addEventListener('message', () => { w.__wk.msgIn++; });
          return inst;
        },
      });
    }

    (function tick() { w.__ticks++; setTimeout(tick, 0); })();

    // capture the app's download() helper: it does URL.createObjectURL(blob),
    // then a.download = name, a.click(), URL.revokeObjectURL(url) — all sync.
    if (!w.__objUrlPatched) {
      w.__objUrlPatched = true;
      const realCreate = URL.createObjectURL.bind(URL);
      const byUrl = new Map();
      URL.createObjectURL = (obj) => {
        const url = realCreate(obj);
        if (obj && typeof obj.text === 'function') byUrl.set(url, obj);
        return url;
      };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        try {
          const href = this.href || '';
          if (this.download && href.startsWith('blob:') && byUrl.has(href)) {
            const blob = byUrl.get(href);
            w.__downloads.push({ name: this.download, textP: blob.text() });
          }
        } catch (_) { /* ignore */ }
        return realClick.call(this);
      };
    }
  })()`
}

/** Install the probe. Call once per page, before navigation. */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(probeSource())
  // docs/guided-tour.md — suppress the first-run Welcome card in the portable /
  // dist specs (they don't import `./support/loop`, so they miss its fixture).
  await page.addInitScript(() => {
    ;(window as unknown as { __noFirstRunTour: boolean }).__noFirstRunTour = true
  })
}

/**
 * Pin the execution path on an http page by faking the core count the app reads
 * at call time. 'worker' ⇒ hardwareConcurrency 8 ⇒ defaultWorkerCount() 4.
 * 'coop' ⇒ 1 ⇒ defaultWorkerCount() 1 ⇒ cooperative. No effect on file://.
 */
export async function forcePath(page: Page, path: 'worker' | 'coop'): Promise<void> {
  const n = path === 'worker' ? 8 : 1
  await page.addInitScript(`Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${n}, configurable: true })`)
}

export async function pathProbe(page: Page): Promise<PathProbe> {
  return page.evaluate(() => ({ wk: { ...window.__wk }, ticks: window.__ticks }))
}

/** Resolve every captured export's text; returns newest last. */
export async function capturedExports(page: Page): Promise<{ name: string; text: string }[]> {
  return page.evaluate(async () => {
    const out: { name: string; text: string }[] = []
    for (const d of window.__downloads) out.push({ name: d.name, text: await d.textP })
    return out
  })
}

export type SimSnapshot = {
  status: string
  stepIndex: number
  seed: number
  canUndo: boolean
  canRedo: boolean
}

export function simSnapshot(page: Page): Promise<SimSnapshot> {
  return page.evaluate(() => {
    const l = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop
    const s = l.sim.getState()
    const g = l.graph.getState()
    return {
      status: s.status,
      stepIndex: s.stepIndex,
      seed: s.seed,
      canUndo: g.canUndo,
      canRedo: g.canRedo,
    }
  })
}

/** The full MonteCarloResult as a stable JSON string (http bridge only). */
export function mcResultJson(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const r = (window as unknown as { __loop: Record<string, { getState: () => any }> }).__loop.mc.getState().result
    return r ? JSON.stringify(r) : null
  })
}

/** Import a graph file through the real hidden <input type=file> (works without the bridge). */
export async function importGraphFile(page: Page, filePath: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(resolve(filePath))
}

export const portableUrl = (): string =>
  pathToFileURL(resolve('dist-portable/loop-studio.html')).href
