// docs/localization.md §L3.3 — Canvas surface slice of the `nl` catalog.
// Key-checked against `../en/canvas` by `satisfies`; same `{name}` slots.
//
// GLOSSARY (docs/localization.md §L2.23): Voorraad Pool · Bron Source ·
// Afvoer Drain · Verdeler Gate · Omzetter Converter · Einde End ·
// Parameter Parameter · Berekende waarde Register · kader frame ·
// groepskader group frame · tekengebied canvas · stap simulation step ·
// knooppunt node · verbinding edge/connection.
//
// `middelen`, not `bronnen`, for "resources": the plural of `bron` IS the
// Source node's own name, so the obvious word would make two different
// product nouns identical. Measured collision, not a style preference.
//
// PLURAL — Dutch has `one` and `other` only, and `one` is the integer 1
// alone. Never add a `many` arm here: Italian's 1e6 category does not exist
// in this locale and `Intl.PluralRules('nl')` can never select it.

const canvas = {
  'palette.pool.name': 'Voorraad',
  'palette.pool.description': 'Bewaart middelen en toont de huidige hoeveelheid. Zodra de capaciteit vol is, remt de voorraad de binnenkomende stroom af.',
  'palette.source.name': 'Bron',
  'palette.source.description': 'Maakt elke stap nieuwe middelen aan en stuurt ze naar de knooppunten die eraan hangen.',
  'palette.drain.name': 'Afvoer',
  'palette.drain.description': 'Haalt middelen weg bij de knooppunten waaruit wordt geput en verwijdert ze uit het systeem.',
  'palette.gate.name': 'Verdeler',
  'palette.gate.description': 'Splitst binnenkomende middelen volgens een vaste verhouding, of kiest op kans één tak en stuurt daarheen. Bewaart niets.',
  'palette.converter.name': 'Omzetter',
  'palette.converter.description': 'Verbruikt binnenkomende middelen en maakt uitgaande middelen in de verhouding die je instelt. Bewaart niets.',
  'palette.end.name': 'Einde',
  'palette.end.description': 'Stopt de run zodra een middel hier aankomt.',
  'palette.parameter.name': 'Parameter',
  'palette.parameter.description': 'Een vast getal dat je instelt. Het heeft geen poorten, en een expressie kan ernaar verwijzen met het id.',
  'palette.register.name': 'Berekende waarde',
  'palette.register.description': 'Evalueert een expressie voor de huidige stap en toont het resultaat. Het telt niets op, bewaart niets en heeft geen poorten.',
  'palette.addAction': 'Klik, of sleep naar het tekengebied, om er een toe te voegen.',
  'canvas.minimap': 'Minikaart van het diagram',
  'canvas.minimap.hide': 'Minikaart verbergen',
  'canvas.minimap.show': 'Minikaart tonen',
  'canvas.lock.lock': 'Bewerken vergrendelen — selecteren en lezen blijven aan',
  'canvas.lock.unlock': 'Bewerken ontgrendelen — verplaatsen, verbinden en waarden wijzigen',
  'canvas.focus.on': 'Focus uit — klik om op het geselecteerde knooppunt te focussen',
  'canvas.focus.off': 'Focus aan — klik om het hele diagram te tonen',
  'canvas.focus.hint': 'Selecteer een knooppunt om op te focussen',
  'canvas.focus.rowLabel': 'Focus op selectie',
  'canvas.focus.stateOn': 'Aan',
  'canvas.focus.stateOff': 'Uit',
  'canvas.panMode.off': 'Verschuifmodus uit — sleep op een leeg tekengebied om te verschuiven',
  'canvas.panMode.on': 'Verschuifmodus aan — sleep overal om te verschuiven',
  'canvas.panMode.rowLabel': 'Verschuifmodus',
  'canvas.filter.open': 'Filters — verberg delen van het diagram tijdens het verkennen',
  'canvas.filter.close': 'Filterpaneel sluiten',
  'canvas.filter.title': 'Filters',
  'canvas.filter.rowLabel': 'Filters',
  // `type` vs `kind` — the base catalog distinguishes them (`Edge type`,
  // `Resource type`, `Node kind`) and so does this one: `type` for the first
  // two, `soort` for the third. Collapsing both onto one Dutch word would
  // erase a distinction the source makes.
  'canvas.filter.groupEdgeClass': 'Verbindingstype',
  'canvas.filter.groupResourceType': 'Middeltype',
  'canvas.filter.groupNodeKind': 'Soort knooppunt',
  'canvas.filter.edgeClass.resource': 'Middel',
  'canvas.filter.edgeClass.state': 'Status',
  'canvas.filter.edgeClass.hint': 'Afhankelijkheidshint',
  'canvas.filter.untyped': 'zonder type',
  'canvas.filter.clear': 'Filters wissen',
  'canvas.filter.hiddenCount': '{n} verborgen',
  'canvas.filter.none': 'Niets verborgen',
  'canvas.filter.checkboxHint': 'aangevinkt = verborgen',
  'canvas.nodeKind.source': 'Bron',
  'canvas.nodeKind.pool': 'Voorraad',
  'canvas.nodeKind.gate': 'Verdeler',
  'canvas.nodeKind.converter': 'Omzetter',
  'canvas.nodeKind.drain': 'Afvoer',
  'canvas.nodeKind.end': 'Einde',
  'canvas.nodeKind.parameter': 'Parameter',
  'canvas.nodeKind.register': 'Berekende waarde',
  'canvas.resetView': 'Weergave herstellen — diagram passend maken en filters / focus wissen',
  // docs/large-graph-readability.md §LGR12 — the one-shot region-select tool.
  // The button names BOTH ways in, so the keyboard gesture stops being the only
  // way to find the feature.
  'canvas.regionSelect.off': 'Gebied selecteren — sleep op een leeg tekengebied om te selecteren; Shift-slepen werkt ook',
  'canvas.regionSelect.on': 'Gebied selecteren — bezig; sleep op een leeg tekengebied, Esc om te annuleren',
  // shown whenever there is a selection, lock or no lock
  'canvas.regionSelect.count': '{n, plural, one {# knooppunt geselecteerd} other {# knooppunten geselecteerd}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# knooppunt geselecteerd} other {# knooppunten geselecteerd}} · ontgrendel het bewerken om ze te verplaatsen',
  'canvas.frame.draw': 'Groepskader — sleep op een leeg tekengebied om er een te tekenen',
  'canvas.frame.drawing': 'Groepskader — bezig met tekenen; sleep op een leeg tekengebied, Esc om te annuleren',
  'canvas.frame.defaultName': 'Groep {n}',
  'canvas.frame.delete': 'Dit kader verwijderen',
  'canvas.frame.suggest': 'Kaders voorstellen — ruwe groeperingsrechthoeken rond knooppunten die structureel samenhangen. Alleen structuur; geen inhoudelijke betekenis.',
  'canvas.frame.suggestStale': 'Kaders voorstellen — het diagram is gewijzigd; klik om de voorgestelde groepen opnieuw te berekenen',
  'canvas.frame.suggestRow': 'Kaders voorstellen',
  'canvas.frame.suggestNote': 'Voorgestelde structurele groepen — ze komen niet per se overeen met hoe jij het werk zou verdelen.',
  'canvas.frame.suggestNoteDismiss': 'Deze melding sluiten',
  'canvas.frame.areaName': 'Gebied {n}',
  'canvas.frame.dismiss': 'Dit voorgestelde kader verwerpen',
  'canvas.frame.clearAll': 'Alle kaders wissen',
  'canvas.frame.clearSuggested': 'Voorgestelde kaders wissen',
  'canvas.frame.clearSuggestedRow': 'Voorgestelde kaders wissen',
  'canvas.frame.colorRow': 'Kaderkleur',
  'canvas.frame.color.neutral': 'Neutraal',
  'canvas.frame.color.slate': 'Leisteen',
  'canvas.frame.color.sage': 'Salie',
  'canvas.frame.color.gold': 'Goud',
  'canvas.frame.color.violet': 'Violet',
  'canvas.frame.color.rose': 'Roze',
  'canvas.frame.props.title': 'Kaderinstellingen — {label}',
  'canvas.frame.props.name': 'Naam',
  'canvas.activity.off': 'Activiteitsoverlay uit — klik om recent actieve delen te kleuren',
  'canvas.activity.on': 'Activiteitsoverlay aan — klik om de kleuring te verbergen',
  'canvas.activity.rowLabel': 'Activiteitsoverlay',
  'canvas.route.invalidFlag': 'ongeldige route — een routepunt ligt binnen een knooppunt',
  'canvas.edgeLabel.clamp': 'begrensd',
  'canvas.edgeLabel.clamp.title': 'verwijderd door de enkele begrenzing van de doelvoorraad aan het einde van fase 0',
  'canvas.edgeLabel.blocked': 'geblokkeerd',
  'canvas.edgeLabel.blocked.title': 'afgeleverd, maar het doel kon niet vuren (verkeerde activering, of een activator hield het dicht)',
  'canvas.edgeLabel.breakdown.title': 'de overdrachten van deze stap over deze verbinding',
  'canvas.edgeLabel.refMissing': 'Fout in parameterverwijzing',
  // `{kind}` holds a node-kind name, and Dutch inflects an attributive
  // adjective by the noun's GENDER: `Einde` is a het-word while `Voorraad`,
  // `Bron`, `Afvoer`, `Verdeler`, `Omzetter`, `Parameter` and
  // `Berekende waarde` are de-words. No single attributive form is correct
  // for every value the slot can take, so the phrase is reordered to put the
  // adjective in PREDICATIVE position, where Dutch leaves it uninflected.
  'node.unreadable.title': '{kind} — onleesbaar',
  'node.unreadable.sub': 'gegevens kunnen niet worden gelezen — herstel dit in het bestand',
  'node.invalidFlag': 'Dit knooppunt is ongeldig',
  'node.aria.invalid': 'ongeldig',
  'node.aria.selected': 'geselecteerd',
  'node.aria.focused': 'gefocust',
  'node.evaluatedCue': 'Deze stap geëvalueerd, maar niets gedaan',
  'node.default.pool': 'Voorraad',
  'node.default.source': 'Bron',
  'node.default.drain': 'Afvoer',
  'node.default.gate': 'Verdeler',
  'node.default.converter': 'Omzetter',
  'node.default.end': 'Einde',
  'node.default.parameter': 'Parameter',
  'node.default.register': 'Berekende waarde',
  'canvas.frame.a11y.roledescription': 'groepskader',
  'canvas.frame.a11y.roledescriptionAuto': 'voorgesteld groepskader',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# knooppunt} other {# knooppunten}}',
  'canvas.frame.a11y.desc': 'Druk op Enter of spatie om dit kader te selecteren.',
  'canvas.frame.a11y.descSelected': 'Geselecteerd. De pijltoetsen verplaatsen het kader en alles erin, Shift voor een grotere stap. Backspace of Delete verwijdert het. Escape heft de selectie op.',
  'canvas.frame.a11y.descReadonly': 'Alleen-lezen — dit kader kan worden geselecteerd en gelezen, maar niet bewerkt.',
  'canvas.frame.a11y.resize': 'Formaat van {label} wijzigen — breedte {w}, hoogte {h}. De pijltoetsen wijzigen het formaat, Shift voor een grotere stap.',
  'canvas.frame.a11y.moved': '{label} verplaatst naar x {x}, y {y}',
  'canvas.frame.a11y.resized': 'Formaat van {label} gewijzigd naar breedte {w}, hoogte {h}',
  'rf.node.moveCancelled': 'Verplaatsen geannuleerd. Het knooppunt staat weer op x {x}, y {y}',
  'rf.node.moved': 'Het geselecteerde knooppunt {direction} verplaatst. Nieuwe positie, x {x}, y {y}',
  'rf.dir.left': 'naar links',
  'rf.dir.right': 'naar rechts',
  'rf.dir.up': 'omhoog',
  'rf.dir.down': 'omlaag',
  'rf.controls.label': 'Besturing van het tekengebied',
  'rf.controls.zoomIn': 'Inzoomen',
  'rf.controls.zoomOut': 'Uitzoomen',
  'rf.controls.fitView': 'Diagram passend maken in beeld',
  'rf.controls.interactive': 'Bewerken van het tekengebied in- of uitschakelen',
  'rf.handle.label': 'Verbindingspunt',
  'rf.node.a11y': 'Druk op Enter of spatie om dit knooppunt te selecteren. Druk op Delete om het te verwijderen, Escape om te annuleren.',
  'rf.node.a11yKeyboard': 'Druk op Enter of spatie om dit knooppunt te selecteren en gebruik daarna de pijltoetsen om het te verplaatsen. Druk op Delete om het te verwijderen, Escape om te annuleren.',
  'rf.edge.a11y': 'Druk op Enter of spatie om deze verbinding te selecteren. Druk op Delete om hem te verwijderen, Escape om te annuleren.',
} as const

export default canvas
