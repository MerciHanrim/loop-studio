import type { Page } from '@playwright/test'
import { expect, openApp, test } from './support/loop'

// docs/localization.md §L9.3 — the runtime half of the form direction contract.
//
// The exhaustive half is a source check (scripts/check-form-direction.mjs): all
// 35 text-carrying controls, every one declaring a direction. It runs without a
// browser and it is the only layer that can say "all of them".
//
// This file is the other two layers, and they are deliberately different kinds
// of evidence:
//
//   SHARED FIXTURE   six rows, not thirty-five. `dir="auto"` over the four
//                    shapes this census measured, and `dir="ltr"` over an
//                    unsigned and a negative value. It proves BROWSER
//                    behaviour once, on real production fields - it is not a
//                    claim about thirty-five product paths.
//   PRODUCT PATH     a real value reaching a real field the way a person puts
//                    it there.
//
// The distinction matters because the earlier version of this manifest was a
// synthetic matrix: 19 text fields x 4 shapes + 16 number fields x 2, applied
// regardless of what each field can hold. A read-only share URL never receives
// an Arabic string through any product path, and multiplying it by four shapes
// would have counted four renders that cannot happen.

type Bridge = {
  __loop: {
    i18n: { getState: () => { activeLocale: string; setLocale: (code: string) => void } }
    graph: { getState: () => { nodes: { id: string; data?: { label?: string } }[] } }
  }
}

/** the four shapes this arc measured, and what `dir="auto"` must resolve to */
const AUTO_SHAPES = [
  { name: 'latin', value: 'Gold reserve', expect: 'ltr' },
  { name: 'arabic', value: 'مبيعات', expect: 'rtl' },
  { name: 'digit-leading', value: '2024 Sales', expect: 'ltr' },
  { name: 'bracket-leading', value: '(Draft) Sales', expect: 'ltr' },
]

async function switchLocale(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    ;(window as unknown as Bridge).__loop.i18n.getState().setLocale(c)
  }, code)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.i18n.getState().activeLocale))
    .toBe(code)
}

/** select the first node so the Inspector's label field is on screen */
async function openNodeLabelField(page: Page) {
  await page.locator('.react-flow__node').first().click()
  const field = page.locator('.rightcol input[dir="auto"]').first()
  await expect(field).toBeVisible()
  return field
}

const resolvedDirection = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).direction : null
  }, selector)

test.describe('form direction — shared fixture (browser behaviour, six rows)', () => {
  for (const shape of AUTO_SHAPES) {
    test(`dir="auto" resolves ${shape.expect} for a ${shape.name} value`, async ({ page }) => {
      await openApp(page)
      const field = await openNodeLabelField(page)
      await field.fill(shape.value)
      // `auto` takes the direction from the value's first STRONG character, so a
      // digit or a bracket in front of Latin text still resolves ltr - which is
      // exactly why those two shapes are in the set rather than assumed
      await expect
        .poll(() => resolvedDirection(page, '.rightcol input[dir="auto"]'))
        .toBe(shape.expect)
    })
  }

  test('dir="ltr" holds an unsigned and a negative value in the same direction', async ({ page }) => {
    await openApp(page)
    const seed = page.locator('.pstrip__seed')
    await expect(seed).toBeVisible()
    expect(await seed.getAttribute('dir')).toBe('ltr')

    for (const value of ['7', '-7']) {
      await seed.fill(value)
      // the pin is what keeps a leading sign from moving: `-1.5` rendered
      // `1.5-` in the measurement that earned it
      await expect.poll(() => resolvedDirection(page, '.pstrip__seed')).toBe('ltr')
    }
  })
})

