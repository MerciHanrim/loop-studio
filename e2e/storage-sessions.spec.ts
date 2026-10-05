import type { Page } from '@playwright/test'
import { expect, openApp, resetAll, test } from './support/loop'

// Issue #297 — the Storage and privacy area, the temporary-session chip, the
// switches between the two kinds of session, the two deletions, the share
// dialog's facts and the loss warning. The storage gate itself and the
// "nothing is read or written" proofs are in storage-port-runtime.spec.ts;
// this spec starts behind the gate (the fixture remembers a personal
// browser) and reads the browser's storage from the outside to say exactly
// what each action changed.
//
// Two things a personal browser writes on its own, which a snapshot has to be
// taken AFTER: opening Settings mounts the theme toggle, whose effect records
// the current theme; emptying the canvas shows the empty-canvas hint, which
// records itself as seen. Both are the ordinary autosave posture of a personal
// browser, and neither is what these tests are about.

const WORK = 'loop-studio:graph:v1'
const MODE = 'loop-studio:storage-mode'

type Bridge = { __loop: { graph: { getState: () => { nodes: unknown[]; addNodeAt: (k: string, p: { x: number; y: number }) => void } }; storage: { mode: () => string } } }

/** every Loop Studio entry, as `[key, value]`, sorted: a snapshot to compare byte for byte */
const stored = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('loop-studio'))
      .sort()
      .map((k) => [k, localStorage.getItem(k)]),
  )
const storedKeys = async (page: Page) => (await stored(page)).map(([k]) => k)
const storedWorkNodes = async (page: Page): Promise<number | null> => {
  const raw = (await stored(page)).find(([k]) => k === WORK)?.[1]
  return raw ? (JSON.parse(raw).nodes as unknown[]).length : null
}
const mode = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.storage.mode())
const nodeCount = (page: Page) => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.length)
/** one real node, and its autosave landed */
async function makeWork(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().addNodeAt('pool', { x: 40, y: 40 }))
  await page.waitForTimeout(600)
}
/** the app, an empty canvas, one node: a known document of exactly one node */
async function openWithOneNode(page: Page): Promise<void> {
  await openApp(page)
  await resetAll(page)
  await makeWork(page)
  expect(await nodeCount(page)).toBe(1)
}
const settingsButton = (page: Page) => page.locator('.toolbar__settingsmenu > button')
const dialog = (page: Page) => page.locator('.mcdlg--storage')
const chip = (page: Page) => page.locator('[data-session-chip="temporary"]')

async function openStorageArea(page: Page): Promise<void> {
  await settingsButton(page).click()
  await page.locator('[data-settings-row="storage-privacy"]').click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toHaveAttribute('data-storage-step', 'menu')
}
/** press an action, land on its step (export offer + Cancel + Confirm), press Confirm */
async function confirmAction(page: Page, action: string): Promise<void> {
  await dialog(page).locator(`[data-storage-action="${action}"]`).click()
  await expect(dialog(page)).not.toHaveAttribute('data-storage-step', 'menu')
  await expect(dialog(page).locator('[data-storage-export]')).toBeVisible()
  await expect(dialog(page).locator('[data-storage-confirm]')).toBeVisible()
  await dialog(page).locator('[data-storage-confirm]').click()
}

test.describe('the Storage and privacy area', () => {
  test('shows the mode, the statement and the five items; the restore toggle is the remembered mode key; focus returns to Settings', async ({ page }) => {
    await openApp(page)
    await openStorageArea(page)
    await expect(dialog(page).locator('[data-storage-mode]')).toHaveAttribute('data-storage-mode', 'personal')
    await expect(dialog(page)).toContainText('author name and note')
    await expect(dialog(page)).toContainText('imported spreadsheet')
    for (const a of ['to-temporary', 'copy', 'delete-work', 'reset-all']) await expect(dialog(page).locator(`[data-storage-action="${a}"]`)).toBeVisible()
    const restore = dialog(page).locator('[data-storage-toggle="restore"]')
    await expect(restore).toBeChecked() // the fixture remembered a personal browser
    await restore.uncheck()
    expect(await page.evaluate((k) => localStorage.getItem(k), MODE)).toBeNull()
    await restore.check()
    expect(await page.evaluate((k) => localStorage.getItem(k), MODE)).toBe('personal')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(settingsButton(page)).toBeFocused()
  })

  test('a step cancels back to the area without doing anything', async ({ page }) => {
    await openWithOneNode(page)
    await openStorageArea(page)
    const before = await stored(page)
    await dialog(page).locator('[data-storage-action="delete-work"]').click()
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'deleteWork')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'menu')
    await dialog(page).locator('[data-storage-action="reset-all"]').click()
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'menu')
    expect(await stored(page)).toEqual(before)
    expect(await nodeCount(page)).toBe(1)
  })
})

