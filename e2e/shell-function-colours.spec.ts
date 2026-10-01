import type { Page } from '@playwright/test'
import { probe } from './support/boundary'
import { expect, openApp, test } from './support/loop'

// The shell design branch (2026-10-01) put the LIGHT shell on the shared Cozy
// Shelter tokens. Its contract has two halves, and both are pinned here on the
// values the browser actually computes:
//
//   1. the FUNCTIONAL colours are byte-identical to what they were before — the
//      node hues, the edge / flow / signal colours, the frame accents, the
//      state colours, the graph's own focus colour, the structure line the
//      node silhouettes and chart axes draw, the node and edge-label
//      elevations. The expected values below are `main 16e64b2`'s, written out;
//      a shell change that reaches one of them fails here.
//   2. the SHELL reads the family layer in light only: dark is Loop's own
//      palette, unchanged, because the family layer has no dark values.
//
// What is NOT claimed: the canvas's INK. Node titles, edge-chip text and the
// flow-token count are drawn in `--text-primary` / `--text-secondary`, which are
// shell tokens, and so is the canvas background and its grid (`--line-hairline`).
// Those follow the shell by design and are listed in section 3.

type Table = Record<string, string>

// (`--node-hue` is not in the tables: it is declared per node class, not on the
//  root, and its annotation-node value is `var(--line-structure)`, pinned here.)
const FUNCTION_LIGHT: Table = {
  '--line-structure': 'rgb(193, 190, 180)',
  '--state-focus': 'rgb(63, 111, 182)',
  '--state-selected': 'rgb(84, 82, 76)',
  '--state-fired': 'rgb(47, 116, 110)',
  '--state-arrival': 'rgb(47, 116, 110)',
  '--state-guide': 'rgb(47, 116, 110)',
  '--state-warning': 'rgb(165, 99, 50)',
  '--warning': 'rgb(165, 99, 50)',
  '--signal-primary': 'rgb(47, 116, 110)',
  '--signal-primary-soft': 'rgb(216, 229, 225)',
  '--edge-resource': 'rgb(173, 170, 161)',
  '--edge-state': 'rgb(193, 190, 181)',
  '--edge-selected': 'rgb(84, 82, 76)',
  '--flow-strength': 'rgb(47, 116, 110)',
  '--flow-trail': 'rgba(47, 116, 110, 0.22)',
  '--activity-edge-glow': 'rgb(47, 116, 110)',
  '--hue-pool': 'rgb(82, 122, 145)',
  '--hue-source': 'rgb(102, 128, 94)',
  '--hue-drain': 'rgb(168, 100, 85)',
  '--hue-gate': 'rgb(154, 118, 57)',
  '--hue-converter': 'rgb(120, 103, 143)',
  '--hue-end': 'rgb(117, 111, 104)',
  '--frame-accent-slate': 'rgb(82, 122, 145)',
  '--frame-accent-sage': 'rgb(102, 128, 94)',
  '--frame-accent-gold': 'rgb(154, 118, 57)',
  '--frame-accent-violet': 'rgb(120, 103, 143)',
  '--frame-accent-rose': 'rgb(158, 90, 131)',
}

const FUNCTION_DARK: Table = {
  '--line-structure': 'rgb(99, 104, 95)',
  '--state-focus': 'rgb(131, 169, 230)',
  '--state-selected': 'rgb(154, 158, 150)',
  '--state-fired': 'rgb(118, 183, 174)',
  '--state-arrival': 'rgb(118, 183, 174)',
  '--state-guide': 'rgb(118, 183, 174)',
  '--state-warning': 'rgb(213, 150, 96)',
  '--warning': 'rgb(213, 150, 96)',
  '--signal-primary': 'rgb(118, 183, 174)',
  '--signal-primary-soft': 'rgb(41, 67, 63)',
  '--edge-resource': 'rgb(87, 91, 86)',
  '--edge-state': 'rgb(71, 75, 71)',
  '--edge-selected': 'rgb(154, 158, 150)',
  '--flow-strength': 'rgb(118, 183, 174)',
  '--flow-trail': 'rgba(118, 183, 174, 0.2)',
  '--activity-edge-glow': 'rgba(118, 183, 174, 0.35)',
  '--hue-pool': 'rgb(120, 166, 190)',
  '--hue-source': 'rgb(145, 175, 133)',
  '--hue-drain': 'rgb(209, 138, 120)',
  '--hue-gate': 'rgb(198, 160, 91)',
  '--hue-converter': 'rgb(169, 155, 192)',
  '--hue-end': 'rgb(166, 160, 153)',
  '--frame-accent-slate': 'rgb(120, 166, 190)',
  '--frame-accent-sage': 'rgb(145, 175, 133)',
  '--frame-accent-gold': 'rgb(198, 160, 91)',
  '--frame-accent-violet': 'rgb(169, 155, 192)',
  '--frame-accent-rose': 'rgb(197, 139, 171)',
}

/** non-colour functional tokens, compared as declared text */
const RAW_LIGHT: Table = {
  '--node-hue-opacity': '0.04',
  '--elev-node': 'drop-shadow(0 1px 1.5px rgba(20, 20, 20, 0.05))',
  '--elev-edge-label': '0 1px 3px rgba(20, 20, 20, 0.14)',
  '--elev-label': '0 1px 2px rgba(20, 20, 20, 0.08)',
}
const RAW_DARK: Table = {
  '--node-hue-opacity': '0.04',
  '--elev-node': 'none',
  '--elev-edge-label': 'none',
  '--elev-label': 'none',
}

