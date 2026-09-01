import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'

// docs/localization.md Slice 1 + the language-menu follow-up.
//   • the language control is a trigger button + a registry-driven overlay menu
//     (menu / menuitemradio); it changes no Toolbar height and no Canvas geometry;
//   • `<html lang>` tracks the active locale; the choice persists at
//     `loop-studio/ui-locale/1` and survives a reload; a corrupt stored value is
//     ignored (browser locale → en);
//   • `?lang=<code>` (dev/e2e only, §L11) forces a locale without persisting;
//   • §L12 #5 — a locale switch moves NOTHING that belongs to the document or
//     the committed engine result, including any exported payload.

type Bridge = {
  __loop: Record<string, { getState: () => any }> & {
    revisionIO: { currentTargetDigest: () => string }
    rf: { getViewport: () => { x: number; y: number; zoom: number }; setViewport: (v: unknown, o?: unknown) => void }
  }
}

const G = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'src', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
    { id: 'pool', type: 'pool', position: { x: 240, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
  ],
  edges: [
    { id: 'e', type: 'loop', source: 'src', target: 'pool', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '2' } },
  ],
})

const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('loop-studio/ui-locale/1'))

/** open the language menu (desktop or inside the mobile More sheet) and pick a
 *  locale by its registered code. */
async function pickLocale(page: Page, code: string, scope = '') {
  const trigger = page.locator(`${scope} .lang-switch`.trim()).first()
  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const item = page.locator(`${scope} .lang-menu__item[data-locale="${code}"]`.trim())
  await expect(item).toBeVisible()
  await item.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => htmlLang(page)).toBe(code)
}

/** every document-owned + committed-engine surface, normalised (§L12 #5) */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as Bridge).__loop
    const g = l.graph.getState()
    const s = l.sim.getState()
    return {
      digest: l.revisionIO.currentTargetDigest(),
      graph: JSON.stringify({
        nodes: g.nodes.map((n: any) => [n.id, n.type, n.position, n.data]),
        edges: g.edges.map((e: any) => [e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.data]),
      }),
      canUndo: g.canUndo,
      canRedo: g.canRedo,
      simulationRev: g.simulationRev,
      viewport: l.rf.getViewport(),
      d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
      hit: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-interaction')].map((p) => p.getAttribute('d')),
      values: s.values,
      stepIndex: s.stepIndex,
      status: s.status,
    }
  })

test.describe('i18n — Slice 1 (Toolbar + Play bar)', () => {
  test('the language menu switches the UI immediately and sets <html lang>', async ({ page }) => {
    await openApp(page)
    await resetAll(page)

    expect(await htmlLang(page)).toBe('en')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ Play')
    await expect(page.locator('.toolbar__tag')).toHaveText('preview')

    await pickLocale(page, 'ko')
    expect(await stored(page)).toBe('ko')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ 재생')
    await expect(page.locator('.toolbar__tag')).toHaveText('미리보기')
    await expect(page.locator('.toolbar__palette .chip--pool')).toContainText('풀')

    await pickLocale(page, 'en')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ Play')
  })

  test('the chosen locale survives a reload (no flash — resolved before mount)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe('ko')
    await expect(page.locator('.pstrip__group .pb-btn--primary')).toHaveText('▶ 재생')
  })

  test('creating a node in a Korean UI stores the locale-independent default label', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
    await page.locator('.toolbar__palette .chip--source').click()
    const label = await page.evaluate(() => {
      const g = (window as unknown as Bridge).__loop.graph.getState()
      return g.nodes[g.nodes.length - 1]?.data?.label
    })
    expect(label).toBe('Source') // NOT '소스' — model data is not translated (§L3.4)
  })

  test('a locale switch (×4) moves no GraphDoc / digest / undo / viewport / SimState', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
    })
    await page.evaluate(() =>
      (window as unknown as Bridge).__loop.rf.setViewport({ x: 37, y: -12, zoom: 0.8 }, { duration: 0 }),
    )
    const before = await snapshot(page)
    for (const code of ['ko', 'en', 'ko', 'en']) await pickLocale(page, code)
    expect(await snapshot(page)).toEqual(before) // byte-for-byte
  })

  test('?lang= forces a locale without touching localStorage; a corrupt stored value is ignored', async ({ page }) => {
    await page.goto('/?lang=ko')
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect.poll(() => htmlLang(page)).toBe('ko')
    expect(await stored(page)).toBeNull()

    await page.evaluate(() => localStorage.setItem('loop-studio/ui-locale/1', 'KO_bad_value'))
    await page.goto('/')
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(await htmlLang(page)).toBe('en')
    expect(await stored(page)).toBe('KO_bad_value') // left exactly as it was
  })
})