test.describe('switching sessions', () => {
  test('personal → temporary (start empty): the canvas empties, the chip appears, and the browser keeps its document untouched', async ({ page }) => {
    await openWithOneNode(page)
    await openStorageArea(page)
    const before = await stored(page)
    await confirmAction(page, 'to-temporary')
    await expect(dialog(page)).toHaveCount(0)
    expect(await mode(page)).toBe('temporary')
    expect(await nodeCount(page)).toBe(0)
    await expect(chip(page)).toBeVisible()
    // work in the session reaches the browser nowhere
    await makeWork(page)
    await makeWork(page)
    expect(await nodeCount(page)).toBe(2)
    expect(await stored(page)).toEqual(before)
    expect(await storedWorkNodes(page)).toBe(1)
  })

  test('personal → temporary (take the diagram along): the diagram stays open and is saved no more', async ({ page }) => {
    await openWithOneNode(page)
    await openStorageArea(page)
    const before = await stored(page)
    await confirmAction(page, 'copy')
    expect(await mode(page)).toBe('temporary')
    expect(await nodeCount(page)).toBe(1)
    await expect(chip(page)).toBeVisible()
    await makeWork(page)
    expect(await nodeCount(page)).toBe(2)
    expect(await stored(page)).toEqual(before) // the stored copy: the one node, as it was
    expect(await storedWorkNodes(page)).toBe(1)
  })

  test('temporary → personal through the chip: the first write replaces the stored document, after the confirmation', async ({ page }) => {
    await openWithOneNode(page)
    await openStorageArea(page)
    await confirmAction(page, 'to-temporary')
    await makeWork(page)
    await makeWork(page)
    const before = await stored(page)
    expect(await storedWorkNodes(page)).toBe(1)
    // the chip's menu: export, save here, the area
    await chip(page).click()
    const menu = page.locator('.session-chip__pop')
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    await menu.getByRole('menuitem', { name: /Save in this browser/ }).click()
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'toPersonal')
    expect(await stored(page)).toEqual(before) // nothing yet
    await dialog(page).locator('[data-storage-confirm]').click()
    await expect(dialog(page)).toHaveCount(0)
    expect(await mode(page)).toBe('personal')
    await expect(chip(page)).toHaveCount(0)
    expect(await storedWorkNodes(page)).toBe(2)
  })

  // the chip is a control in the toolbar row: drawn as the menu button beside
  // it (28 px, the 8 px control radius, 12 px text, its ink on its raised
  // face), centred on the same line, one line of text, no icon; the warning
  // border still marks the session, and its name, keyboard path and focus are
  // those of a menu button
  test('the chip is drawn as the menu buttons beside it, keeps its warning border and name, and works from the keyboard', async ({ page }) => {
    await openApp(page)
    await openStorageArea(page)
    await confirmAction(page, 'to-temporary')
    await expect(chip(page)).toBeVisible()
    const m = await page.evaluate(() => {
      const el = document.querySelector('.toolbar [data-session-chip="temporary"]')!
      const btn = document.querySelector('.toolbar__actions-core > .menu > .btn')!
      const c = el.getBoundingClientRect()
      const b = btn.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const probe = document.createElement('span')
      probe.style.color = 'var(--warning)'
      document.body.append(probe)
      const warning = getComputedStyle(probe).color
      probe.remove()
      const range = document.createRange()
      range.selectNodeContents(el)
      return {
        h: c.height,
        btnH: b.height,
        offCentre: Math.abs(c.top + c.height / 2 - (b.top + b.height / 2)),
        radius: cs.borderTopLeftRadius,
        btnRadius: getComputedStyle(btn).borderTopLeftRadius,
        fontSize: cs.fontSize,
        btnFontSize: getComputedStyle(btn).fontSize,
        border: cs.borderTopColor,
        warning,
        color: cs.color,
        btnColor: getComputedStyle(btn).color,
        background: cs.backgroundColor,
        btnBackground: getComputedStyle(btn).backgroundColor,
        btnBorder: getComputedStyle(btn).borderTopColor,
        lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
        icons: el.querySelectorAll('svg, img, .icon').length,
        clipped: el.scrollWidth > el.clientWidth,
      }
    })
    expect(m).toMatchObject({ h: 28, btnH: 28, radius: '8px', btnRadius: '8px', fontSize: '12px', btnFontSize: '12px', lines: 1, icons: 0, clipped: false })
    expect(m.offCentre).toBeLessThan(0.5)
    expect(m.color).toBe(m.btnColor)
    expect(m.background).toBe(m.btnBackground)
    expect(m.border).toBe(m.warning)
    expect(m.border).not.toBe(m.btnBorder) // the session still shows
    await expect(chip(page)).toHaveAccessibleName('Temporary session')
    // keyboard: Enter opens, ArrowDown enters the menu, Escape closes it and focus comes back
    await chip(page).focus()
    await page.keyboard.press('Enter')
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.session-chip__pop').getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.session-chip__pop')).toHaveCount(0)
    await expect(chip(page)).toBeFocused()
    // the menu buttons' focus: the boundary takes the focus colour, with the halo
    const focus = await chip(page).evaluate((el) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--line-focus)'
      document.body.append(probe)
      const lineFocus = getComputedStyle(probe).color
      probe.remove()
      const cs = getComputedStyle(el)
      return { visible: el.matches(':focus-visible'), border: cs.borderTopColor, lineFocus, halo: cs.boxShadow }
    })
    expect(focus.visible).toBe(true)
    expect(focus.border).toBe(focus.lineFocus)
    expect(focus.halo).toMatch(/0px 0px 0px 3px/)
  })

  test('a temporary session with work warns before the page is closed; a personal browser does not', async ({ page, context }) => {
    // personal: no dialog, the page closes
    const p2 = await context.newPage()
    await openWithOneNode(p2)
    let dialogs = 0
    p2.on('dialog', (d) => {
      dialogs++
      void d.dismiss()
    })
    await p2.close({ runBeforeUnload: true })
    await expect.poll(() => p2.isClosed()).toBe(true)
    expect(dialogs).toBe(0)
    // temporary with work: the browser asks, and a dismissed dialog keeps the page
    await openWithOneNode(page)
    await openStorageArea(page)
    await confirmAction(page, 'copy')
    let kind = ''
    page.once('dialog', (d) => {
      kind = d.type()
      void d.dismiss()
    })
    await page.close({ runBeforeUnload: true })
    await expect.poll(() => kind).toBe('beforeunload')
    expect(page.isClosed()).toBe(false)
  })
})

