import type { MessageKey } from '../../i18n'
import type { GateStatus } from '../../engine/types'

/** the state's phrase (the LED's accessible name; the Inspector's first
 *  sentence) and the reason's phrase, keyed by the engine's tokens — literal
 *  maps so every key is a call site the i18n checker can see */
export const GATE_STATE_KEY = {
  idle: 'node.gate.state.idle',
  full: 'node.gate.state.full',
  partial: 'node.gate.state.partial',
  held: 'node.gate.state.held',
  fault: 'node.gate.state.fault',
} satisfies Record<GateStatus['state'], MessageKey>
export const GATE_WHY_KEY = {
  supply: 'node.gate.why.supply',
  upstream: 'node.gate.why.upstream',
  room: 'node.gate.why.room',
  pullAll: 'node.gate.why.pullAll',
  plan: 'node.gate.why.plan',
  inert: 'node.gate.why.inert',
  cycle: 'node.gate.why.cycle',
} satisfies Record<NonNullable<GateStatus['why']>, MessageKey>
/** A reason whose phrase depends on the state. `upstream` on a `partial` Gate says it was supplied
 *  in part; on a `held` Gate nothing arrived from what feeds it (issue #593). */
export const GATE_WHY_HELD_KEY = {
  upstream: 'node.gate.why.upstreamHeld',
} satisfies Partial<Record<NonNullable<GateStatus['why']>, MessageKey>>

/** the reason's phrase for a Gate's state this step (null: no reason) */
export function gateWhyKey(g: Pick<GateStatus, 'state' | 'why'>): MessageKey | null {
  if (!g.why) return null
  if (g.state === 'held' && g.why === 'upstream') return GATE_WHY_HELD_KEY.upstream
  return GATE_WHY_KEY[g.why]
}
