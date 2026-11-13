import type { Page } from '@playwright/test'
import { expect, importGraph, openApp, resetAll, test } from './support/loop'
import { TEMPLATE_LOCALES } from './support/templateFrames'
import { pickLocale, pickTemplate } from './support/workbenchMenus'

// docs/run-phases.md — the phase the document's author named for the current step, in the
// run row (desktop) and the run bar (phone), and in the playback announcement. Opened as a
// user opens it (File ▸ Templates ▸ Coffee roasting batch); a long name comes in through a
// file, as a person's own document would bring it.
//   - the step readout and every control keep their place at every step;
//   - a state wording comes first: the steady state, and the end;
//   - a name that has no room is never cut: every phase of the document is then a small
//     button whose press or focus opens the name and range;
//   - on a phone the name and range are a line above the controls, there only while there
//     is a phase to name;
//   - the announcer names the phase with the step when the phase changes.
// What a document's `phases` read and write as is in src/model/phases.test.ts; that the
// coffee batch's phases are its timetables' spans is in test/coffee-roasting-batch.test.ts.

type Bridge = { __loop: Record<string, any> }
const strip = (s: string | null) => (s ?? '').replace(/[⁦-⁩]/g, '')

async function openCoffee(page: Page, locale: string) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page)
  await resetAll(page)
  if (locale !== 'en') await pickLocale(page, locale)
  await pickTemplate(page, 'coffee-roasting-batch')
  const confirm = page.locator('.mcdlg--confirm .btn--primary')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.locator('.react-flow__node')).toHaveCount(11)
}
/** the store's own advance, as Step does, up to `to` */
const advanceTo = (page: Page, to: number) =>
  page.evaluate((to) => {
    const l = (window as unknown as Bridge).__loop
    while (l.sim.getState().stepIndex < to) {
      const before = l.sim.getState().stepIndex
      l.sim.getState().advance()
      if (l.sim.getState().stepIndex === before) break
    }
    return l.sim.getState().stepIndex as number
  }, to)
const sim = (page: Page, fn: 'advance' | 'reset' | 'play' | 'pause') => page.evaluate((f) => (window as unknown as Bridge).__loop.sim.getState()[f](), fn)
/** the open document again, through a file, with `name` as its browning phase: a name its author wrote */
async function reopenWithName(page: Page, name: string) {
  const text = await page.evaluate((name) => {
    const doc = JSON.parse((window as unknown as Bridge).__loop.graph.getState().exportJSON())
    doc.phases = doc.phases.map((p: { id: string }) => (p.id === 'roast_browning' ? { ...p, label: name } : p))
    return JSON.stringify(doc)
  }, name)
  await importGraph(page, text)
}
const phaseEl = (page: Page) => page.getByTestId('run-phase')

/** the desktop row: where the step readout, the state room and the control after it are */
const row = (page: Page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.pstrip:not(.pstrip--mobile)') as HTMLElement
    const r = strip.getBoundingClientRect()
    const left = (sel: string) => {
      const el = strip.querySelector(sel) as HTMLElement | null
      return el && el.getClientRects().length > 0 ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null
    }
    const inFlow = [...strip.children].filter((c) => getComputedStyle(c).position !== 'absolute' && (c as HTMLElement).getClientRects().length > 0)
    const shown = strip.querySelector('[data-testid="run-phase"]') as HTMLElement | null
    const name = strip.querySelector('.pstrip__phase:not(.pstrip__phase--probe) .pstrip__phase-name') as HTMLElement | null
    const holder = name?.parentElement
    return {
      fit: strip.dataset.fit ?? '0',
      places: [left('.pstrip__step'), left('.pstrip__state'), Math.round((strip.querySelector('.pstrip__state') as HTMLElement).getBoundingClientRect().width * 10) / 10, left('.pstrip__settings-btn') ?? left('.pstrip__settings'), left('.pstrip__collapse')].join('|'),
      form: shown ? (shown.tagName === 'BUTTON' ? 'button' : 'name') : 'none',
      phase: shown?.dataset.phase ?? null,
      // a name is whole when its own box lies inside the box that holds it
      nameCut: name && holder ? name.getBoundingClientRect().right > holder.getBoundingClientRect().right + 0.5 || name.getBoundingClientRect().left < holder.getBoundingClientRect().left - 0.5 : false,
      overflow: inFlow.some((c) => c.getBoundingClientRect().right > r.right + 0.5 || c.getBoundingClientRect().left < r.left - 0.5),
    }
  })