test.describe('the two deletions', () => {
  /** the stored document's raw text, or null */
  const storedWorkRaw = async (page: Page): Promise<string | null> => (await stored(page)).find(([k]) => k === WORK)?.[1] ?? null
  /** give the one node a label that must not survive the deletion anywhere */
  const labelTheWork = async (page: Page) => {
    await page.evaluate(() => {
      const g = (window as unknown as { __loop: { graph: { getState: () => { nodes: { id: string }[]; updateNodeData: (id: string, d: object) => void } } } }).__loop.graph.getState()
      g.updateNodeData(g.nodes[0]!.id, { label: 'SensitiveLabel' })
    })
    await page.waitForTimeout(600)
    expect(await storedWorkRaw(page)).toContain('SensitiveLabel')
  }

  test('personal: Delete work data removes the document record; the author record and the preferences stay; the canvas is emptied and what is autosaved afterwards holds none of the old diagram', async ({ page }) => {
    await openWithOneNode(page)
    await labelTheWork(page)
    // the author record and a preference, to prove they stay
    await page.evaluate(() => {
      localStorage.setItem('loop-studio:author', JSON.stringify({ name: 'Keep Me' }))
      localStorage.setItem('loop-studio:canvas-locked', '1')
    })
    await openStorageArea(page)
    await expect(dialog(page).locator('[data-storage-action="delete-work"]')).toBeVisible()
    await dialog(page).locator('[data-storage-action="delete-work"]').click()
    await expect(dialog(page)).toContainText('The open diagram is emptied too')
    await dialog(page).locator('[data-storage-confirm]').click()
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'menu')
    await expect(dialog(page).locator('[data-storage-notice="done"]')).toBeVisible()
    await expect(dialog(page).locator('[data-storage-notice="failed"]')).toHaveCount(0)
    expect(await nodeCount(page)).toBe(0)
    await page.waitForTimeout(600) // the autosave of the emptied canvas
    const after = Object.fromEntries((await stored(page)) as [string, string][])
    expect(after['loop-studio:author']).toBe(JSON.stringify({ name: 'Keep Me' }))
    expect(after['loop-studio:canvas-locked']).toBe('1')
    expect(after[MODE]).toBe('personal')
    // the record is gone, or it is the emptied canvas: in neither case does any
    // of the old diagram survive - the key may come back, the data may not
    const raw = await storedWorkRaw(page)
    expect(raw === null || !raw.includes('SensitiveLabel')).toBe(true)
    if (raw) expect(JSON.parse(raw).nodes).toEqual([])
  })

  test("temporary: Delete work data removes the browser's stored document and keeps the temporary work open", async ({ page }) => {
    await openWithOneNode(page)
    await labelTheWork(page)
    await openStorageArea(page)
    await confirmAction(page, 'copy') // the labelled diagram comes along; the browser keeps its copy
    expect(await storedWorkRaw(page)).toContain('SensitiveLabel')
    await openStorageArea(page)
    await dialog(page).locator('[data-storage-action="delete-work"]').click()
    await expect(dialog(page)).toContainText('Your current temporary work stays open')
    await dialog(page).locator('[data-storage-confirm]').click()
    await expect(dialog(page).locator('[data-storage-notice="done"]')).toBeVisible()
    expect(await storedWorkRaw(page)).toBeNull()
    expect(await nodeCount(page)).toBe(1) // the temporary work, untouched
    expect(await mode(page)).toBe('temporary')
    await page.waitForTimeout(600)
    expect(await storedWorkRaw(page)).toBeNull() // and the temporary autosave does not bring it back
  })

  test('a deletion the browser refuses is reported as failed, on its step, and nothing is called done', async ({ page }) => {
    // the mutation: every remove of the document record throws, as a locked-down
    // or broken storage would; reads and writes still work
    await page.addInitScript((key) => {
      const orig = Storage.prototype.removeItem
      Storage.prototype.removeItem = function (this: Storage, k: string) {
        if (k === key) throw new Error('removal refused by the test')
        return orig.call(this, k)
      }
    }, WORK)
    await openWithOneNode(page)
    await labelTheWork(page)
    await openStorageArea(page)
    await dialog(page).locator('[data-storage-action="delete-work"]').click()
    await dialog(page).locator('[data-storage-confirm]').click()
    // the step stays, says it failed and that the record may still be there
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'deleteWork')
    await expect(dialog(page).locator('[data-storage-notice="failed"]')).toBeVisible()
    await expect(dialog(page).locator('[data-storage-notice="failed"]')).toContainText('could not be removed')
    await expect(dialog(page).locator('[data-storage-notice="failed"]')).toContainText('may still be in this browser')
    await expect(dialog(page).locator('[data-storage-notice="done"]')).toHaveCount(0)
    expect(await storedWorkRaw(page)).toContain('SensitiveLabel')
    expect(await nodeCount(page)).toBe(1)
    // Cancel goes back to the area without a success notice
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveAttribute('data-storage-step', 'menu')
    await expect(dialog(page).locator('[data-storage-notice]')).toHaveCount(0)
  })
})