/** the light shell on the family layer */
const SHELL_LIGHT: Table = {
  '--surface-ground': 'rgb(247, 247, 245)', // --cs-surface-soft
  '--surface-canvas': 'rgb(253, 253, 252)', // --cs-background
  '--surface-panel': 'rgb(255, 255, 255)', // --cs-panel
  '--surface-raised': 'rgb(255, 255, 255)',
  '--surface-overlay': 'rgb(255, 255, 255)',
  '--surface-sunken': 'rgb(233, 232, 226)', // Loop's own, unmapped
  '--line-hairline': 'rgb(217, 221, 228)', // --cs-line
  '--line-container': 'rgb(217, 221, 228)',
  '--line-control': 'rgb(108, 116, 110)', // Loop's own (>= 3:1), NOT --cs-control-line
  '--line-control-hover': 'rgb(79, 86, 81)', // its own value — does not follow the shared ink
  '--line-strong': 'rgb(140, 136, 126)',
  '--text-primary': 'rgb(32, 36, 42)', // --cs-ink
  '--text-secondary': 'rgb(96, 104, 115)', // --cs-ink-subtle
  '--text-tertiary': 'rgb(108, 116, 110)',
  '--focus-ring': 'rgb(79, 111, 232)', // --cs-accent: the SOLID focus colour
  '--line-focus': 'rgb(79, 111, 232)',
  '--focus-halo': 'rgba(79, 111, 232, 0.18)', // --cs-focus-ring: the halo, never the solid
}

/** dark: Loop's own palette, every value as it was */
const SHELL_DARK: Table = {
  '--surface-ground': 'rgb(23, 26, 24)',
  '--surface-canvas': 'rgb(32, 35, 32)',
  '--surface-panel': 'rgb(39, 42, 39)',
  '--surface-raised': 'rgb(50, 54, 50)',
  '--surface-overlay': 'rgb(43, 48, 44)',
  '--surface-sunken': 'rgb(20, 23, 21)',
  '--line-hairline': 'rgb(60, 64, 60)',
  '--line-container': 'rgb(99, 104, 95)', // what containers drew before the split
  '--line-control': 'rgb(167, 175, 168)',
  '--line-control-hover': 'rgb(200, 206, 200)',
  '--line-strong': 'rgb(138, 143, 136)',
  '--text-primary': 'rgb(239, 242, 237)',
  '--text-secondary': 'rgb(200, 206, 200)',
  '--text-tertiary': 'rgb(167, 175, 168)',
  '--focus-ring': 'rgb(131, 169, 230)',
  '--line-focus': 'rgb(131, 169, 230)',
  '--focus-halo': 'rgba(131, 169, 230, 0.24)',
}

const resolved = async (page: Page, table: Table) => {
  const out: Table = {}
  for (const token of Object.keys(table)) out[token] = await probe(page, `var(${token})`)
  return out
}
const raw = (page: Page, table: Table) =>
  page.evaluate(
    (tokens) =>
      Object.fromEntries(tokens.map((t) => [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()])),
    Object.keys(table),
  )

for (const [scheme, fn, rawT, shell] of [
  ['light', FUNCTION_LIGHT, RAW_LIGHT, SHELL_LIGHT],
  ['dark', FUNCTION_DARK, RAW_DARK, SHELL_DARK],
] as const) {
  test.describe(`shell tokens — ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openApp(page)
    })

    test('1. every functional colour computes to its pre-branch value', async ({ page }) => {
      expect(await resolved(page, fn)).toEqual(fn)
      expect(await raw(page, rawT)).toEqual(rawT)
    })

    test(`2. the shell: ${scheme === 'light' ? 'the family layer, through the aliases' : "Loop's own dark palette, unchanged"}`, async ({ page }) => {
      expect(await resolved(page, shell)).toEqual(shell)
    })
  })
}

test.describe('shell tokens — the family layer itself', () => {
  test('the nineteen canonical --cs-* tokens are declared with the family values', async ({ page }) => {
    await openApp(page)
    const CS: Table = {
      '--cs-ink': '#20242a',
      '--cs-ink-subtle': '#606873',
      '--cs-font-sans': "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif",
      '--cs-background': '#fdfdfc',
      '--cs-panel': '#ffffff',
      '--cs-surface-soft': '#f7f7f5',
      '--cs-line': '#d9dde4',
      '--cs-control-line': '#e1e3e6',
      '--cs-accent': '#4f6fe8',
      '--cs-accent-strong': '#3d58c4',
      '--cs-focus-ring': 'rgba(79, 111, 232, .18)',
      '--cs-success': '#28734b',
      '--cs-warning': '#92651b',
      '--cs-danger': '#cf4b56',
      '--cs-radius': '12px',
      '--cs-control-radius': '8px',
      '--cs-shadow-soft': '0 1px 2px rgba(20, 27, 38, .04), 0 8px 24px rgba(20, 27, 38, .055)',
      '--cs-ci-ink': '#20242a',
      '--cs-ci-inverse': '#ffffff',
    }
    expect(Object.keys(CS)).toHaveLength(19)
    expect(await raw(page, CS)).toEqual(CS)
  })

  test('3. the two radius axes, and the canvas ink that follows the shell by design', async ({ page }) => {
    await openApp(page)
    // (a custom property's computed value is its substituted value)
    expect(await raw(page, { '--radius': '', '--control-radius': '' })).toEqual({
      '--radius': '12px',
      '--control-radius': '8px',
    })
    // a standard button is a control; a compact chip keeps its own radius
    const radius = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).borderTopLeftRadius)
    expect(await radius('.toolbar__actions .btn')).toBe('8px')
    expect(await radius('.pstrip .pb-btn')).toBe('8px')
    expect(await radius('.palette-item .chip, .chip')).toBe('8px')
    expect(await radius('.pstrip__seed'), 'a compact control keeps its own radius').toBe('5px')
    expect(await radius('.minimap-toggle'), 'a compact control keeps its own radius').toBe('4px')
  })
})
