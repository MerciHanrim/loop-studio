import { GraphFileError, type GraphFileErrorCode } from '../model/serialize'
import type { MessageKey } from '../i18n'

// The graph-file reader (`deserialize`, dependency-free model layer) throws a
// `GraphFileError` with a CODE; the UI turns that into the active language
// here, in one place, so the desktop toolbar and the mobile top bar show the
// same localized message. Any other error keeps its own text (an engine /
// worker diagnostic), and a non-Error falls back to the generic read error.

const KEY: Record<GraphFileErrorCode, MessageKey> = {
  'invalid-json': 'import.error.invalidJson',
  unexpected: 'import.error.unexpected',
  'not-loop-studio': 'import.error.notLoopStudio',
  'missing-nodes-edges': 'import.error.missingNodesEdges',
}

export function importErrorMessage(err: unknown, t: (key: MessageKey) => string): string {
  if (err instanceof GraphFileError) return t(KEY[err.code])
  if (err instanceof Error && err.message) return err.message
  return t('import.readError')
}