test.describe('i18n — Slice 2a (Canvas / Inspector / Timeline + palette tip)', () => {
  test('the palette tip has three separate lines, is aria-describedby-linked, and localizes', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)

    const chip = page.locator('.palette-item .chip--source')
    const tip = page.locator('#palette-tip-source')
    await expect(chip).toHaveAttribute('aria-describedby', 'palette-tip-source')
    // three DISTINCT element lines — never one concatenated string
    await expect(tip.locator('.palette-tip__name')).toHaveText('Source')
    await expect(tip.locator('.palette-tip__desc')).toHaveCount(1)
    await expect(tip.locator('.palette-tip__how')).toHaveText('Click, or drag onto the canvas, to add one.')
    // the button's accessible name stays the short name
    await expect(chip).toHaveAccessibleName('Source')

    await pickLocale(page, 'ko')
    await expect(tip.locator('.palette-tip__name')).toHaveText('소스')
    await expect(tip.locator('.palette-tip__how')).toHaveText('클릭하거나 캔버스로 끌어다 놓아 추가하세요.')
    await expect(chip).toHaveAccessibleName('소스')
  })

  test('the Toolbar height is identical in EN and KO (CJK metrics are capped)', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const h = () =>
      page.evaluate(() => Math.round(document.querySelector('.toolbar')!.getBoundingClientRect().height * 100) / 100)
    const en = await h()
    await pickLocale(page, 'ko')
    expect(await h()).toBe(en)
    await pickLocale(page, 'en') // leave the session in EN for the next spec
  })

  test('showing a palette tip (hover / focus) moves no Toolbar height, viewport, node box, or edge d', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    const geom = () =>
      page.evaluate(() => {
        const tb = document.querySelector('.toolbar') as HTMLElement
        const boxes = [...document.querySelectorAll('.react-flow__node')].map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect()
          return [n.getAttribute('data-id'), Math.round(r.width), Math.round(r.height)]
        })
        return {
          toolbarH: Math.round((tb?.getBoundingClientRect().height ?? 0) * 10) / 10,
          viewport: (window as any).__loop.rf.getViewport(),
          boxes: JSON.stringify(boxes),
          d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
        }
      })

    await expect
      .poll(async () => {
        const g = await geom()
        return g.d.every(Boolean)
      })
      .toBe(true)
    const before = await geom()

    // keyboard focus surfaces the tip (:focus-within); hover surfaces it too
    await page.locator('.palette-item .chip--gate').focus()
    await expect(page.locator('#palette-tip-gate')).toBeVisible()
    await page.locator('.palette-item .chip--register').hover()
    await expect(page.locator('#palette-tip-register')).toBeVisible()

    expect(await geom()).toEqual(before)
  })

  test('Inspector chrome localizes; the node/edge model data does not', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await pickLocale(page, 'ko')

    // select the source node through the store bridge
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('src', null))
    const insp = page.locator('aside.inspector')
    await expect(insp.locator('.field__label').first()).toHaveText('이름') // "Label"
    await expect(insp.getByRole('button', { name: '삭제' })).toBeVisible() // "Delete"
    // the user's label value is still the English default it was created with
    await expect(insp.locator('.field input').first()).toHaveValue('S')
    // the kind chip is a raw enum token — shown verbatim
    await expect(insp.locator('.inspector__kind')).toHaveText('source')
  })

  test('a register diagnostic shows the stable CODE verbatim + a localized message', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.evaluate(() => {
      const g = (window as any).__loop.graph.getState()
      // structurally readable expr, but it evaluates invalid ⇒ M_REG_EVAL
      g.loadJSON(
        JSON.stringify({
          schema: 'loop-studio/graph',
          version: 1,
          nodes: [
            { id: 'r1', type: 'register', position: { x: 0, y: 0 }, data: { kind: 'register', label: 'R', expr: '1 / 0' } },
          ],
          edges: [],
        }),
      )
      g.setSelection('r1', null)
    })
    // the register node + its invalid outcome must be in the DOM before we read
    await expect(page.locator('.react-flow__node[data-id="r1"]')).toBeVisible()
    const note = page.locator('aside.inspector .inspector__note--warn').first()
    await expect(note).toContainText('M_REG_EVAL')
    await pickLocale(page, 'ko')
    // poll: the note re-renders when the KO catalog activates
    await expect(note).toContainText('M_REG_EVAL') // code — never translated
    await expect(note).toContainText('오류로 평가됩니다') // message — localized
    await expect(note).toContainText('단계에서 값 없음') // frame — localized
  })

  test('Timeline chrome localizes; the EN axis text stays "step N"', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    await expect(page.locator('.timeline__head')).toContainText('timeline')
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
    })
    const enTicks = await page.evaluate(() =>
      [...document.querySelectorAll('.timeline__svg .timeline__tick')]
        .map((s) => (s.textContent ?? '').trim())
        .filter((s) => s.startsWith('step ')),
    )
    expect(enTicks.length).toBeGreaterThan(0) // EN axis unchanged — "step N"

    await pickLocale(page, 'ko')
    await expect(page.locator('.timeline__head')).toContainText('타임라인')
    const koTicks = await page.evaluate(() =>
      [...document.querySelectorAll('.timeline__svg .timeline__tick')]
        .map((s) => (s.textContent ?? '').trim())
        .filter((s) => /단계$/.test(s)),
    )
    expect(koTicks.length).toBeGreaterThan(0) // KO axis — "N단계"
  })

  test('a locale round-trip with a model graph + Inspector open moves nothing document-owned', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
      ;(window as any).__loop.graph.getState().setSelection('pool', null)
    })
    const before = await snapshot(page)
    for (const code of ['ko', 'en', 'ko', 'en']) await pickLocale(page, code)
    expect(await snapshot(page)).toEqual(before)
  })

  test('Inspector <select> options: value = wire token, label = localized, switch is a no-op', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => (window as any).__loop.graph.getState().setSelection('pool', null))

    const flowSel = page.locator('aside.inspector select').filter({ has: page.locator('option[value="pullAny"]') })
    const actSel = page.locator('aside.inspector select').filter({ has: page.locator('option[value="automatic"]') })

    // EN: option TEXT is the current display text; the stored value is the token
    await expect(actSel).toHaveValue('passive') // pool default activation
    await expect(flowSel).toHaveValue('pullAny')
    await expect(actSel.locator('option[value="automatic"]')).toHaveText('automatic')
    await expect(flowSel.locator('option[value="pushAny"]')).toHaveText('push any')

    const before = await snapshot(page)
    const inspW = () =>
      page.evaluate(() => Math.round(document.querySelector('aside.inspector')!.getBoundingClientRect().width))
    const w0 = await inspW()

    await pickLocale(page, 'ko')

    // KO: the option label is translated; the <select> VALUE is unchanged
    await expect(actSel).toHaveValue('passive')
    await expect(flowSel).toHaveValue('pullAny')
    await expect(actSel.locator('option[value="automatic"]')).toHaveText('자동')
    await expect(flowSel.locator('option[value="pushAny"]')).toHaveText('아무 경로로 보내기')
    // every <option value> is still the bare wire token
    const optValues = await page.evaluate(() =>
      [...document.querySelectorAll('aside.inspector select option')].map((o) => (o as HTMLOptionElement).value),
    )
    expect(optValues).toContain('pullAny')
    expect(optValues).toContain('automatic')
    expect(optValues.some((v) => /[가-힣]/.test(v))).toBe(false)

    // the switch alone fired no change / edit: GraphDoc, digest, undo, sim all held
    expect(await snapshot(page)).toEqual(before)
    // KO labels did not resize the Inspector
    expect(await inspW()).toBe(w0)

    await pickLocale(page, 'en')
    expect(await snapshot(page)).toEqual(before)
  })

  test('Slice 2b-1 chrome — Share button and React Flow controls localize', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    const shareBtn = page.locator('.toolbar__actions button', { hasText: /^Share$/ })
    const zoomIn = page.locator('.react-flow__controls-zoomin')
    await expect(shareBtn).toBeVisible()
    await expect(zoomIn).toHaveAttribute('aria-label', 'Zoom in')

    await pickLocale(page, 'ko')
    await expect(page.locator('.toolbar__actions button', { hasText: '공유' })).toBeVisible()
    await expect(zoomIn).toHaveAttribute('aria-label', '확대')
    await expect(page.locator('.react-flow__controls')).toHaveAttribute('aria-label', '캔버스 컨트롤')

    await pickLocale(page, 'en')
  })

  test('Slice 2b-2b — the Monte Carlo dialog localizes; a locale switch keeps its config', async ({
    page,
  }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    await page.locator('.pstrip__mc button').click()
    const dlg = page.locator('.mcdlg[role="dialog"]')
    await expect(dlg.locator('#mcdlg-title')).toHaveText('Monte Carlo')
    const cfg = () => page.evaluate(() => JSON.stringify((window as any).__loop.mc.getState().config))
    const before = await cfg()

    await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('ko'))
    await expect(dlg.locator('#mcdlg-title')).toHaveText('몬테카를로')
    await expect(dlg.getByRole('button', { name: /회 실행/ })).toBeVisible() // "Run N runs"
    expect(await cfg()).toBe(before) // opening a dialog + switching locale changed no config

    await page.evaluate(() => (window as any).__loop.i18n.getState().setLocale('en'))
  })
})