test.describe('Reset all Loop Studio data', () => {
  // nothing remembered: this test answers the gate itself, so that after the
  // reset the reload really lands on the gate again
  test.use({ storageMode: 'gate' })

  test('removes every key, and the app restarts into the gate', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.gate')).toBeVisible()
    // no helper answered the gate on the side: the fixture still seeded the tour
    // and the release-note state (`whatsNewSeen`), and neither carries the mode key
    expect(await page.evaluate((k) => localStorage.getItem(k), MODE)).toBeNull()
    expect(await storedKeys(page)).toEqual(['loop-studio/guided-tour/1', 'loop-studio/whats-new/announced/1', 'loop-studio/whats-new/opened/1'])
    await page.locator('.gate [data-gate-choice="personal"] input[type="checkbox"]').check()
    await page.locator('.gate [data-gate-choice="personal"] button').click()
    await expect(page.locator('.toolbar')).toBeVisible()
    await page.waitForFunction(() => Boolean((window as unknown as { __loop?: unknown }).__loop))
    await resetAll(page)
    await makeWork(page)
    await page.evaluate(() => localStorage.setItem('loop-studio:author', JSON.stringify({ name: 'Gone' })))
    expect(await storedKeys(page)).toEqual(expect.arrayContaining([WORK, MODE, 'loop-studio:author']))
    await openStorageArea(page)
    await confirmAction(page, 'reset-all')
    await expect(page.locator('.gate')).toBeVisible()
    // what is left is exactly the fixture's own seed, re-armed on the reload
    // (the tour key and the two release-note keys): no document, no author,
    // no mode key, nothing else of the app's
    expect(await storedKeys(page)).toEqual(['loop-studio/guided-tour/1', 'loop-studio/whats-new/announced/1', 'loop-studio/whats-new/opened/1'])
  })
})