/** the phone bar: its height, the phase line, and how far above the window's foot Play starts */
const bar = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.pstrip--mobile') as HTMLElement
    const line = el.querySelector('.pstrip__phase-line') as HTMLElement | null
    const lb = line?.getBoundingClientRect()
    const play = (el.querySelector('.pb-btn--primary') as HTMLElement).getBoundingClientRect()
    return {
      height: Math.round(el.getBoundingClientRect().height * 10) / 10,
      line: line ? line.innerText.replace(/[⁦-⁩]/g, '') : null,
      lineCut: line && lb ? line.scrollWidth > line.clientWidth + 0.5 || lb.right > window.innerWidth + 0.5 || lb.left < -0.5 : false,
      playUp: Math.round((window.innerHeight - play.top) * 10) / 10,
      scrollX: document.documentElement.scrollWidth > window.innerWidth,
    }
  })

test.describe('run phases — the desktop run row', () => {
  test('names the phase of the current step beside the step, moves nothing, and gives way to the end', async ({ page }) => {
    await openCoffee(page, 'ko')
    const step = page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step')
    await expect(step).toHaveText('0단계')
    await expect(phaseEl(page)).toHaveCount(0) // before the first step there is no phase to name

    const seen = [await row(page)]
    const expectAt = async (n: number, name: string, range: string) => {
      await advanceTo(page, n)
      await expect(step).toHaveText(`${n}단계`)
      await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText(name)
      // the tooltip: the name with its steps, and that it is the author's guide
      const title = strip(await phaseEl(page).getAttribute('title'))
      expect(title.split('\n')).toEqual([`${name} (${range})`, '문서 작성자가 이름 붙인 구간입니다. 안내이며, 실행이 계산한 결과가 아닙니다.'])
      // a screen reader reads the name with its range; the short name alone is not read twice
      expect(strip(await phaseEl(page).locator('.sr-only').textContent())).toBe(`${name} 구간, ${range}`)
      await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveAttribute('aria-hidden', 'true')
      seen.push(await row(page))
    }
    await expectAt(1, '투입', '1단계')
    await expectAt(2, '건조', '2–5단계')
    await expectAt(5, '건조', '2–5단계')
    await expectAt(8, '갈변', '6–9단계')
    await expectAt(12, '발달', '10–13단계')
    await expectAt(14, '드롭', '14단계')
    await expectAt(16, '냉각', '15–18단계')
    await expectAt(19, '냉각 완료', '19단계')
    // from step 0 to step 19: one form, nothing cut, and no control moved
    expect(seen.slice(1).every((m) => m.form === 'name' && !m.nameCut && !m.overflow)).toBe(true)
    expect(new Set(seen.map((m) => m.places)).size).toBe(1)

    // one more press: the run ends, the step readout says so, and no phase is shown
    await sim(page, 'advance')
    await expect(step).toHaveText('19단계 · 종료됨')
    await expect(phaseEl(page)).toHaveCount(0)
    await sim(page, 'reset')
    await expect(phaseEl(page)).toHaveCount(0)
  })

  test('the names follow the language of the screen, at once', async ({ page }) => {
    await openCoffee(page, 'ko')
    await advanceTo(page, 8)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('갈변')
    await pickLocale(page, 'en')
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Browning')
    expect(strip(await phaseEl(page).getAttribute('title')).split('\n')[0]).toBe('Browning (steps 6–9)')
    // a name is not the model: the run was not reset by the switch
    await expect(page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step')).toHaveText('step 8')
  })

  test('the phases stay with the document through a reload', async ({ page }) => {
    await openCoffee(page, 'ko')
    await page.evaluate(() => (window as unknown as Bridge).__loop.autosave.flush())
    await page.reload()
    await page.waitForFunction(() => Boolean((window as unknown as Bridge).__loop))
    await expect(page.locator('.react-flow__node')).toHaveCount(11)
    await advanceTo(page, 8)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('갈변')
  })

  test('a document without phases shows none, and its row is as it was', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
    await resetAll(page)
    await pickTemplate(page, 'desalination')
    const confirm = page.locator('.mcdlg--confirm .btn--primary')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await advanceTo(page, 5)
    await expect(phaseEl(page)).toHaveCount(0)
    await expect(page.locator('.pstrip__phase')).toHaveCount(0) // not even the unseen measure
    // the state room is the steady chip's own box
    const same = await page.evaluate(() => {
      const room = (document.querySelector('.pstrip__state') as HTMLElement).getBoundingClientRect()
      const chip = (document.querySelector('.pstrip__steady') as HTMLElement).getBoundingClientRect()
      return Math.abs(room.left - chip.left) < 0.5 && Math.abs(room.width - chip.width) < 0.5
    })
    expect(same).toBe(true)
  })

  test('the steady state comes first: while it is shown the phase is not, and it comes back with the pause', async ({ page }) => {
    // Source ─4→ Pool ─all→ Drain settles after the drain engages; one phase covers the run
    const STEADY = JSON.stringify({
      schema: 'loop-studio/graph',
      version: 1,
      nodes: [
        { id: 's', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'S', activation: 'automatic', mode: 'pushAny' } },
        { id: 'p', type: 'pool', position: { x: 220, y: 0 }, data: { kind: 'pool', label: 'P', activation: 'passive', initial: 0, capacity: null, mode: 'pullAny' } },
        { id: 'd', type: 'drain', position: { x: 440, y: 0 }, data: { kind: 'drain', label: 'D', activation: 'automatic', mode: 'pullAny' } },
      ],
      edges: [
        { id: 'e_sp', type: 'loop', source: 's', target: 'p', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: '4' } },
        { id: 'e_pd', type: 'loop', source: 'p', target: 'd', sourceHandle: 'out', targetHandle: 'in', data: { kind: 'resource', flow: 'all' } },
      ],
      phases: [{ id: 'hold', label: 'Hold', from: 1, to: 10000 }],
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await openApp(page)
    await resetAll(page)
    await importGraph(page, STEADY)
    await sim(page, 'reset')
    await sim(page, 'advance')
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Hold')
    const places = (await row(page)).places
    for (let i = 0; i < 12; i++) {
      await sim(page, 'advance')
      if (await page.evaluate(() => (window as unknown as Bridge).__loop.sim.getState().steadyState as boolean)) break
    }
    // settled but paused: the chip is not shown, so the phase still is
    await expect(page.locator('.pstrip__steady')).not.toHaveClass(/is-on/)
    await expect(phaseEl(page)).toHaveCount(1)
    await sim(page, 'play')
    await expect(page.locator('.pstrip__steady')).toHaveClass(/is-on/)
    await expect(phaseEl(page)).toHaveCount(0)
    expect((await row(page)).places).toBe(places)
    await sim(page, 'pause')
    await expect(page.locator('.pstrip__steady')).not.toHaveClass(/is-on/)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Hold')
    expect((await row(page)).places).toBe(places)
  })
})

