import { useGraphStore } from '../../store/graphStore'
import { useIsMobile } from '../../ui/media'

// docs/mobile.md §MV6 — Loop Studio has no account / cloud sync, so on a phone
// you view your work by opening a file or a Share link. Until this session has
// loaded something of its own (it is still the built-in first-boot sample),
// show a card that says so and offers the file picker. It clears itself the
// moment a document / template / Share link loads (pristineSample -> false).

export function MobileOpenFileHint({ onOpenFile }: { onOpenFile: () => void }) {
  const isMobile = useIsMobile()
  const pristine = useGraphStore((s) => s.pristineSample)
  if (!isMobile || !pristine) return null

  return (
    <div className="openhint" role="note">
      <p className="openhint__title">No account sync</p>
      <p className="openhint__body">Open a saved file or a Share link to view it here.</p>
      <button type="button" className="btn openhint__btn" onClick={onOpenFile}>
        Open a file
      </button>
      <p className="openhint__sub">
        Export <strong>Graph JSON</strong> or <strong>Workspace JSON</strong> on desktop, or open a{' '}
        <code>#g1=</code> Share link.
      </p>
    </div>
  )
}
