import { useGraphStore } from '../../store/graphStore'
import { useIsMobile } from '../../ui/media'
import { useT } from '../../i18n'

// docs/mobile.md §MV6 — Loop Studio has no account / cloud sync, so on a phone
// you view your work by opening a file or a Share link. Until this session has
// loaded something of its own (it is still the built-in first-boot sample),
// show a card that says so and offers the file picker. It clears itself the
// moment a document / template / Share link loads (pristineSample -> false).

export function MobileOpenFileHint({ onOpenFile }: { onOpenFile: () => void }) {
  const t = useT()
  const isMobile = useIsMobile()
  const pristine = useGraphStore((s) => s.pristineSample)
  if (!isMobile || !pristine) return null

  return (
    <div className="openhint" role="note">
      <p className="openhint__title">{t('openhint.title')}</p>
      <p className="openhint__body">{t('openhint.body')}</p>
      <button type="button" className="btn openhint__btn" onClick={onOpenFile}>
        {t('openhint.button')}
      </button>
      <p className="openhint__sub">{t('openhint.sub')}</p>
    </div>
  )
}
