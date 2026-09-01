import type { MessageKey } from '../i18n'

// docs/localization.md §L3.4 — a template's menu NAME and BLURB are chrome,
// keyed by the template's stable `id`; the node labels each template seeds into
// the GraphDoc stay as authored. Kept out of `Templates.tsx` so that file only
// exports a component (fast-refresh).
export const TEMPLATE_KEY = {
  equilibrium: { name: 'templates.equilibrium.name', blurb: 'templates.equilibrium.blurb' },
  deadlock: { name: 'templates.deadlock.name', blurb: 'templates.deadlock.blurb' },
  'mmo-progression': {
    name: 'templates.mmoProgression.name',
    blurb: 'templates.mmoProgression.blurb',
  },
} satisfies Record<string, { name: MessageKey; blurb: MessageKey }>
