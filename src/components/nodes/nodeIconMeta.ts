import type { MessageKey } from '../../i18n'
import type { NodeIconId } from '../../model/model'

// SEMANTICS-R12.md — what the node icon's components share without drawing:
// the catalog key of each name, and the zoom the drawing switches at.

/** the catalog key of each icon's localized name (literal keys, so the catalog
 *  check sees every one used, and `tsc` fails on an id without a name) */
const NAME_KEY = {
  cloud: 'inspector.icon.name.cloud',
  'rain-cloud': 'inspector.icon.name.rain-cloud',
  'partly-cloudy': 'inspector.icon.name.partly-cloudy',
  snow: 'inspector.icon.name.snow',
  'lightning-risk': 'inspector.icon.name.lightning-risk',
  wind: 'inspector.icon.name.wind',
  'strong-wind': 'inspector.icon.name.strong-wind',
  typhoon: 'inspector.icon.name.typhoon',
  temperature: 'inspector.icon.name.temperature',
  sun: 'inspector.icon.name.sun',
  remote: 'inspector.icon.name.remote',
  tree: 'inspector.icon.name.tree',
  electricity: 'inspector.icon.name.electricity',
  water: 'inspector.icon.name.water',
  wave: 'inspector.icon.name.wave',
  airplane: 'inspector.icon.name.airplane',
  car: 'inspector.icon.name.car',
  'cargo-ship': 'inspector.icon.name.cargo-ship',
  'nuclear-plant': 'inspector.icon.name.nuclear-plant',
  oil: 'inspector.icon.name.oil',
  coal: 'inspector.icon.name.coal',
  warehouse: 'inspector.icon.name.warehouse',
  house: 'inspector.icon.name.house',
  food: 'inspector.icon.name.food',
  drink: 'inspector.icon.name.drink',
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
