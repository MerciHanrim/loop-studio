import type { MessageKey } from '../i18n'

// docs/module-system.md §MS6 — a bundled Building block's menu NAME and BLURB
// are chrome, keyed by the block's stable `id` (mirrors `templateKeys.ts`).
// Kept out of `ModuleMenu.tsx` so that file only exports a component
// (fast-refresh).
export const MODULE_KEY = {
  'buffered-step': { name: 'modules.bufferedStep.name', blurb: 'modules.bufferedStep.blurb' },
  'reward-split': { name: 'modules.rewardSplit.name', blurb: 'modules.rewardSplit.blurb' },
} satisfies Record<string, { name: MessageKey; blurb: MessageKey }>
