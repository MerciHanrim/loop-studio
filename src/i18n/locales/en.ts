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
  // the Canvas edit-lock toggle in the React Flow controls
  'canvas.lock.lock': 'Lock editing — selecting and reading stay on',
  'canvas.lock.unlock': 'Unlock editing — move, connect, and change values',
  // docs/large-graph-readability.md §LGR2.1 — the Focus toggle (canvas controls
  // on desktop, the More sheet on mobile). `.on` / `.off` name the CURRENT
  // state so the tooltip reads as "state — action": shown OFF ⇒ `.on`.
  'canvas.focus.on': 'Focus off — click to focus the selected node',
  'canvas.focus.off': 'Focus on — click to show the whole graph',
  'canvas.focus.hint': 'Select a node to focus on',
  'canvas.focus.rowLabel': 'Focus selection',
  'canvas.focus.stateOn': 'On',
  'canvas.focus.stateOff': 'Off',
  // docs/dense-graph-pan.md — the desktop Pan mode toggle (canvas controls).
  // `.on` / `.off` name the CURRENT state, like the Focus toggle: shown OFF ⇒
  // `.off` text. Session-only, never persisted.
  'canvas.panMode.off': 'Pan mode off — drag empty canvas to pan',
  'canvas.panMode.on': 'Pan mode on — drag anywhere to pan',
  'canvas.panMode.rowLabel': 'Pan mode',
  // docs/large-graph-readability.md §LGR3.2 — the transient-filter panel. Toggle
  // in the canvas controls on desktop, the More sheet on mobile. Selections are
  // ephemeral (cleared on graph reload / Reset view); the panel open state is a
  // sticky preference.
  'canvas.filter.open': 'Filters — hide parts of the graph while exploring',
  'canvas.filter.close': 'Close the filter panel',
  'canvas.filter.title': 'Filters',
  'canvas.filter.rowLabel': 'Filters',
  'canvas.filter.groupEdgeClass': 'Edge type',
  'canvas.filter.groupResourceType': 'Resource type',
  'canvas.filter.groupNodeKind': 'Node kind',
  'canvas.filter.edgeClass.resource': 'Resource',
  'canvas.filter.edgeClass.state': 'State',
  'canvas.filter.edgeClass.hint': 'Dependency hint',
  'canvas.filter.untyped': 'untyped',
  'canvas.filter.clear': 'Clear filters',
  'canvas.filter.hiddenCount': '{n} hidden',
  'canvas.filter.none': 'Nothing hidden',
  'canvas.filter.checkboxHint': 'checked = hidden',
  // node-kind names (title case) — reused as the filter list labels
  'canvas.nodeKind.source': 'Source',
  'canvas.nodeKind.pool': 'Pool',
  'canvas.nodeKind.gate': 'Gate',
  'canvas.nodeKind.converter': 'Converter',
  'canvas.nodeKind.drain': 'Drain',
  'canvas.nodeKind.end': 'End',
  'canvas.nodeKind.parameter': 'Parameter',
  'canvas.nodeKind.register': 'Register',
  // docs/large-graph-readability.md §LGR3.4 / LGR-D4 — one action: fit the graph
  // to the viewport and clear the exploration lens (filter selections + the
  // focused node). The Focus mode on/off preference is left as-is.
  'canvas.resetView': 'Reset view — fit the graph and clear filters / focus',
  // docs/large-graph-readability.md §LGR6 — transient group frames + the opt-in
  // activity overlay. Session-only readability aids; never in the saved doc.
  'canvas.frame.draw': 'Group frame — drag on empty canvas to draw one',
  'canvas.frame.drawing': 'Group frame — drawing; drag on empty canvas, Esc to cancel',
  'canvas.frame.defaultName': 'Group {n}',
  'canvas.frame.delete': 'Delete this frame',
  // docs/large-graph-readability-auto-frames.md §AF — "Suggest frames" (Slice 4b)
  'canvas.frame.suggest': 'Suggest frames — rough grouping rectangles around structurally-connected nodes. Structural only; not domain meaning.',
  'canvas.frame.suggestStale': 'Suggest frames — the graph changed; click to recompute the suggested groups',
  'canvas.frame.suggestRow': 'Suggest frames',
  'canvas.frame.suggestNote': 'Suggested structural groups — they may not match how you would divide the work.',
  'canvas.frame.suggestNoteDismiss': 'Dismiss this note',
  'canvas.frame.areaName': 'Area {n}',
  'canvas.frame.dismiss': 'Dismiss this suggested frame',
  'canvas.frame.clearAll': 'Clear all frames',
  'canvas.frame.clearSuggested': 'Clear suggested frames',
  'canvas.frame.clearSuggestedRow': 'Clear suggested frames',
  'canvas.frame.colorRow': 'Frame colour',
  'canvas.frame.color.neutral': 'Neutral',
  'canvas.frame.color.slate': 'Slate',
  'canvas.frame.color.sage': 'Sage',
  'canvas.frame.color.gold': 'Gold',
  'canvas.frame.color.violet': 'Violet',
  'canvas.frame.color.rose': 'Rose',
  'canvas.activity.off': 'Activity overlay off — click to tint recently active parts',
  'canvas.activity.on': 'Activity overlay on — click to hide the tint',
  'canvas.activity.rowLabel': 'Activity overlay',
  'canvas.route.invalidFlag': 'invalid route — a route point is inside a node',
  // in-canvas edge-label annotations for a state / playback step
  'canvas.edgeLabel.clamp': 'clamp',
  'canvas.edgeLabel.clamp.title': "removed by the target Pool's single end-of-Phase-0 clamp",
  'canvas.edgeLabel.blocked': 'blocked',
  'canvas.edgeLabel.blocked.title':
    'delivered, but the target could not fire (wrong activation, or an activator held it closed)',
  'canvas.edgeLabel.breakdown.title': "this step's transfers along this edge",

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

  // ── Wire-enum OPTION labels — the human-readable text of a <select>; the
  //    <option value> stays the wire token, GraphDoc / digest are unchanged
  //    (docs/localization.md §L3.4). Raw-data fallback, diagnostic codes, and
  //    the Canvas raw-state readout keep the bare token.
  'enum.activation.passive': 'passive',
  'enum.activation.automatic': 'automatic',
  'enum.activation.onStart': 'onStart',
  'enum.activation.interactive': 'interactive',
  'enum.flowMode.pullAny': 'pull any',
  'enum.flowMode.pullAll': 'pull all',
  'enum.flowMode.pushAny': 'push any',
  'enum.flowMode.pushAll': 'push all',
  'enum.distribution.deterministic': 'deterministic',
  'enum.distribution.probabilistic': 'probabilistic',
  'enum.format.int': 'int',
  'enum.format.float': 'float',
  'enum.format.percent': 'percent',
  'enum.stateMode.trigger': 'trigger',
  'enum.stateMode.activator': 'activator',
  'enum.stateMode.label': 'label',

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
  'inspector.edge.flowParam.pickLabel': 'Drive with a parameter',
  'inspector.edge.flowParam.literalOption': '— literal value —',
  'inspector.edge.flowParam.resolved': '= {value}',
  'inspector.edge.flowParam.unknown': 'no parameter “{id}” — this connection contributes 0',
  'inspector.edge.flowParam.notParam': '“{id}” is not a parameter — this connection contributes 0',
  'inspector.edge.flowParam.malformed':
    'not a valid parameter reference — this connection contributes 0',
  'inspector.edge.flowParam.hint':
    'A parameter reference is kept by id: renaming the parameter is fine; deleting it leaves the reference dangling (it is not rewritten).',
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
  'timeline.legend.more': '+{n} more',
  'timeline.legend.fewer': 'Show fewer',
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
  'node.evaluatedCue': 'Evaluated this step but did not act',

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

  // ═══ Slice 2b-1 — small app chrome: Share · PWA bar · import · rev chip ═══

  // ── shared dialog / sheet chrome ──────────────────────────────────────
  'dialog.cancel': 'Cancel',
  'dialog.close': 'Close',

  // ── Share (SEMANTICS-U.md §U7) — the disclosure is now an in-app dialog;
  //    the link build + clipboard write run inside the Confirm click (§U4) ──
  'share.button': 'Share',
  'share.button.title': 'Copy a link that opens this diagram',
  'share.disclosure.title': 'Create a share link?',
  'share.disclosure.body':
    'The link contains this entire diagram, including every label — anyone with it can open and edit the diagram. It is not uploaded to a server, but it travels inside the link, so it stays in your browser history and is visible to anyone you send it to.',
  'share.disclosure.confirm': 'Create link',
  'share.tooLarge':
    'This diagram is too large for a share link ({size}; the limit is {cap}). Use Export ▾ → Graph JSON and share the file instead.',
  'share.noBase':
    'Share is not configured with a public address, so a link cannot be created. Please report this.',
  'share.panel.label': 'Share link',
  'share.panel.copied': 'Link copied to the clipboard.',
  'share.panel.copyThis': 'Copy this link:',
  'share.panel.copyAgain': 'Copy again',
  'share.panel.copy': 'Copy',
  'share.panel.close': 'Close',

  // ── PWA update bar (docs/pwa.md §P4.2) ─────────────────────────────────
  'pwa.text':
    'A new version of Loop Studio is ready. Applying it reloads the app and resets the current run and any unsaved results. Your diagram is saved.',
  'pwa.update': 'Update',
  'pwa.dismiss': 'Dismiss',
  'pwa.running.title': 'A run is in progress',
  'pwa.running.body':
    'Applying the update reloads the page and ends the current run. Apply it anyway?',
  'pwa.running.confirm': 'Apply and reload',

  // ── Boot notice (SEMANTICS-R.md §R8) ──────────────────────────────────
  'bootNotice.dismiss': 'Dismiss',
  'bootNotice.proposalReboot':
    'This session was editing a proposal. The base it was made from is not saved on this device, so it reopened as a plain graph — your edits are kept. Re-import the proposal file to review or re-export it.',

  // ── Revision chip (SEMANTICS-R.md §R2 / §R8) ─────────────────────────
  'revChip.proposal': 'proposal',
  'revChip.rev': 'rev {id}',
  'revChip.title': 'Project {project} · {role} {revision}',
  'revChip.titleDirty': 'Project {project} · {role} {revision} · unsaved changes since this revision',
  'revChip.unsaved': 'unsaved changes',

  // ── Import replace flow (Toolbar + MobileTopBar) ─────────────────────
  'import.replace.title': 'Replace the current diagram?',
  'import.replace.body': 'The imported file will replace what is on the canvas now.',
  'import.replace.confirm': 'Replace',
  'import.readError': 'Could not read that file.',

  // ── React Flow a11y (the `ariaLabelConfig` on <ReactFlow>) ───────────
  'rf.controls.label': 'Canvas controls',
  'rf.controls.zoomIn': 'Zoom in',
  'rf.controls.zoomOut': 'Zoom out',
  'rf.controls.fitView': 'Fit the diagram to the view',
  'rf.controls.interactive': 'Toggle canvas editing',
  'rf.handle.label': 'Connection point',
  'rf.node.a11y': 'Press Enter or Space to select this node. Press Delete to remove it, Escape to cancel.',
  'rf.node.a11yKeyboard':
    'Press Enter or Space to select this node, then the arrow keys to move it. Press Delete to remove it, Escape to cancel.',
  'rf.edge.a11y':
    'Press Enter or Space to select this connection. Press Delete to remove it, Escape to cancel.',

  // ═══ Slice 2b-2a — Templates · Export / Workspace · Author dialog ═══════

  // ── Mobile More sheet rows ───────────────────────────────────────────
  'mobile.more.import': 'Import file',
  'mobile.more.importSub': 'Graph or Workspace JSON',

  // ── Templates picker ──────────────────────────────────────────────────
  'templates.button': 'Templates ▾',
  'templates.menuLabel': 'Templates',
  'templates.equilibrium.name': 'Flowing equilibrium',
  'templates.equilibrium.blurb':
    'Source feeds a vault, a gate splits 2:1 into a refiner and a drain, and a second drain bleeds the product. Settles to a steady state (Vault 3, Product 1).',
  'templates.deadlock.name': 'Bottleneck deadlock',
  'templates.deadlock.blurb':
    'The same system with no outlet on the product pool. It fills to capacity, the gate stalls, the vault backs up, and the source is throttled to zero — a stable frozen state.',
  'templates.mmoProgression.name': 'Early MMO progression (levels 1–15)',
  'templates.mmoProgression.blurb':
    'A connected play economy: three zone lanes (1–5 / 5–10 / 10–15), probabilistic combat with wins, setbacks and deaths, categorised loot, a gold economy with repair and resupply costs, and a rising XP-per-level curve. Run it or Monte-Carlo it to see how wide the time-to-15 spreads.',
  'templates.coffeeRoastery.name': 'Coffee roastery operations flow',
  'templates.coffeeRoastery.blurb':
    'An operating-flow simulation for looking at how roasting, sales and stock relate, simplified: green beans arrive, some are sold on, the rest are roasted and sold through cafe / online / retail. Change five daily operating values and watch the stock trajectories and the projected results move. A simplified simulation example — not an ERP or real-time monitoring system.',
  'templates.replace.title': 'Replace the current diagram?',
  'templates.replace.body': 'Loading “{name}” replaces what is on the canvas now.',
  'templates.replace.confirm': 'Load template',

  // ── Insert module menu (docs/module-system.md §MS6) ───────────────────
  'modules.button': 'Insert module ▾',
  'modules.menuLabel': 'Insert module',
  'modules.fromFile': 'From file…',
  'modules.extract': 'Extract selection as module…',
  'modules.bufferedStep.name': 'Buffered production step',
  'modules.bufferedStep.blurb':
    'Supply into an inbox pool, an intake gate that splits into a 2→1 converter and a spoilage drain, then an outbox pool that ships out — with readouts for units in system and a planned run size.',
  'modules.rewardSplit.name': 'Reward split loop',
  'modules.rewardSplit.blurb':
    'Activity feeds a wallet; an allocate gate splits it 2:1 into spending and savings, savings bleeds through withdrawals, and two registers track net worth and progress toward a target.',
  'modules.error.title': 'Could not insert the module',
  'modules.promote.title': 'Make this a parameter-driven (v2) model?',
  'modules.promote.body':
    'Inserting this block turns the document into a v2 model and the model-semantics digest changes. A single undo reverses the model change and the insert together.',
  'modules.promote.confirm': 'Promote and insert',
  'modules.frames.title': 'Saved frames are not included',
  'modules.frames.insertBody':
    'This file has saved group frames. Inserting it as a module does not bring frames into your graph — everything else is inserted as usual.',
  'modules.frames.extractBody':
    'Your graph has saved group frames. They are not written into the module file — only the selected nodes and their internal connections are.',
  'modules.frames.continue': 'Continue',

  // ── Inputs / Summary panels (docs/module-system.md §MS5) ──────────────
  'panels.inputs.title': 'Inputs',
  'panels.summary.title': 'Summary',
  'panels.inputs.collapse': 'Collapse the Inputs panel',
  'panels.inputs.expand': 'Expand the Inputs panel',
  'panels.summary.collapse': 'Collapse the Summary panel',
  'panels.summary.expand': 'Expand the Summary panel',
  // the Parameter's / Register's own label is raw model data, rendered as-is
  // (§L3.4) — not a catalog string.
  'panels.inputs.paramValue': 'Value of {label}',
  // a v2 resource edge whose flow is a parameter reference — read-only pointer
  'panels.inputs.flowVia': 'flow via {param}',
  'panels.inputs.reveal': 'Show on the canvas',
  'panels.summary.showCalc': 'Show calculation',
  'panels.summary.hideCalc': 'Hide calculation',
  'panels.summary.noValue': '— no value at step {step}',
  'panels.empty.inputs': 'No Parameters in this graph.',
  'panels.empty.summary': 'No Registers in this graph.',

  // ── Export menu (§W8) ────────────────────────────────────────────────
  'export.button': 'Export ▾',
  'export.menuLabel': 'Export',
  'export.graphJson.name': 'Graph JSON',
  'export.graphJson.blurb': 'the diagram + recommended run settings',
  'export.workspaceJson.name': 'Workspace JSON',
  'export.workspaceJson.blurb': 'graph + distribution + view + the live run',
  'export.projectRevision.name': 'Project revision',
  'export.projectRevision.blurb': 'diagram + project id & lineage, for offline collaboration',
  'export.proposal.name': 'Make a proposal',
  'export.proposal.blurb': 'a copy to edit and send back for review',
  'export.proposal.needRevision': 'Export a Project revision first',
  'export.author.name': 'Author for exports…',
  'export.author.blurb': 'device-local label attached, unverified, to the file',

  // ── Project-revision disclosure → ConfirmDialog (SEMANTICS-R.md §R2.1) ──
  'export.projectRevision.disclosure.title': 'Export a Project revision?',
  'export.projectRevision.disclosure.body':
    'The file is a normal Graph JSON that also carries a project identity and this revision’s lineage, so a collaborator can diff and apply your changes entirely offline. No account and no server — everything travels in the file.',
  'export.projectRevision.disclosure.confirm': 'Export revision',

  // ── Workspace-JSON summary → ConfirmDialog (§W4) ─────────────────────
  'export.workspace.title': 'Save this workspace?',
  'export.workspace.included': 'Includes: {items}.',
  'export.workspace.excluded': 'Not included: undo history, selection, theme.',
  'export.workspace.confirm': 'Save workspace',
  'export.workspace.item.runConfig': 'run config',
  'export.workspace.item.distribution': 'the {runs}-run distribution',
  'export.workspace.item.timeline': 'the timeline view',
  'export.workspace.item.canvas': 'the canvas position',
  'export.workspace.item.liveRun': 'the live run at step {step}',
  'export.workspace.omit.body':
    'The distribution makes this {full} — over the {limit} limit. Save without the distribution ({lean})?',
  'export.workspace.omit.confirm': 'Save without it',
  'export.workspace.reject':
    'This workspace is {size} — over the {limit} limit even without the distribution. Trim the graph, or use Graph JSON.',

  // ── Author-for-exports dialog (SEMANTICS-R.md §R8) ──────────────────
  'author.title': 'Author for exports',
  'author.name': 'Name',
  'author.namePlaceholder': 'e.g. Alex',
  'author.note': 'Note (optional)',
  'author.notePlaceholder': 'a short message that travels with the file',
  'author.disclosure':
    'This name is stored only on this device. It is attached — unverified — to every Project revision and proposal you export and travels inside the file you send. Anyone can edit it; treat it as a label, not an identity.',
  'author.save': 'Save',

  // ═══ Slice 2b-2b — Monte Carlo dialog · Review proposal ════════════════
  // Only the UI chrome (titles / buttons / descriptions / empty states / a11y
  // names). Diff hunk contents, field values, stats, and revision ids are shown
  // verbatim.

  // ── Monte Carlo setup dialog ─────────────────────────────────────────
  'mc.title': 'Monte Carlo',
  'mc.close': 'Close',
  'mc.closeKeepRunning': 'Close (keep running)',
  'mc.field.runs': 'runs',
  'mc.field.steps': 'steps',
  'mc.field.baseSeed': 'base seed',
  'mc.pools.head': 'tracked pools',
  'mc.pools.headAll': 'tracked · all pools',
  'mc.pools.headSome': 'tracked · {n} of {total}',
  'mc.pools.selectAll': 'Select all',
  'mc.pools.none': 'No Pools in the graph — add one to run.',
  'mc.pools.group': 'Tracked Pools',
  'mc.pools.keepOne': 'At least one Pool must stay tracked.',
  'mc.cost.estimating': 'estimating…',
  'mc.cost.measured': 'Measured (last run)',
  'mc.cost.benchmark': 'Local benchmark',
  'mc.cost.execution': 'Execution',
  'mc.cost.parallel': 'Parallel, {workers} workers',
  'mc.cost.localPause': 'Local · may briefly pause',
  'mc.cost.local': 'Local',
  'mc.cost.memory': 'Memory',
  'mc.cost.overLimit': ' — over the limit, reduce runs / steps',
  'mc.run': 'Run {runs} runs',
  'mc.cancel': 'Cancel',

  // ── Review proposal (SEMANTICS-R.md §R7 / §R7A / §R10.5) ────────────
  'review.title': 'Review proposal',
  'review.close': 'Close',
  'review.byPrefix': 'Proposed by',
  'review.byAnon': 'Proposal',
  'review.unverified': '· unverified',
  'review.fileSays': 'file says: {stamp}',
  'review.differentProject': 'Different project id from the one you have open.',
  'review.diff.none': 'No graph changes.',
  'review.diff.nodes': 'Nodes',
  'review.diff.edges': 'Edges',
  'review.diff.runConfig': 'run config',
  'review.diff.frames': 'frames',
  'review.gate.wrongProject':
    'This proposal belongs to a different project. You can still open it as a document.',
  'review.gate.noTarget': 'No project is open. Open this proposal as a document, or cancel.',
  'review.gate.targetIsProposal':
    'You currently have a proposal open. Export it as a Project revision before applying another proposal onto it.',
  'review.class.exact': 'Your open revision is exactly the base this proposal was made from.',
  'review.class.divergent':
    'Your open revision has changes that overlap this proposal. Applying the whole proposal discards them.',
  'review.class.unknown':
    "Your open revision has changes and the files can't prove how the two are related. No field conflicts were found.",
  'review.confirm.default':
    'This proposal was made from an earlier revision. Applying the whole proposal replaces your graph with its version — your changes since then are lost. Undo reverts it.',
  'review.confirm.unknown':
    "This proposal was made from an earlier revision, and their relationship can't be determined from the files. Applying the whole proposal replaces your graph with its version — your changes since then are lost. Undo reverts it.",
  'review.err.targetMoved':
    'The document changed since you confirmed — review the change and apply again.',
  'review.err.targetMovedList':
    'The document changed while you were choosing — the list below is updated. Review and apply again.',
  'review.err.noEffect': "Those choices don't change anything — nothing to apply.",
  'review.err.generic': 'Could not apply ({reason}).',
  'review.fail.wrongProject': 'This proposal is for a different project.',
  'review.fail.noTarget': 'No project is open to apply onto.',
  'review.fail.targetIsProposal': 'Export the open proposal as a Project revision first.',
  'review.fail.payloadInvalid': 'This proposal file failed its integrity check — re-import it.',
  'review.fail.invalidSelection':
    "That selection can't be applied — an accepted edge needs a node you didn't include. Adjust the choices and try again.",
  'review.hunks.none': 'Nothing new to apply — the target already matches.',
  'review.hunk.add': 'Add',
  'review.hunk.remove': 'Remove',
  'review.hunk.change': 'Change',
  'review.hunk.bothChanged': ' · both sides changed this',
  'review.hunk.youDeleted': ' · you deleted this',
  'review.hunk.alsoRemove': 'also remove or retarget edge',
  'review.hunk.cantRemove': "can't remove — yours added edge",
  'review.hunk.toThisNode': 'to this node',
  'review.hunk.framesTitle': 'Saved frames',
  'review.hunk.framesTake': 'Take the proposal’s frames ({yours} → {theirs})',
  'review.hunk.framesClear': 'Take the proposal’s frames (clear all {yours})',
  'review.field.base': 'base',
  'review.field.yours': 'yours',
  'review.field.theirs': 'theirs',
  'review.field.takeTheirs': 'take theirs',
  'review.field.keepMine': 'keep mine',
  'review.action.applyAnyway': 'Apply anyway',
  'review.action.applyProposal': 'Apply proposal',
  'review.action.applySelected': 'Apply {count} selected',
  'review.action.chooseChanges': 'Choose changes',
  'review.action.wholeProposal': 'Whole proposal',
  'review.action.openAsDoc': 'Open as a document',
  'review.action.cancel': 'Cancel',
  'review.foot.hunks':
    'Applies the target plus the changes you pick makes a new local revision (parent {parent}); one Undo reverts it. Nothing is written to a file.',
  'review.foot.whole':
    'Apply makes a new local revision (parent {parent}); one Undo reverts it. Nothing is written to a file.',

  // ═══ Slice 3 — inventory mop-up: distribution view · open-file hint ═════

  // ── Distribution panel (the Monte-Carlo result view) ────────────────
  'dist.runs': 'runs',
  'dist.steps': 'steps',
  'dist.seed': 'seed',
  'dist.ended': 'Ended',
  'dist.stale': 'stale — graph changed; re-run to refresh',
  'dist.export.staleTitle': 'Result is stale — re-run to export',
  'dist.export.title': 'Export this run',
  'dist.export.seriesCsv': 'Series CSV',
  'dist.export.seriesCsv.blurb': 'per-step p10/p50/p90/mean/min/max',
  'dist.export.runsCsv': 'Runs CSV',
  'dist.export.runsCsv.blurb': 'terminal value per run · run, seed, pools',
  'dist.export.summaryCsv': 'Summary CSV',
  'dist.export.summaryCsv.blurb': 'final-value summary per pool',
  'dist.export.json.blurb': 'full MonteCarloResult',

  // ── Termination sparkline ──────────────────────────────────────────
  'term.title': 'termination',
  'term.ended': 'ended',
  'term.noRuns': 'No runs ended',

  // ── Band chart ────────────────────────────────────────────────────
  'band.pool': 'Pool',
  'band.mean': 'mean',

  // ── Mobile "open a file" first-run hint (§MV6) ─────────────────────
  'openhint.title': 'No account sync',
  'openhint.body': 'Open a saved file or a Share link to view it here.',
  'openhint.button': 'Open a file',
  'openhint.sub': 'Export Graph JSON or Workspace JSON on desktop, or open a #g1= Share link.',

  // ═══ Guided first-run tour + Help menu (docs/guided-tour.md) ═══════════════
  'tour.welcome.title': 'Welcome to Loop Studio',
  'tour.welcome.body': 'A quick two-minute tour of the six parts of the workspace?',
  'tour.welcome.start': 'Start tour',
  'tour.welcome.skip': 'Skip',
  'tour.nav.back': 'Back',
  'tour.nav.next': 'Next',
  'tour.nav.done': 'Done',
  'tour.nav.position': '{n} / {total}',
  'tour.nav.close': 'Close the tour',
  // desktop steps
  'tour.desktop.pieces.title': 'Pieces',
  'tour.desktop.pieces.body': 'The building blocks — Pool, Source, Drain, Gate, and the rest. Click one, or drag it onto the canvas, to add it.',
  'tour.desktop.canvas.title': 'Canvas',
  'tour.desktop.canvas.body': 'Place pieces here, connect them handle to handle, and pan or zoom to move around.',
  'tour.desktop.inspector.title': 'Inspector',
  'tour.desktop.inspector.body': 'Select any piece or connection to edit its settings here.',
  'tour.desktop.playback.title': 'Playback',
  'tour.desktop.playback.body': 'Run the model one step at a time or continuously. A fixed Seed makes a random run repeatable.',
  'tour.desktop.timeline.title': 'Timeline',
  'tour.desktop.timeline.body': 'Watch pool values and run results change over time.',
  'tour.desktop.files.title': 'Files and sharing',
  'tour.desktop.files.body': 'Start from a template, import a file, copy a Share link, or export the graph or workspace.',
  // mobile steps
  'tour.mobile.open.title': 'Open a graph',
  'tour.mobile.open.body': 'Open a shared graph — from a #g1= link, or by importing a file from the More menu.',
  'tour.mobile.canvas.title': 'Move around',
  'tour.mobile.canvas.body': 'Drag to pan, pinch to zoom. Fit re-centres the diagram.',
  'tour.mobile.inspect.title': 'Inspect',
  'tour.mobile.inspect.body': 'Tap a node or connection to read its configuration. Editing is desktop-only.',
  'tour.mobile.run.title': 'Run it',
  'tour.mobile.run.body': 'Step through the model, or press Play to run it.',
  'tour.mobile.timeline.title': 'Timeline',
  'tour.mobile.timeline.body': 'Open the timeline sheet to see values over time.',
  'tour.mobile.more.title': 'More',
  'tour.mobile.more.body': 'Share, Export, and the language switch all live in this menu.',
  // Help menu
  'tour.help.menuLabel': 'Help',
  'tour.help.takeTour': 'Take a tour',
  'tour.help.about': 'About Loop Studio',
  // About dialog. The product name, version line, and the copyright line are
  // shown verbatim in every locale — not keyed. `about.repo` (the GitHub link
  // text) and `about.repoAria` (its accessible name) ARE localized; the href is
  // the fixed repository URL.
  'about.createdBy': 'Created by',
  'about.repo': 'GitHub repository',
  'about.repoAria': 'Loop Studio GitHub repository',
  'about.notAffiliated': 'Loop Studio is an independent project and is not affiliated with or endorsed by Machinations.io.',
  // Contextual inline help — docs/contextual-inline-help.md
  'hint.close': 'Dismiss this note',
  'hint.emptyCanvas.body': 'Start from a Template, or drag node types in from the left panel.',
  'hint.mc.body': 'Monte Carlo runs the model many times and shows a spread of outcomes, not a single prediction.',
  'hint.review.body': 'Reviewing a proposal never changes your open project — nothing moves until you apply it.',
  'hint.focusFilter.body': 'Graph getting busy? Focus dims everything but one node’s neighbourhood; Filter hides node or connection types.',
  'help.contextual.menuLabel': 'Contextual help',
  'help.contextual.title': 'Contextual help',
  'help.contextual.intro': 'Loop Studio shows a few short notes the first time each of these comes up. Re-arm one to see it again next time it applies.',
  'help.contextual.rearm': 'Show again next time',
  'help.contextual.hint.emptyCanvas.name': 'Empty canvas',
  'help.contextual.hint.emptyCanvas.desc': 'Shown on a blank canvas, before any node exists.',
  'help.contextual.hint.mc.name': 'Monte Carlo',
  'help.contextual.hint.mc.desc': 'Shown the first time the Monte Carlo dialog opens.',
  'help.contextual.hint.review.name': 'Review',
  'help.contextual.hint.review.desc': 'Shown the first time a shared proposal opens for review.',
  'help.contextual.hint.focusFilter.name': 'Focus / Filter',
  'help.contextual.hint.focusFilter.desc': 'Shown once a graph is large enough that Focus and Filter start to help.',
} as const

/** the canonical key set — every catalog is `Record<MessageKey, string>` */
export type MessageKey = keyof typeof en
export type MessageCatalog = Record<MessageKey, string>

export default en