test.describe('the share dialog', () => {
  test('states the four facts, and in a temporary session the one guarantee of that session', async ({ page }) => {
    await openApp(page)
    await page.locator('.toolbar__actions button.btn', { hasText: /^Share$/ }).click()
    const body = page.locator('.mcdlg--confirm .mcdlg__note')
    await expect(body).toContainText('contains the entire document, including every label, imported spreadsheet value, and saved frame')
    await expect(body).toContainText('Nothing is uploaded')
    await expect(body).toContainText('browser history, in a messenger, or on the clipboard')
    await expect(body).toContainText('export a file instead of sharing a link')
    await expect(body).not.toContainText('temporary session')
    await page.keyboard.press('Escape')
    await openStorageArea(page)
    await confirmAction(page, 'to-temporary')
    await page.locator('.toolbar__actions button.btn', { hasText: /^Share$/ }).click()
    await expect(body).toContainText('temporary session the diagram is not kept in this browser')
    await page.keyboard.press('Escape')
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the More sheet has the Storage and privacy row; in a temporary session it carries the reminder', async ({ page }) => {
    await openApp(page)
    await page.locator('.mob-more').click()
    const row = page.locator('.sheet[aria-label="More"] [data-settings-row="storage-privacy"]')
    await expect(row).toBeVisible()
    await expect(row.locator('[data-session-chip]')).toHaveCount(0)
    await row.click()
    await expect(dialog(page)).toBeVisible()
    await confirmAction(page, 'to-temporary')
    await expect(dialog(page)).toHaveCount(0)
    expect(await mode(page)).toBe('temporary')
    // the More sheet is still open behind the dialog that just closed: the row now carries the reminder
    await expect(row.locator('[data-session-chip="temporary"]')).toBeVisible()
  })
})

test.describe('the installed app’s update bar', () => {
  // the same trick whats-new.spec.ts uses: the bar shows when the PWA store
  // holds a waiting worker, with no real service worker behind it; `apply`
  // stays null here, so pressing Update never reloads - the test is about
  // what is asked FIRST
  type PwaBridge = { __loop: { pwa: { setState: (s: unknown) => void } } }
  const showBar = (page: Page) =>
    page.evaluate(() => (window as unknown as PwaBridge).__loop.pwa.setState({ waitingWorker: { test: 'waiting worker' }, dismissedWorker: null }))
  const updateButton = (page: Page) => page.locator('.pwa-update button').first()
  const temporaryConfirm = (page: Page) => page.locator('.mcdlg--confirm', { hasText: 'Update now?' })

  test('a personal browser updates without the temporary-session question', async ({ page }) => {
    await openWithOneNode(page)
    await showBar(page)
    await expect(page.locator('.pwa-update')).toBeVisible()
    await updateButton(page).click()
    await expect(temporaryConfirm(page)).toHaveCount(0)
  })

  test('a temporary session with work is asked first, and Cancel keeps everything', async ({ page }) => {
    await openWithOneNode(page)
    await openStorageArea(page)
    await confirmAction(page, 'copy')
    await showBar(page)
    await updateButton(page).click()
    await expect(temporaryConfirm(page)).toBeVisible()
    await expect(temporaryConfirm(page)).toContainText('export it first')
    await temporaryConfirm(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(temporaryConfirm(page)).toHaveCount(0)
    await expect(page.locator('.pwa-update')).toBeVisible()
    expect(await nodeCount(page)).toBe(1)
    expect(await mode(page)).toBe('temporary')
  })
})
