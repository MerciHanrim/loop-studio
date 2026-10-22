import { describe, expect, it } from 'vitest'
import { MENU_TEMPLATES } from '../model/templates'
import { EXAMPLE_NOTE_IDS } from './ExampleNotesDialog'

// Help ▸ Example notes (2026-10-20): every example the Templates menu offers
// has a note, in the menu's order — a Template added to the menu without one
// fails here rather than silently missing from the list.
describe('Example notes', () => {
  it('cover every Template the menu offers, in the menu’s order', () => {
    expect(EXAMPLE_NOTE_IDS).toEqual(MENU_TEMPLATES.map((t) => t.id))
  })
})