test.describe('run phases — a name that has no room', () => {
  test('one long name makes every phase of the document a button; its press or focus opens the name and range', async ({ page }) => {
    await openCoffee(page, 'en')
    await reopenWithName(page, 'Browning up to just before the first crack begins')
    const seen = []
    for (const n of [1, 4, 8, 12, 19]) {
      await advanceTo(page, n)
      seen.push(await row(page))
    }
    // "Charge" would fit, and is a button too: the form is the document's, not the name's
    expect(seen.map((m) => m.form)).toEqual(['button', 'button', 'button', 'button', 'button'])
    expect(new Set(seen.map((m) => m.places)).size).toBe(1)
    expect(seen.every((m) => !m.overflow)).toBe(true)

    await sim(page, 'reset')
    await advanceTo(page, 8)
    const btn = phaseEl(page)
    const pop = page.getByTestId('run-phase-pop')
    // nothing is only in the popover: the name and range are the button's name, the guide sentence its description
    expect(strip(await btn.getAttribute('aria-label'))).toBe('Browning up to just before the first crack begins phase, steps 6–9')
    await expect(btn).toHaveAccessibleDescription('A phase named by the author of the document: a guide, not a result the run computed.')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(pop).toHaveCount(0)

    // the keyboard: focus opens it, Escape closes it and leaves the focus, Enter opens and closes it
    // (Tab from Play reaches it next, or after the Observation toggle where the row shows that)
    await page.locator('.pstrip:not(.pstrip--mobile) .pb-btn--primary').focus()
    await page.keyboard.press('Tab')
    if (!(await btn.evaluate((el) => el === document.activeElement))) await page.keyboard.press('Tab')
    await expect(btn).toBeFocused()
    await expect(pop).toBeVisible()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(strip(await pop.locator('.pstrip__phase-pop-name').textContent())).toBe('Browning up to just before the first crack begins (steps 6–9)')
    await expect(pop.locator('.pstrip__phase-pop-note')).toHaveText('A phase named by the author of the document: a guide, not a result the run computed.')
    const box = await pop.evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { inWindow: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0, cut: el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5 }
    })
    expect(box).toEqual({ inWindow: true, cut: false })
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(btn).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(pop).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(pop).toHaveCount(0)
    await expect(btn).toBeFocused()

    // the pointer: a press opens it and it stays; a press elsewhere closes it
    await page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step').click()
    await expect(pop).toHaveCount(0)
    await btn.click()
    await expect(pop).toBeVisible()
    await page.mouse.move(10, 10)
    await expect(pop).toBeVisible()
    await page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step').click()
    await expect(pop).toHaveCount(0)

    // the run ends with the focus on the button: the button goes, and the focus goes to Play
    await btn.focus()
    await advanceTo(page, 19)
    await sim(page, 'advance')
    await expect(phaseEl(page)).toHaveCount(0)
    await expect(page.locator('.pstrip:not(.pstrip--mobile) .pb-btn--primary')).toBeFocused()
  })

  test('it is judged again when the window changes: names where they fit, the button where the room is short', async ({ page }) => {
    await openCoffee(page, 'en')
    await advanceTo(page, 8)
    expect((await row(page)).form).toBe('name')
    // a narrow desktop window: the row's last fit step shortens the state room
    await page.setViewportSize({ width: 900, height: 800 })
    await expect.poll(async () => (await row(page)).fit).toBe('4')
    await expect.poll(async () => (await row(page)).form).toBe('button')
    expect((await row(page)).overflow).toBe(false)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect.poll(async () => (await row(page)).form).toBe('name')
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Browning')
  })
})

