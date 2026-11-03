import type { MessageKey } from '../../i18n'
import type { NodeIconId } from '../../model/model'

// SEMANTICS-R12.md — what the node icon's components share without drawing:
// the catalog key of each name, and the zoom the drawing switches at.

/** the catalog key of each icon's localized name (literal keys, so the catalog
 *  check sees every one used, and `tsc` fails on an id without a name) */
const NAME_KEY = {
  cloud: 'inspector.icon.name.cloud',
  'rain-cloud': 'inspector.icon.name.rain-cloud',
  wind: 'inspector.icon.name.wind',
  sun: 'inspector.icon.name.sun',
  remote: 'inspector.icon.name.remote',
  tree: 'inspector.icon.name.tree',
  electricity: 'inspector.icon.name.electricity',
  water: 'inspector.icon.name.water',
  wave: 'inspector.icon.name.wave',
  airplane: 'inspector.icon.name.airplane',
  car: 'inspector.icon.name.car',
  'nuclear-plant': 'inspector.icon.name.nuclear-plant',
  warehouse: 'inspector.icon.name.warehouse',
  medicine: 'inspector.icon.name.medicine',
  'game-currency': 'inspector.icon.name.game-currency',
  cash: 'inspector.icon.name.cash',
  recycling: 'inspector.icon.name.recycling',
} satisfies Record<NodeIconId, MessageKey>

/** the catalog key of an icon's localized name */
export const nodeIconNameKey = (id: NodeIconId): MessageKey => NAME_KEY[id]

/** the canvas zoom from which the mark renders at 20 px or more (16 px × zoom):
 *  the 24-unit drawing is used from there up, the separately tuned 16 px drawing
 *  below (the nuclear plant's emblem and its plain tower, and every other id's
 *  pair — most ids draw them alike) */
export const NODE_ICON_BIG_ZOOM = 20 / 16
