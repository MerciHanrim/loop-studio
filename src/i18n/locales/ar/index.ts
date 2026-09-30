// docs/localization.md §L3.3 — `satisfies MessageCatalog` makes `tsc` fail on a
// missing OR an extra key against `../en`. Same `{name}` slots as `en`; no
// concatenation, no rich-text tags. Assembled from the five domain slices; each
// slice is independently key-checked against its `../en/<domain>` counterpart.
//
// §L9 — `ar` is the first locale whose `direction` is `rtl` and whose catalog is
// real rather than pseudo. The direction itself is not decided here: it comes
// from the registry entry, the one place a reading direction is allowed to come
// from. This file is only the message set.

import type { MessageCatalog } from '../en'
import ui from './ui'
import canvas from './canvas'
import inspector from './inspector'
import templates from './templates'
import dataImport from './dataImport'

const ar = { ...ui, ...canvas, ...inspector, ...templates, ...dataImport } satisfies MessageCatalog

export default ar