test.describe('run phases — the phone run bar', () => {
  test('a line above the controls while a phase is under way; none before the first step, at the end, or without phases', async ({ page }) => {
    await openCoffee(page, 'ko')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.pstrip--mobile')).toBeVisible()
    const before = await bar(page)
    expect(before.line).toBeNull()

    await advanceTo(page, 1)
    await expect(page.locator('.pstrip--mobile').getByTestId('run-phase')).toBeVisible()
    const first = await bar(page)
    expect(first.line).toBe('투입 (1단계)')
    await advanceTo(page, 8)
    const mid = await bar(page)
    expect(mid.line).toBe('갈변 (6–9단계)')
    // the line is added above: the bar is taller by it, and the controls are where they were
    expect(mid.height).toBeGreaterThan(before.height)
    expect(mid.height).toBe(first.height)
    expect([first.playUp, mid.playUp]).toEqual([before.playUp, before.playUp])
    expect(mid.lineCut || mid.scrollX).toBe(false)
    // the bar's measured height is what the rest of the page keeps clear
    const kept = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mob-runbar-real')))
    expect(Math.abs(kept - mid.height)).toBeLessThanOrEqual(1)

    // the end: only the end stays
    await advanceTo(page, 19)
    await sim(page, 'advance')
    await expect(page.locator('.pstrip--mobile .pstrip__phase-line')).toHaveCount(0)
    // the same document without its phases ends at the same height
    const ended = await bar(page)
    await page.evaluate(() => (window as unknown as Bridge).__loop.graph.setState({ phases: [] }))
    expect(await bar(page)).toEqual(ended)
    await sim(page, 'reset')
    await advanceTo(page, 8)
    const none = await bar(page)
    expect(none.line).toBeNull()
    expect(none.height).toBe(before.height)
  })
})