test.describe('i18n — the language MENU: geometry & baseline', () => {
  test('opening / using the menu changes no Toolbar height, viewport, node box, or edge d', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)

    const geom = () =>
      page.evaluate(() => {
        const tb = document.querySelector('.toolbar') as HTMLElement
        const nodeBoxes = [...document.querySelectorAll('.react-flow__node')].map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect()
          return [n.getAttribute('data-id'), Math.round(r.width), Math.round(r.height)]
        })
        const measured = (window as any).__loop.graph
          .getState()
          .nodes.map((n: any) => [n.id, n.measured?.width ?? n.width ?? null, n.measured?.height ?? n.height ?? null])
        return {
          toolbarH: Math.round((tb?.getBoundingClientRect().height ?? 0) * 10) / 10,
          viewport: (window as any).__loop.rf.getViewport(),
          nodeBoxes: JSON.stringify(nodeBoxes),
          measured: JSON.stringify(measured),
          d: [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((p) => p.getAttribute('d')),
        }
      })

    // wait until React Flow has measured the nodes and drawn the edge path, so
    // the baseline is the settled geometry (not a pre-measure frame).
    await expect
      .poll(async () => {
        const g = await geom()
        return g.d.every(Boolean) && !g.measured.includes('null')
      })
      .toBe(true)

    const before = await geom()
    // open the menu, move focus around, pick KO, reopen, pick EN
    await page.locator('.lang-switch').click()
    await expect(page.locator('.lang-menu__pop')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.locator('.lang-menu__item[data-locale="ko"]').click()
    await expect.poll(() => htmlLang(page)).toBe('ko')
    await pickLocale(page, 'en')

    expect(await geom()).toEqual(before)
  })
})

