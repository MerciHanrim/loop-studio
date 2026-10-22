import type { Page } from '@playwright/test'
import { expect } from './loop'

// docs/module-system.md §MS6 — a saved structure, inserted through the File
// menu's "Insert saved structure…". The bundled blocks this used to come from
// were removed (2026-10); a spec that needs one atomic insert of several nodes
// picks this file instead.

/** three connected nodes and a register that reads two of them */
export const STRUCTURE = JSON.stringify({
  schema: 'loop-studio/graph',
  version: 1,
  nodes: [
    { id: 'supply', type: 'source', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Supply' } },
    { id: 'inbox', type: 'pool', position: { x: 200, y: 0 }, data: { kind: 'pool', label: 'Inbox', initial: 0 } },
    { id: 'outbox', type: 'pool', position: { x: 400, y: 0 }, data: { kind: 'pool', label: 'Outbox', initial: 0 } },
    { id: 'in_system', type: 'register', position: { x: 200, y: 160 }, data: { kind: 'register', label: 'Units in system', expr: '@inbox + @outbox', format: 'int' } },
  ],
  edges: [
    { id: 'e1', source: 'supply', target: 'inbox', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
    { id: 'e2', source: 'inbox', target: 'outbox', sourceHandle: 'out', targetHandle: 'in', type: 'loop', data: { kind: 'resource', flow: '1' } },
  ],
})

export const SAVE_STRUCTURE = 'Save selected structure…'
export const INSERT_STRUCTURE = 'Insert saved structure…'

export const filePop = (page: Page) => page.locator('.toolbar__filemenu-pop')

export async function openFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(filePop(page)).toBeVisible()
}

export const fileItem = (page: Page, name: string) =>
  filePop(page).locator('.menu__item').filter({ has: page.locator('.menu__name', { hasText: name }) })

/** Pick `text` as the file of an "Insert saved structure…" action. */
export async function insertStructureFile(page: Page, text: string = STRUCTURE, name = 'structure.json'): Promise<void> {
  await openFileMenu(page)
  const chooserP = page.waitForEvent('filechooser')
  await fileItem(page, INSERT_STRUCTURE).click()
  await (await chooserP).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') })
}