test.describe('run phases — the playback announcement', () => {
  test('a step names its phase when the phase changes, and the end names none', async ({ page }) => {
    await openCoffee(page, 'ko')
    const live = page.locator('[data-playback-announce]')
    const text = async () => strip(await live.textContent())
    const press = page.locator('.pstrip:not(.pstrip--mobile) .pstrip__step-btn')
    await press.click()
    await expect.poll(text).toBe('1단계, 투입 구간')
    await press.click()
    await expect.poll(text).toBe('2단계, 건조 구간')
    await press.click()
    await expect.poll(text).toBe('3단계') // the same phase is not named again
    await advanceTo(page, 5)
    await press.click()
    await expect.poll(text).toBe('6단계, 갈변 구간')
    await advanceTo(page, 18)
    await press.click()
    await expect.poll(text).toBe('19단계, 냉각 완료 구간')
    await press.click()
    await expect.poll(text).toBe('19단계에서 종료됨')
    // after Reset the first step names its phase again
    await page.locator('.pstrip:not(.pstrip--mobile) .pstrip__reset').click()
    await press.click()
    await expect.poll(text).toBe('1단계, 투입 구간')
  })
})

// SEMANTICS-R13.md — phases are revision content. The coffee batch is the open project; a
// proposal moves the drying / browning boundary from minute 5 to minute 7 in the three
// release tables, with or without moving its phases (Drying 2–7, Browning 8–9) too.
type Change = { tables?: boolean; phases?: boolean; rename?: boolean }
const NOTICE_TIMING = 'The timetables or the step length change, and the phase names stay as they are. After this Apply, the current phase shown may differ from the real process.'
const NOTICE_PHASES = 'The phase names are taken, but the timetables and the step length stay yours. After this Apply, the current phase shown may differ from the real process.'
const NOTE_CHOOSE = 'The proposal’s timetables or step length differ from yours. Choosing changes does not take them: only applying the whole proposal does.'

