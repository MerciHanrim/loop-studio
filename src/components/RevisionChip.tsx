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
  const titleParams = { project: short(open.projectId), role: open.role, revision: open.revisionId }
  const title = dirty ? t('revChip.titleDirty', titleParams) : t('revChip.title', titleParams)

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
