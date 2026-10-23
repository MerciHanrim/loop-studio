import type { ConnectReason, ConnectVerdict } from '../model/connectKind'
import type { LoopNode } from '../model/types'
import type { MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'

// The sentence a refused connection kind says (direction B): drawing on the
// canvas (the status bar) and a kind change in the Inspector read the same
// words. The port reasons are the end-move ones (docs/edge-routing.md §ER18) —
// the same rule, the same sentence; the kind's state rules have their own.

const KEY: Record<ConnectReason, MessageKey> = {
  noInput: 'inspector.ends.reason.noInput',
  noOutput: 'inspector.ends.reason.noOutput',
  noPorts: 'inspector.ends.reason.noPorts',
  duplicate: 'inspector.ends.reason.duplicate',
  missing: 'inspector.ends.reason.missing',
  conditionSource: 'connect.refused.conditionSource',
  changePool: 'connect.refused.changePool',
  changeRouterSource: 'connect.refused.changeRouterSource',
  changeTarget: 'connect.refused.changeTarget',
  stateMode: 'connect.refused.stateMode',
}

const nameOf = (nodes: LoopNode[], id: string): string => {
  const n = nodes.find((x) => x.id === id)
  return ((n?.data as { label?: unknown } | undefined)?.label as string | undefined) || id
}

/** a refusal, with the two ends of the connection it was about */
export type ConnectRefusal = { verdict: Extract<ConnectVerdict, { ok: false }>; source: string; target: string }

export function connectReasonText(t: (key: MessageKey, args?: Record<string, string | number>) => string, r: ConnectRefusal, nodes: LoopNode[]): string {
  return t(KEY[r.verdict.reason], {
    node: isolateAuto(nameOf(nodes, r.verdict.node)),
    from: isolateAuto(nameOf(nodes, r.source)),
    to: isolateAuto(nameOf(nodes, r.target)),
  })
}