/** commit the open document as a project revision, and build a proposal of it with `change`, its digest honest */
const makeProposal = (page: Page, change: Change) =>
  page.evaluate(async (change) => {
    const M = await import('/src/model/revision.ts')
    const S = await import('/src/model/serialize.ts')
    const P = (window as unknown as Bridge).__loop.project.getState()
    P.commitRevisionExport(P.planRevision({}).plan)
    const f = JSON.parse((window as unknown as Bridge).__loop.project.getState().planProposal({}).text)
    if (change.tables) {
      for (const t of f.timetables) if (['moisture', 'volatiles', 'chaff'].includes(t.id)) t.points = t.points.map((p: [string, string]) => (p[0] === '5' ? ['7', p[1]] : p))
    }
    if (change.phases) f.phases = f.phases.map((p: { id: string }) => (p.id === 'roast_drying' ? { ...p, to: 7 } : p.id === 'roast_browning' ? { ...p, from: 8 } : p))
    if (change.rename) f.phases = f.phases.map((p: { id: string }) => (p.id === 'roast_browning' ? { ...p, label: 'Maillard' } : p))
    const d = S.deserialize(JSON.stringify(f))
    f.project.contentDigest = M.digestOfCanonical(
      M.canonicalContent({ nodes: d.nodes, edges: d.edges, recommendedRunConfig: d.recommendedRunConfig, frames: d.frames, dataImports: d.dataImports, kinds: d.kinds, time: d.time, timetables: d.timetables, phases: d.phases }, { modelVersion: d.modelVersion }),
    )
    return JSON.stringify(f)
  }, change)
const importFile = (page: Page, text: string) => page.setInputFiles('.toolbar__actions input[type=file]', { name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') })
/** the open document: where its release tables change rate, and its two roasting phases */
const docState = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as Bridge).__loop.graph.getState()
    return {
      boundary: g.timetables.find((t: { id: string }) => t.id === 'moisture').points[2][0] as string,
      phases: (g.phases as { id: string; label: string; from: number; to: number }[]).filter((p) => p.id === 'roast_drying' || p.id === 'roast_browning').map((p) => `${p.label} ${p.from}–${p.to}`),
    }
  })
const undo = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().undo())

