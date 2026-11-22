import { useProjectStore } from '../store/projectStore'
import { useT } from '../i18n'
import { isolateLtr } from '../i18n/bidiIsolate'
import { Icon } from '../ui/icons'

// SEMANTICS-R.md §R2 / §R8 — a compact, non-interactive indicator of the open
// project revision (or proposal) and whether the live doc has drifted from its
// baseline. Purely informational. `projectId` / `role` / `revisionId` are raw
// wire data — only the chrome around them is localized.

const short = (id: string) => id.replace(/^(?:proj|rev)_/, '').slice(0, 6).toLowerCase()

export function RevisionChip({ className }: { className?: string }) {
  const t = useT()
  const open = useProjectStore((s) => s.open)
  const dirty = useProjectStore((s) => s.dirty)
  if (!open) return null

  const isProposal = open.role === 'proposal'
  const label = isProposal ? t('revChip.proposal') : t('revChip.rev', { id: isolateLtr(short(open.revisionId)) })
  // review I2 — the three wire values are LRI-isolated in the title too: raw, a
  // project id that starts with a digit came apart after the Arabic word before it
  // when the title was laid out in the chip's ltr direction. Written out at each call
  // (not a shared params object) so the argument checkers can read them.
  const title = dirty
    ? t('revChip.titleDirty', {
        project: isolateLtr(short(open.projectId)),
        role: isolateLtr(open.role),
        revision: isolateLtr(open.revisionId),
      })
    : t('revChip.title', {
        project: isolateLtr(short(open.projectId)),
        role: isolateLtr(open.role),
        revision: isolateLtr(open.revisionId),
      })

  return (
    <span
      className={`rev-chip${dirty ? ' rev-chip--dirty' : ''}${className ? ` ${className}` : ''}`}
      title={title}
    >
      <Icon name={isProposal ? 'pencil' : 'branch'} /> {label}
      {dirty ? (
        <span className="rev-chip__dot" role="img" aria-label={t('revChip.unsaved')} />
      ) : null}
    </span>
  )
}
