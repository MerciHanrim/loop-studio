import type { ConnectKind } from '../model/connectKind'
import type { MessageKey } from '../i18n'

// The words of each connection kind (direction B, src/model/connectKind.ts):
// its name and a one-line hint, as literal catalog keys (the tool row's Connect
// choice, the right panel's kind chip and kind field read the same words).

export const CONNECT_LABEL: Record<ConnectKind, MessageKey> = {
  flow: 'connect.kind.flow',
  condition: 'connect.kind.condition',
  change: 'connect.kind.change',
  trigger: 'connect.kind.trigger',
}

export const CONNECT_HINT: Record<ConnectKind, MessageKey> = {
  flow: 'connect.kind.flow.hint',
  condition: 'connect.kind.condition.hint',
  change: 'connect.kind.change.hint',
  trigger: 'connect.kind.trigger.hint',
}