test.describe('form direction — product path', () => {
  test('a user label typed in Arabic reaches the model and the field reads rtl', async ({ page }) => {
    await openApp(page)
    const field = await openNodeLabelField(page)
    await field.fill('مبيعات')
    await field.blur()

    // the value took the path a person's typing takes, and the field followed it
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Bridge).__loop.graph.getState().nodes.map((n) => n.data?.label)))
      .toContain('مبيعات')
    expect(await resolvedDirection(page, '.rightcol input[dir="auto"]')).toBe('rtl')
  })

  test('the field keeps the VALUE direction even when the interface direction is the opposite', async ({ page }) => {
    await openApp(page)
    const field = await openNodeLabelField(page)
    await field.fill('Gold reserve')
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')

    // the whole interface is rtl and this field is not, because the person
    // wrote Latin in it. That is the entire point of `auto` over inheritance.
    await expect.poll(() => resolvedDirection(page, '.rightcol input[dir="auto"]')).toBe('ltr')
  })

  test('a pinned field stays ltr under an rtl interface', async ({ page }) => {
    await openApp(page)
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
    await expect.poll(() => resolvedDirection(page, '.pstrip__seed')).toBe('ltr')
  })
})

// One product path per PRODUCTION KIND. The manifest used to claim 61 rows -
// every field times every shape - which counted renders that cannot happen: a
// read-only share URL never receives an Arabic string, and a field whose source
// declares `min="0"` does not render a negative as a valid state. The contract
// is now a representative sample, and "representative" means one route per kind
// rather than one per field, with the risk shapes kept where they are real.
test.describe('form direction - one product path per production kind', () => {
  test('KIND expression: a non-Latin value typed into a grammar field stays ltr under an rtl interface', async ({ page }) => {
    await openApp(page)
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')

    // the edge flow field: operators, ids and numbers, never prose
    await page.locator('.react-flow__edge').first().click({ force: true })
    const flow = page.locator('.rightcol input[dir="ltr"]').first()
    await expect(flow).toBeVisible()
    await flow.fill('مبيعات')
    // the field does NOT adopt the value's direction. Being able to type a
    // character is not the same as the grammar changing which way it reads.
    await expect
      .poll(() => page.evaluate(() => {
        const el = document.querySelector('.rightcol input[dir="ltr"]')
        return el ? getComputedStyle(el).direction : null
      }))
      .toBe('ltr')
  })

  test('KIND number with no declared floor: a real negative renders in author order', async ({ page }) => {
    await openApp(page)
    // the model panel lists parameters and registers, and the sample document
    // has neither - so one is created the way the palette creates it
    await page.evaluate(() => {
      ;(window as unknown as { __loop: { graph: { getState: () => { addNodeAt: (k: string, p: { x: number; y: number }) => void } } } })
        .__loop.graph.getState()
        .addNodeAt('parameter', { x: 260, y: 240 })
    })
    // .mp-row__val declares no `min`, so a negative is a VALID state here -
    // unlike the ten number fields whose source declares a non-negative floor
    const val = page.locator('.mp-row__val').first()
    await expect(val).toBeVisible()
    expect(await val.getAttribute('dir')).toBe('ltr')
    await val.fill('-12.5')
    await switchLocale(page, 'ar-XB')
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl')
    // the pin is what stops `-12.5` rendering `12.5-`
    await expect
      .poll(() => page.evaluate(() => {
        const el = document.querySelector('.mp-row__val')
        return el ? getComputedStyle(el).direction : null
      }))
      .toBe('ltr')
    expect(await val.inputValue()).toBe('-12.5')
  })

  test('KIND generated read-only: a share URL is pinned and holds the generated value', async ({ page }) => {
    await openApp(page)
    await switchLocale(page, 'ar-XB')
    await page.locator('.toolbar__actions button', { hasText: /^Share$/ }).click()
    await page.locator('.mcdlg--confirm').getByRole('button', { name: /create link/i }).click()
    const url = page.locator('.share-pop__url').first()
    await expect(url).toBeVisible()
    expect(await url.getAttribute('dir')).toBe('ltr')
    await expect
      .poll(() => page.evaluate(() => {
        const el = document.querySelector('.share-pop__url')
        return el ? getComputedStyle(el).direction : null
      }))
      .toBe('ltr')
    // it really is the generated value, not an empty box
    expect((await url.inputValue()).startsWith('http')).toBe(true)
  })
})