test.describe('i18n — the language MENU: a11y & N-locale generality', () => {
  test('Tab out of the open menu closes it and does not trap focus', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const trigger = page.locator('.toolbar .lang-switch')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.lang-menu__pop')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.locator('.lang-menu__pop')).toBeHidden()
    await expect(trigger).not.toBeFocused() // focus advanced past the trigger, not trapped
  })

  test('menu a11y contract — haspopup / expanded / menuitemradio / aria-checked / keyboard', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    const trigger = page.locator('.toolbar .lang-switch')
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Enter opens; focus lands on the active item; it is aria-checked
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = page.locator('.lang-menu__pop')
    await expect(menu).toHaveAttribute('role', 'menu')
    const items = menu.locator('[role="menuitemradio"]')
    await expect(items).toHaveCount(3) // en, ko, en-XA (dev pseudo)
    await expect(menu.locator('[data-locale="en"]')).toHaveAttribute('aria-checked', 'true')
    await expect(menu.locator('[data-locale="ko"]')).toHaveAttribute('aria-checked', 'false')

    // ArrowDown / End / Home move focus without changing the selection
    await page.keyboard.press('ArrowDown')
    await expect(menu.locator('[data-locale="ko"]')).toBeFocused()
    await page.keyboard.press('End')
    await expect(menu.locator('[data-locale="en-XA"]')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.locator('[data-locale="en"]')).toBeFocused()
    expect(await htmlLang(page)).toBe('en') // nothing selected yet

    // Escape closes and returns focus to the trigger
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()

    // Space opens, Enter on ko selects, focus returns to the trigger
    await page.keyboard.press(' ')
    await expect(page.locator('.lang-menu__pop')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect.poll(() => htmlLang(page)).toBe('ko')
    await expect(page.locator('.lang-menu__pop')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('a 3rd (dev pseudo) locale is directly selectable — no UI code change', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'en-XA')
    expect(await htmlLang(page)).toBe('en-XA')
    // the menu now checks en-XA
    await page.locator('.toolbar .lang-switch').click()
    await expect(page.locator('.lang-menu__item[data-locale="en-XA"]')).toHaveAttribute('aria-checked', 'true')
  })

  test('rapid selections settle on the last request; label / <html lang> / catalog agree', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.locator('.lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="ko"]').click()
    await page.locator('.lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="en"]').click()
    await page.locator('.lang-switch').click()
    await page.locator('.lang-menu__item[data-locale="ko"]').click()
    await page.waitForTimeout(200)

    const s = await page.evaluate(() => {
      const st = (window as any).__loop.i18n?.getState?.() ?? null
      return {
        lang: document.documentElement.lang,
        label: document.querySelector('.lang-switch span')?.textContent?.trim() ?? null,
        active: st?.activeLocale ?? null,
        loading: st?.loading ?? null,
      }
    })
    expect(s.lang).toBe('ko')
    expect(s.label).toBe('한국어')
    if (s.active != null) expect(s.active).toBe('ko')
    if (s.loading != null) expect(s.loading).toBe(false)
  })
})

