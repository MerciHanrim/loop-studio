// docs/localization.md §L3.3 — `satisfies MessageCatalog` makes `tsc` fail on a
// missing OR an extra key against `../en`. Same `{name}` slots as `en`; no
// concatenation, no rich-text tags. Assembled from the five domain slices; each
// slice is independently key-checked against its `../en/<domain>` counterpart.

import type { MessageCatalog } from '../en'
import ui from './ui'
import canvas from './canvas'
import inspector from './inspector'
import templates from './templates'
import dataImport from './dataImport'

const zhHans = { ...ui, ...canvas, ...inspector, ...templates, ...dataImport } satisfies MessageCatalog

export default zhHans
