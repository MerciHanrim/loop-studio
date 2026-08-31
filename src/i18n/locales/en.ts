// docs/localization.md §L3.3 — the CANONICAL catalog. `en.ts` defines the key
// set and the message shape; every other locale is `… satisfies MessageCatalog`
// so `tsc` fails on a missing or an extra key. Keys are flat, stable, ASCII IDs
// — never the English text, never derived from user data. Values are ICU
// messages (`intl-messageformat`); a `{name}` slot is a runtime value, never a
// concatenated translatable fragment (§L4.2). No rich-text tags in Slice 1
// (§L4.1).
//
// Slice 1 scope (§L13): the Toolbar + the Play bar (desktop and mobile) and the
// PlaybackAnnouncer live-region templates.
// Slice 2a adds the model work surface — Canvas / Inspector / Timeline product
// UI text, the two-layer node-palette tip, and the user-facing diagnostic
// message text for a stable `{code}` (§L7). NOT translated (raw model data):
// node/edge `label`, expression text, `unit`, `resourceType`, an Inspector raw
// value, and every wire enum token (`pullAny`, `deterministic`, `passive`, …),
// shown as-is. The app work surface (Import/Export, Templates, revision UI, the
// PWA bar, empty/error states outside the model surface) stays English until 2b.

const en = {
  // ── i18n internals ─────────────────────────────────────────────────────
  // shown only if a message fails to format even after the `en` fallback
  // (§L4.4) — a stable notice carrying the key, never the raw ICU pattern.
  'i18n.messageError': 'text unavailable ({key})',

  // ── Toolbar / brand ────────────────────────────────────────────────────
  'toolbar.preview': 'preview',
  'toolbar.buildTitle': 'Loop Studio v{version} · build {sha}',

  // node palette — the two-layer tip (§L13 / Slice 2a). `.name` is the short
  // label AND the button's accessible name; `.description` is the semantic line
  // (what the node does, matched to SEMANTICS-*); `.addAction` is the how-to
  // line. Rendered on SEPARATE DOM lines, never concatenated. A click still
  // creates a node with the locale-independent `defaultData()` label (§L3.4).
  'palette.pool.name': 'Pool',
  'palette.pool.description':
    'Holds resources and shows the current amount; it has a capacity and pushes back when full.',
  'palette.source.name': 'Source',
  'palette.source.description':
    'Produces new resources each step and pushes them to the nodes it feeds.',
  'palette.drain.name': 'Drain',
  'palette.drain.description':
    'Pulls resources from the nodes it draws on and removes them from the system.',
  'palette.gate.name': 'Gate',
  'palette.gate.description':
    'Pulls resources and splits them across its outgoing connections by a fixed ratio or by probability; holds nothing.',
  'palette.converter.name': 'Converter',
  'palette.converter.description':
    'Consumes its inputs and produces its outputs at its own ratio; holds nothing.',
  'palette.end.name': 'End',
  'palette.end.description': 'Stops the run the moment a resource reaches it.',
  'palette.parameter.name': 'Parameter',
  'palette.parameter.description':
    'A fixed number you tune. It has no ports — reference it by id from an expression.',
  'palette.register.name': 'Register',
  'palette.register.description':
    'Shows a value computed from the current step by an expression. It stores nothing and has no ports.',
  'palette.addAction': 'Click, or drag onto the canvas, to add one.',

  'toolbar.undo.title': 'Undo (Ctrl/Cmd+Z)',
  'toolbar.redo.title': 'Redo (Ctrl/Cmd+Shift+Z)',
  'toolbar.new': 'New',
  'toolbar.import': 'Import',

  'toolbar.newGraph.title': 'Start a new graph?',
  'toolbar.newGraph.body': 'Your current graph will be replaced.',
  'toolbar.newGraph.confirm': 'New graph',

  // ── Theme toggle ───────────────────────────────────────────────────────
  'theme.rowLabel': 'Theme',
  'theme.title': 'Theme: system / light / dark',
  'theme.auto': '◐ Auto',
  'theme.light': '☀ Light',
  'theme.dark': '☾ Dark',

  // ── Language menu (auto-generated from the registry) ───────────────────
  'lang.rowLabel': 'Language',
  'lang.title': 'Language',
  'lang.menuLabel': 'Choose a language',
  'lang.loading': 'loading…',

  // ── Play bar (desktop `PlayBar`, mobile `MobileRunBar`) ─────────────────
  'playbar.reset.title': 'Reset to step 0',
  'playbar.step.title': 'Advance one step',
  'playbar.play': '▶ Play',
  'playbar.pause': '⏸ Pause',
  'playbar.replay': '⟳ Replay',
  'playbar.step': 'step {n}',
  'playbar.stepEnded': 'step {n} · ended',
  'playbar.speed': 'speed',
  'playbar.seed': 'seed',
  'playbar.seed.title': 'Random seed — same seed reproduces the run; changing it restarts',
  'playbar.mc': 'Monte Carlo',
  'playbar.mc.withNote': 'Monte Carlo · {note}',
  'playbar.mc.title': 'Run the diagram many times and see the distribution',
  'playbar.mc.progress': 'Monte Carlo {pct}%',
  'playbar.mc.progress.title': 'Monte-Carlo run in progress',
  'playbar.cancel': 'Cancel',
  'playbar.timeline.show': 'Show timeline',
  'playbar.timeline.hide': 'Hide timeline',
  'runbar.ariaLabel': 'Run controls',
  'runbar.mc.cancel': 'MC {pct}% · Cancel',
  'runbar.timeline': 'Timeline',

  // ── Mobile top bar ─────────────────────────────────────────────────────
  'mobile.topbar.caption': 'view & run — edit on desktop',
  'mobile.more': 'More',

  // ── Playback announcer — the a11y live region (logic unchanged) ─────────
  'a11y.playback.started': 'Playback started',
  'a11y.playback.endedAtStep': 'Ended at step {n}',
  'a11y.playback.resetToZero': 'Reset to step 0',
  'a11y.playback.stepN': 'Step {n}',
  'a11y.playback.pausedAtStep': 'Paused at step {n}',

  // ═══ Slice 2a — the model work surface ════════════════════════════════════

  // ── Canvas ─────────────────────────────────────────────────────────────
  'canvas.minimap': 'Graph minimap',

  // ── Inspector — shared ────────────────────────────────────────────────
  'inspector.delete': 'Delete',
  'inspector.field.label': 'Label',
  'inspector.empty.title': 'Select a node or connection to edit it.',
  'inspector.empty.hint':
    'Drag a piece from the top bar onto the canvas, then drag between the dots on each side to wire them together.',
  'inspector.unreadable.note':
    "This node's data can't be read ({detail}). It is loaded as-is and left out of the model — fix it in the file, or delete the node.",
  'inspector.unreadable.detailFallback': 'the data is not a readable object',
  'inspector.field.rawData': 'Raw data',

  // ── Inspector — node fields ───────────────────────────────────────────
  'inspector.field.activation': 'Activation',
  'inspector.node.endNote': 'Stops the run the moment a resource reaches it.',
  'inspector.field.startingAmount': 'Starting amount',
  'inspector.field.capacity': 'Capacity (blank = unlimited)',
  'inspector.field.flowMode': 'Flow mode',
  'inspector.field.distribution': 'Distribution',
  'inspector.field.value': 'Value',
  'inspector.field.unit': 'Unit (advisory)',
  'inspector.field.min': 'Min (advisory)',
  'inspector.field.max': 'Max (advisory)',
  'inspector.field.step': 'Step (advisory)',
  'inspector.field.expression': 'Expression',
  'inspector.field.format': 'Format (advisory)',

  // ── Inspector — resource type (advisory) ──────────────────────────────
  'inspector.field.resourceType': 'Resource type (advisory)',
  'inspector.resourceType.placeholder': 'Gold, Energy, XP, Player, Item, or a custom name',
  'inspector.resourceType.tooLong': 'Over {max} bytes — this tag will be dropped on export.',
  'inspector.resourceType.normalised': 'Normalised to “{value}”.',
  'inspector.resourceType.custom': 'Custom type — generic swatch; no built-in colour.',
  'inspector.resourceType.mismatch':
    'Type mismatch: {pairs}. Advisory only — it changes no amount and blocks no run.',

  // ── Inspector — parameter ────────────────────────────────────────────
  'inspector.parameter.outOfRange':
    'The value is outside the advisory min/max — kept as-is, not clamped.',
  'inspector.parameter.hintIncoherent':
    'An advisory hint is incoherent and will be dropped on export.',
  'inspector.parameter.noPorts':
    'A Parameter has no ports — reference it by id from an expression.',

  // ── Inspector — register ────────────────────────────────────────────
  'inspector.register.canonical': 'Canonical form: {canonical} (saved on export)',
  'inspector.register.invalidAtStep': '{code} · {reason} — no value at step {step}.',
  'inspector.register.valueAtStep': 'Value at step {step}: {value}',
  'inspector.register.recomputed': '(recomputed from the graph — never stored)',
  'inspector.register.formatInvalid': 'Unrecognised format — will fall back to float on export.',
  'inspector.register.noStore': 'A Register stores nothing and has no ports.',

  // ── Inspector — edge ────────────────────────────────────────────────
  'inspector.edge.kindLink': '{kind} link',
  'inspector.field.type': 'Type',
  'inspector.edge.type.resource': 'resource — carries resources',
  'inspector.edge.type.state': 'state — reads a value, modifies target',
  'inspector.field.flow': 'Flow',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.field.route': 'Route',
  'inspector.edge.route.curved': 'Curved',
  'inspector.edge.route.orthogonal': 'Orthogonal',
  'inspector.edge.note':
    'Editing a connection restarts the run at step 0 and clears any pending triggers; a finished Monte-Carlo result is marked stale.',

  // ── Inspector — state edge ─────────────────────────────────────────
  'inspector.field.mode': 'Mode',
  'inspector.edge.mode.trigger': 'trigger — pulse the target to fire',
  'inspector.edge.mode.activator': 'activator — enable / disable the target',
  'inspector.edge.mode.label': 'label — add to / set the target Pool',
  'inspector.field.delay': 'Delay — steps before the pulse is delivered',
  'inspector.delay.ok': 'delivered at (fired + delay + 1); 0 means the next step.',
  'inspector.delay.bad':
    'use a whole number ≥ 0 — the engine runs any other value as 0 and leaves what you typed untouched.',
  'inspector.field.condition': 'Condition — comparison against the source',
  'inspector.field.modifier': 'Modifier — change applied each step',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect': '{hint} — until it parses, this connection has no effect.',
  'inspector.activator.describe': 'target is enabled while the source {op} {n}',
  'inspector.label.describe.set': 'sets the target Pool to {amount} each step',
  'inspector.label.describe.add': 'adds {amount} to the target Pool each step',
  'inspector.label.describe.subtract': 'subtracts {amount} from the target Pool each step',
  'inspector.label.amountSource': "the source Pool's value",
  'inspector.legacy.note':
    'Unsupported connection. Mode {mode} is not executed — this link has no effect on the simulation. Loop Studio never converts it automatically; pick what it should become, then convert it explicitly.',
  'inspector.legacy.convertTo': 'Convert to',
  'inspector.legacy.convertButton': 'Convert to {mode}',

  // ── stateExpr hints — a structured reason → inline editor text (§L7) ──
  'stateExpr.activator.hint.empty': 'enter a comparison, e.g. >= 5',
  'stateExpr.activator.hint.opOnly': 'add a number, e.g. >= 5',
  'stateExpr.activator.hint.notAComparison': 'use >= <= > < == != then a number',
  'stateExpr.activator.hint.nonFinite': 'the number must be finite',
  'stateExpr.label.hint.empty': 'enter a modifier, e.g. +1 or =S',
  'stateExpr.label.hint.notAnAssignment': 'use + - or = then a number or S',
  'stateExpr.label.hint.nonFinite': 'the number must be finite',

  // ── Timeline ───────────────────────────────────────────────────────
  'timeline.title': 'timeline',
  'timeline.view.live': 'LIVE',
  'timeline.view.distribution': 'DISTRIBUTION',
  'timeline.legend.hide': 'Hide {label}',
  'timeline.legend.show': 'Show {label}',
  'timeline.legend.register': 'Register {label}',
  'timeline.csv': 'CSV',
  'timeline.csvTitle': 'Download the run as CSV',
  'timeline.axis.step': 'step {n}',
  'timeline.sheetTitle': 'Timeline',

  // ── Mobile Inspector sheet ─────────────────────────────────────────
  'mobile.inspector.title': 'Inspector — read only',
  'mobile.inspector.roNote': 'Editing is on desktop. This is a read-only view.',

  // ── Node face — synthetic cues for an unreadable / invalid model node ──
  'node.unreadable.title': 'unreadable {kind}',
  'node.unreadable.sub': 'data cannot be read — fix it in the file',
  'node.invalidFlag': 'This node is invalid',

  // ── Diagnostics — user-facing message text for a stable {code} (§L7) ──
  // The CODE itself is shown verbatim by the caller; this is only the prose.
  // `params` carry substitution ATOMS (a column number, a quoted char) — never
  // a translatable sentence.
  'error.unknownCode': 'the expression is invalid',
  'error.M_REG_PARSE.message': 'the expression does not parse',
  'error.M_REG_EVAL.message':
    'the expression evaluates to an error (division by zero / non-finite)',
  'error.M_REG_UNKNOWN_REF.message': 'a reference names no node in the graph',
  'error.M_REG_WRONG_KIND.message':
    'a reference names a node that is not a pool / parameter / register',
  'error.M_REG_INVALID_ID.message': 'a referenced id contains an unusable control character',
  'error.M_REG_CYCLE.message': 'this Register is on a dependency cycle',
  'error.M_REG_DEPENDS_ON_INVALID.message': 'this Register depends on another invalid Register',
  'error.EXPR_EMPTY.message': 'the expression is empty',
  'error.EXPR_SYNTAX.message': 'there is a syntax error at column {column}',
  'error.EXPR_UNCLOSED_PAREN.message': '“(” at column {column} is never closed',
  // literal braces are ICU-quoted ('{' / '}') so the pattern parses (§L4.1)
  'error.EXPR_UNCLOSED_REF.message': "“@'{'” at column {column} is never closed",
  'error.EXPR_BAD_ESCAPE.message': "“\\” at column {column} must be followed by “'}'” or “\\”",
  'error.EXPR_NUMBER_RANGE.message': 'the number at column {column} is too large',
  'error.EXPR_BAD_TOKEN.message': 'there is a stray character at column {column}',
} as const

/** the canonical key set — every catalog is `Record<MessageKey, string>` */
export type MessageKey = keyof typeof en
export type MessageCatalog = Record<MessageKey, string>

export default en