test.describe('i18n — export / storage boundary (§L12 #5 extended)', () => {
  test('every export is byte-identical across ko → en → ko → en, and carries no locale token', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await importGraph(page, G)
    await page.evaluate(() => {
      const s = (window as any).__loop.sim.getState()
      s.advance()
      s.advance()
    })

    const capture = () =>
      page.evaluate(async () => {
        const l = (window as unknown as Bridge).__loop as any
        const g = l.graph.getState()
        const graphJSON = g.exportJSON({ runs: 200, steps: 30, baseSeed: 1 })
        const workspace = l.io.serializeWorkspaceFile(l.io.collectWorkspacePayload({ x: 0, y: 0, zoom: 1 }))
        const share = (await l.share.encodeShareText(graphJSON)).payload
        return {
          graphJSON,
          workspace,
          share,
          digest: l.revisionIO.currentTargetDigest(),
          series: JSON.stringify(l.sim.getState().series),
          labels: JSON.stringify([
            ...g.nodes.map((n: any) => [n.id, n.data.label ?? null]),
            ...g.edges.map((e: any) => [e.id, e.data?.label ?? null]),
          ]),
        }
      })

    const en1 = await capture()
    for (const code of ['ko', 'en', 'ko', 'en']) await pickLocale(page, code)
    const en2 = await capture()

    expect(en2).toEqual(en1)
    for (const [name, blob] of Object.entries(en2)) {
      for (const tok of ['loop-studio/ui-locale/1', 'activeLocale', 'requestedLocale', '"locale"', 'ui-locale']) {
        expect(blob, `${name} must not contain "${tok}"`).not.toContain(tok)
      }
    }
  })

  test('a `?lang=` dev override never propagates to a Share URL', async ({ page }) => {
    await page.goto('/?lang=ko')
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect.poll(() => htmlLang(page)).toBe('ko')
    const url = await page.evaluate(async () => {
      const l = (window as unknown as Bridge).__loop as any
      const enc = await l.share.encodeShareText(l.graph.getState().exportJSON())
      return `https://x/#${l.share.SHARE_PREFIX}${enc.payload}`
    })
    expect(url).not.toContain('lang=')
    expect(url).not.toContain('ui-locale')
  })
})

test.describe('i18n — the language menu on mobile (in the More sheet)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the same menu component, invoked from MobileMoreMenu', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()
    await pickLocale(page, 'ko', '.sheet')
    expect(await stored(page)).toBe('ko')
    await expect(page.locator('.toolbar__vr')).toHaveText('보기 및 실행 — 편집은 데스크톱에서')
  })

  test('the open menu stays inside the 390px viewport — no horizontal scroll', async ({ page }) => {
    await openApp(page)
    await resetAll(page)
    await page.locator('.mob-more').click()
    await expect(page.locator('.sheet')).toBeVisible()

    const trigger = page.locator('.sheet .lang-switch').first()
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const pop = page.locator('.sheet .lang-menu__pop')
    await expect(pop).toBeVisible()

    const box = await page.evaluate(() => {
      const r = document.querySelector('.sheet .lang-menu__pop')!.getBoundingClientRect()
      return {
        left: r.left,
        right: r.right,
        vw: document.documentElement.clientWidth,
        docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(box.left).toBeGreaterThanOrEqual(-1)
    expect(box.right).toBeLessThanOrEqual(box.vw + 1)
    expect(box.docScroll).toBeLessThanOrEqual(1)
  })
})
