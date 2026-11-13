import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'
import { measureFrames, openTemplateAt100, TEMPLATE_LOCALES } from './support/templateFrames'
import { openFileSubmenu, pickLocale, pickTemplate } from './support/workbenchMenus'

// The coffee roasting batch example (examples/coffee-roasting-batch.json), opened from
// File ▸ Templates as a user opens it: in Korean, with its kind, step length, six timetables
// and four numbered frames; the 19 steps the note names, ending where the discharge table
// ends; and in every shipped language its names inside their frames. The numbers
// themselves are pinned by test/coffee-roasting-batch.test.ts: every one is an example
// assumption, and the canvas holds the bean mass path only (no gas or heat equipment).

type Bridge = { __loop: Record<string, any> }

const NODES = 11
const FRAMES = ['f_charge', 'f_roast', 'f_cool', 'f_exhaust']
/** the stages that hold a run rule, so their run-rule line is drawn under their name */
const RULED = ['chaff_release', 'charge_drum', 'discharge_beans', 'drop_beans']
const POOLS = ['bean_hopper', 'roast_drum', 'cooling_tray', 'roasted_beans', 'released_chaff']
/** what the unit test pinned through the engine */
const pinned = JSON.parse(readFileSync(new URL('../examples/coffee-roasting-batch.expected.json', import.meta.url), 'utf8')) as {
  modelVersion: number
  checkpoints: { step: number; engine?: Record<string, number> }[]
}
const at = (step: number) => pinned.checkpoints.find((c) => c.step === step)!.engine!

async function open(page: Page) {
  await pickTemplate(page, 'coffee-roasting-batch')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(NODES)
}

/** the store's own advance, as Step does, up to `to`; a step the run refuses is not counted */
const advanceTo = (page: Page, to: number) =>
  page.evaluate(
    ([target, pools]) => {
      const l = (window as unknown as Bridge).__loop
      for (let i = l.sim.getState().stepIndex as number; i < (target as number); i++) l.sim.getState().advance()
      const s = l.sim.getState()
      return { step: s.stepIndex as number, values: Object.fromEntries((pools as string[]).map((p) => [p, s.values[p] as number])) }
    },
    [to, POOLS] as const,
  )

test.describe('the coffee roasting batch example', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await resetAll(page)
    await pickLocale(page, 'ko')
  })

  test('opens from File ▸ Templates in Korean, runs its 19 steps and ends where the discharge table ends', async ({ page }) => {
    const sub = await openFileSubmenu(page, 'templates')
    await expect(sub.locator('[data-template="coffee-roasting-batch"] .menu__name')).toHaveText('커피 로스팅 한 배치')
    // the row's description says what is and is not computed
    const descId = await sub.locator('[data-template="coffee-roasting-batch"]').getAttribute('aria-describedby')
    const desc = page.locator(`[id="${descId}"]`)
    await expect(desc).toContainText('가스와 열은 계산하지 않습니다')
    await expect(desc).toContainText('예시 가정')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await open(page)

    const m = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      const g = l.graph.getState()
      return {
        modelVersion: g.modelVersion as number,
        time: g.time,
        kinds: (g.kinds as { name: string; conserved: boolean }[]).map((k) => [k.name, k.conserved]),
        labels: Object.fromEntries((g.nodes as { id: string; data: { label: string } }[]).map((n) => [n.id, n.data.label])),
        frames: (l.frame.getState().frames as { label: string }[]).map((f) => f.label),
        tables: (g.timetables as { id: string; label: string; source: string }[]).map((t) => [t.id, t.label, t.source]),
      }
    })
    expect(m.modelVersion).toBe(pinned.modelVersion)
    expect(m.time).toEqual({ step: { value: 1, unit: 'min' }, display: 'min' })
    expect(m.kinds).toEqual([['coffee mass', true]])
    expect(m.labels).toMatchObject({ bean_hopper: '호퍼(생두)', roast_drum: '로스팅 드럼', chaff_release: '왕겨 배출', released_chaff: '배출 왕겨', roasted_beans: '로스팅 원두' })
    expect(m.frames).toEqual(['1 투입', '2 로스팅', '3 냉각', '4 배기·왕겨'])
    // every table says in Korean that it is an assumption
    expect(m.tables.map((t) => t[1])).toEqual(['투입 일정', '수분 배출', '휘발분 배출', '왕겨 배출', '드롭 일정', '냉각 완료 일정'])
    for (const t of m.tables) expect(t[2]).toBe('예시 가정이며 실측 자료가 아닙니다')
    await expect(page.getByText(/실행할 수 없/)).toHaveCount(0)

    // roasting ends with the 44.64 kg in the drum, the drop puts it in the tray, the four
    // cooling steps keep it there, and the discharge makes it Roasted beans
    for (const step of [13, 14, 18, 19]) {
      const got = await advanceTo(page, step)
      expect(got.step).toBe(step)
      for (const p of POOLS) expect(got.values[p], `${p} at step ${step}`).toBeCloseTo(at(step)[p]!, 9)
    }
    // a twentieth step is not taken: the last table has ended, and the run bar names it
    const after = await advanceTo(page, 20)
    expect(after.step).toBe(19)
    expect(after.values.roasted_beans).toBeCloseTo(44.64, 9)
    await expect(page.getByTestId('run-diagnostics')).toContainText('실행이 여기서 끝났어요')
    await expect(page.getByTestId('run-diagnostics')).toContainText('냉각 완료 일정')
  })

  test('opens with its four frames on the first screen of a 1280 window, the names readable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.rf.getViewport().zoom)).toBeGreaterThanOrEqual(0.5)
    const shown = await page.evaluate(() => {
      const l = (window as unknown as Bridge).__loop
      const v = l.rf.getViewport()
      const p = document.querySelector('.react-flow')!.getBoundingClientRect()
      return (l.frame.getState().frames as { rect: { x: number; y: number; w: number; h: number } }[]).every((f) => {
        const left = f.rect.x * v.zoom + v.x
        const top = f.rect.y * v.zoom + v.y
        return left >= -1 && top >= -1 && left + f.rect.w * v.zoom <= p.width + 1 && top + f.rect.h * v.zoom <= p.height + 1
      })
    })
    expect(shown, 'every frame is on the first screen').toBe(true)
  })
})

test.describe('the coffee roasting batch keeps its names inside its frames and apart', () => {
  for (const locale of TEMPLATE_LOCALES) {
    test(`${locale}: at 100 %, no name passes a frame edge or lies over another, and every line is routed`, async ({ page }) => {
      const routeWarnings: string[] = []
      page.on('console', (m) => {
        if (m.text().startsWith('[route]')) routeWarnings.push(m.text())
      })
      await openTemplateAt100(page, locale, 'coffee-roasting-batch', NODES)
      const r = await measureFrames(page, FRAMES)
      expect(r.frames).toBe(FRAMES.length)
      // every node sits in one of the four frames, so every one was checked
      expect(r.inFrames).toBe(r.nodes)
      // what was measured, by kind, so an empty result cannot pass for a clean one
      expect(r.measured.node, 'node boxes').toBeGreaterThanOrEqual(NODES)
      expect(r.measured.name, 'outside names').toBeGreaterThanOrEqual(NODES)
      expect(r.measured['run rule'], 'run-rule lines').toBeGreaterThanOrEqual(RULED.length)
      expect(r.ruled).toEqual(expect.arrayContaining(RULED))
      expect(r.problems, r.problems.join('\n')).toEqual([])
      expect(routeWarnings, routeWarnings.join('\n')).toEqual([])
    })
  }
})