test.describe('run phases — a revision review', () => {
  test.beforeEach(async ({ page }) => {
    await openCoffee(page, 'en')
    await page.evaluate(() => {
      const L = (window as unknown as Bridge).__loop
      L.project.getState().clear()
      L.review.getState().close()
    })
  })

  test('a proposal that moved its timetables and its phases: both are named, the Apply takes both, and one Undo takes both back', async ({ page }) => {
    await importFile(page, await makeProposal(page, { tables: true, phases: true }))
    const review = page.locator('.review')
    await expect(review).toBeVisible()
    // the summary names what differs: before, a change of the timetables alone read "No graph changes"
    await expect(review.locator('.review__diff [data-diff="timetables"]')).toHaveText('Timetables')
    await expect(review.locator('.review__diff [data-diff="phases"]')).toHaveText('phases')
    await expect(review.locator('.review__diff')).not.toContainText('No graph changes')
    // names and timing come from the same side: nothing to warn of
    await expect(page.getByTestId('review-phase-notice')).toHaveCount(0)

    await review.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(review).toBeHidden()
    expect(await docState(page)).toEqual({ boundary: '7', phases: ['Drying 2–7', 'Browning 8–9'] })
    await advanceTo(page, 6)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Drying') // it was Browning before the Apply
    await advanceTo(page, 8)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Browning')

    await undo(page)
    expect(await docState(page)).toEqual({ boundary: '5', phases: ['Drying 2–5', 'Browning 6–9'] })
    await advanceTo(page, 6)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Browning')
  })

  test('the proposer moved the timetables and left the phases: the review says what follows, and asks nothing more', async ({ page }) => {
    await importFile(page, await makeProposal(page, { tables: true }))
    const review = page.locator('.review')
    await expect(review).toBeVisible()
    await expect(review.locator('.review__diff [data-diff="timetables"]')).toHaveText('Timetables')
    await expect(review.locator('.review__diff [data-diff="phases"]')).toHaveCount(0)
    const notice = page.getByTestId('review-phase-notice')
    await expect(notice).toHaveText(NOTICE_TIMING)
    await expect(notice).toHaveAttribute('data-split', 'timing-only')

    // a notice, not a gate: one press applies, with no confirmation in between
    await review.locator('.review__actions button', { hasText: 'Apply proposal' }).click()
    await expect(review).toBeHidden()
    await expect(page.locator('.mcdlg--confirm')).toHaveCount(0)
    expect(await docState(page)).toEqual({ boundary: '7', phases: ['Drying 2–5', 'Browning 6–9'] })
    // what the notice said: step 6 is named Browning on tables that still release at the drying rate
    await advanceTo(page, 6)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Browning')
  })

  test('choosing changes: the timetables are not taken and it says so; the phases line starts on "keep mine", and taking it warns first', async ({ page }) => {
    await importFile(page, await makeProposal(page, { tables: true, phases: true }))
    const review = page.locator('.review')
    await expect(review).toBeVisible()
    await review.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    await expect(page.getByTestId('review-timing-note')).toHaveText(NOTE_CHOOSE)
    const row = review.locator('.review__hunk', { hasText: 'Run phases' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Take the proposal’s phases (yours: 7, the proposal’s: 7)')
    const box = row.locator('input[type=checkbox]')
    // clean, but the proposal's timetables differ: kept by default
    await expect(box).not.toBeChecked()
    await expect(page.getByTestId('review-phase-notice')).toHaveCount(0)

    await box.check()
    await expect(page.getByTestId('review-phase-notice')).toHaveText(NOTICE_PHASES)
    await expect(page.getByTestId('review-phase-notice')).toHaveAttribute('data-split', 'phases-only')
    await box.uncheck()
    await expect(page.getByTestId('review-phase-notice')).toHaveCount(0)

    // keeping mine with nothing else chosen changes nothing, and is said to
    await review.locator('.review__actions button', { hasText: /^Apply \d+ selected/ }).click()
    await expect(review).toBeVisible()
    expect(await docState(page)).toEqual({ boundary: '5', phases: ['Drying 2–5', 'Browning 6–9'] })

    // taking the phases: the proposal's names on this document's tables, as warned; one Undo takes them back
    await box.check()
    await review.locator('.review__actions button', { hasText: /^Apply 1 selected/ }).click()
    await expect(review).toBeHidden()
    expect(await docState(page)).toEqual({ boundary: '5', phases: ['Drying 2–7', 'Browning 8–9'] })
    await undo(page)
    expect(await docState(page)).toEqual({ boundary: '5', phases: ['Drying 2–5', 'Browning 6–9'] })
  })

  test('a proposal that only renames a phase: the line is pre-selected, nothing is warned of, and the row shows the new name', async ({ page }) => {
    await importFile(page, await makeProposal(page, { rename: true }))
    const review = page.locator('.review')
    await expect(review).toBeVisible()
    await expect(review.locator('.review__diff [data-diff="phases"]')).toHaveText('phases')
    await expect(review.locator('.review__diff [data-diff="timetables"]')).toHaveCount(0)
    await review.locator('.review__actions button', { hasText: 'Choose changes' }).click()
    await expect(page.getByTestId('review-timing-note')).toHaveCount(0)
    await expect(review.locator('.review__hunk')).toHaveCount(1)
    await expect(review.locator('.review__hunk input[type=checkbox]')).toBeChecked()
    await expect(page.getByTestId('review-phase-notice')).toHaveCount(0)
    await review.locator('.review__actions button', { hasText: /^Apply 1 selected/ }).click()
    await expect(review).toBeHidden()
    await advanceTo(page, 8)
    await expect(phaseEl(page).locator('.pstrip__phase-name')).toHaveText('Maillard')
  })
})

// Every shipped language: the Template's own names, and one long name its author might
// write, on the desktop row and on the narrower phone (360 px).
const LONG: Record<string, string> = {
  ko: '갈변이 진행되어 1차 크랙 직전에 이르기까지의 구간',
  en: 'Browning up to just before the first crack begins',
  de: 'Bräunung bis kurz vor Beginn des ersten Cracks',
  fr: 'Brunissement jusqu’au début du premier crack',
  ru: 'Потемнение вплоть до начала первого крэка',
  'es-419': 'Pardeamiento hasta justo antes del primer crack',
  'es-ES': 'Pardeamiento hasta justo antes del primer crack',
  it: 'Imbrunimento fino a poco prima del primo crack',
  ja: '褐変が進み1ハゼの直前に至るまでの区間のすべて',
  nl: 'Bruinen tot vlak voor het begin van de eerste crack',
  'pt-BR': 'Escurecimento até pouco antes do primeiro crack',
  'pt-PT': 'Escurecimento até pouco antes do primeiro crack',
  th: 'ช่วงเปลี่ยนเป็นสีน้ำตาลไปจนถึงก่อนแครกแรกเริ่มขึ้น',
  tr: 'İlk çıtlamanın hemen öncesine kadar süren esmerleşme',
  vi: 'Hóa nâu cho đến ngay trước khi tiếng nổ đầu bắt đầu',
  'zh-Hans': '褐变持续进行直到一爆即将开始之前的整个阶段',
  'zh-Hant': '褐變持續進行直到一爆即將開始之前的整個階段',
  ar: 'الاسمرار حتى قبيل بداية الفرقعة الأولى مباشرة',
}

test.describe('run phases — every language', () => {
  for (const locale of TEMPLATE_LOCALES) {
    test(`${locale}: no name is cut and no control moves, with the Template's names and with a long one`, async ({ page }) => {
      await openCoffee(page, locale)
      const STEPS = [1, 4, 8, 12, 14, 16, 19]
      // desktop, the Template's own names
      const own = [await row(page)]
      for (const n of STEPS) {
        await advanceTo(page, n)
        own.push(await row(page))
      }
      expect(own[0]!.form).toBe('none')
      expect(new Set(own.slice(1).map((m) => m.form)).size, 'one form for the whole document').toBe(1)
      expect(own.slice(1).every((m) => m.phase !== null && !m.nameCut && !m.overflow)).toBe(true)
      expect(new Set(own.map((m) => m.places)).size, 'no control moves from step 0 to step 19').toBe(1)

      // desktop, a long name: the button at every phase, and its popover whole inside the window
      await sim(page, 'reset')
      await reopenWithName(page, LONG[locale]!)
      const long = []
      for (const n of STEPS) {
        await advanceTo(page, n)
        long.push(await row(page))
      }
      expect(long.map((m) => m.form)).toEqual(STEPS.map(() => 'button'))
      expect(new Set(long.map((m) => m.places)).size).toBe(1)
      expect(long.every((m) => !m.overflow)).toBe(true)
      await sim(page, 'reset')
      await advanceTo(page, 8)
      await phaseEl(page).click()
      const pop = page.getByTestId('run-phase-pop')
      await expect(pop).toBeVisible()
      expect(strip(await pop.locator('.pstrip__phase-pop-name').textContent())).toContain(LONG[locale]!)
      const box = await pop.evaluate((el) => {
        const b = el.getBoundingClientRect()
        return { inWindow: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0, cut: el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5 }
      })
      expect(box).toEqual({ inWindow: true, cut: false })

      // the phone, 360 wide, the long name: the line wraps whole, and the controls are where
      // they are before the first step
      await sim(page, 'reset')
      await page.setViewportSize({ width: 360, height: 800 })
      await expect(page.locator('.pstrip--mobile')).toBeVisible()
      const before = await bar(page)
      expect(before.line).toBeNull()
      await advanceTo(page, 4)
      const short = await bar(page)
      await advanceTo(page, 8)
      const wide = await bar(page)
      expect(short.line).not.toBeNull()
      expect(wide.line).toContain(LONG[locale]!)
      expect([short.lineCut, short.scrollX, wide.lineCut, wide.scrollX]).toEqual([false, false, false, false])
      expect([short.playUp, wide.playUp]).toEqual([before.playUp, before.playUp])
    })
  }
})
