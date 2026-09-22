// docs/localization.md §L3.3 — the Inspector slice of the `de` catalog.
// `satisfies Record<InspectorKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/inspector`.
//
// Glossary (§L2.12): Eigenschaften Inspector · Speicher Pool · Quelle Source ·
// Senke Drain · Verteiler Gate · Konverter Converter · Ende End ·
// Berechneter Wert Register · Verbindung connection · Linienführung route ·
// Auslöser trigger · Aktivator activator · Ausdruck expression ·
// Verteilung distribution · Startwert seed · Schritt step.
//
// `Name` is a node's display name (the `label` field); `Beschriftung` is the
// edge's label MODE — the same split `fr` makes with Nom / étiquette.
//
// The wire enum VALUES stay as they are; only the option labels are
// translated (§L3.4a), and syntax strings (placeholders, operator hints)
// keep their ASCII exactly.

import type { InspectorKey } from '../en/inspector'

const inspector = {
  'inspector.delete': 'Löschen',
  'inspector.field.label': 'Name',
  'inspector.empty.title': 'Einen Knoten oder eine Verbindung zum Bearbeiten auswählen.',
  'inspector.empty.hint':
    'Ein Element aus der oberen Leiste auf die Arbeitsfläche ziehen, dann zwischen den Punkten an den Seiten ziehen, um sie zu verbinden.',
  'inspector.unreadable.note':
    'Die Daten dieses Knotens sind nicht lesbar ({detail}). Er wird unverändert geladen und bleibt außerhalb des Modells — korrigieren Sie ihn in der Datei oder löschen Sie den Knoten.',
  'inspector.unreadable.detailFallback': 'die Daten sind kein lesbares Objekt',
  'inspector.field.rawData': 'Rohdaten',
  'enum.activation.passive': 'passiv',
  'enum.activation.automatic': 'automatisch',
  'enum.activation.onStart': 'beim Start',
  'enum.activation.interactive': 'interaktiv',
  'enum.flowMode.pullAny': 'von einer Quelle ziehen',
  'enum.flowMode.pullAll': 'von allen Quellen ziehen',
  'enum.flowMode.pushAny': 'an ein Ziel schieben',
  'enum.flowMode.pushAll': 'an alle Ziele schieben',
  'enum.distribution.deterministic': 'deterministisch',
  'enum.distribution.probabilistic': 'probabilistisch',
  'enum.format.int': 'ganzzahlig',
  'enum.format.float': 'dezimal',
  'enum.format.percent': 'Prozent',
  'enum.stateMode.trigger': 'Auslöser',
  'enum.stateMode.activator': 'Aktivator',
  'enum.stateMode.label': 'Beschriftung',
  'inspector.field.activation': 'Aktivierung',
  'inspector.node.endNote': 'Beendet den Lauf in dem Moment, in dem eine Ressource es erreicht.',
  'inspector.field.startingAmount': 'Anfangsbestand',
  'inspector.field.capacity': 'Kapazität (leer = unbegrenzt)',
  'inspector.number.nonNegativeHint': 'Geben Sie eine Zahl ab 0 ein.',
  'inspector.field.flowMode': 'Flussmodus',
  'inspector.field.distribution': 'Verteilung',
  'inspector.field.value': 'Wert',
  'inspector.field.unit': 'Einheit (unverbindlich)',
  'inspector.field.min': 'Minimum (unverbindlich)',
  'inspector.field.max': 'Maximum (unverbindlich)',
  'inspector.field.step': 'Schrittweite (unverbindlich)',
  'inspector.field.expression': 'Ausdruck',
  'inspector.field.format': 'Format (unverbindlich)',
  'inspector.field.resourceType': 'Ressourcentyp (unverbindlich)',
  'inspector.resourceType.placeholder': 'Gold, Energie, XP, Spieler, Gegenstand oder ein eigener Name',
  'inspector.resourceType.tooLong': 'Mehr als {max} Bytes — diese Angabe wird nicht exportiert.',
  'inspector.resourceType.normalised': 'Normalisiert zu „{value}“.',
  'inspector.resourceType.custom': 'Eigener Typ — allgemeine Markierung, keine eingebaute Farbe.',
  'inspector.resourceType.mismatch':
    'Typen passen nicht zusammen: {pairs}. Nur unverbindlich — es ändert keine Menge und blockiert keinen Lauf.',
  'inspector.parameter.outOfRange':
    'Der Wert liegt außerhalb des unverbindlichen Minimums/Maximums — er bleibt unverändert und wird nicht gekappt.',
  'inspector.parameter.hintIncoherent':
    'Eine unverbindliche Angabe ist widersprüchlich und wird nicht exportiert.',
  'inspector.parameter.noPorts':
    'Ein Parameter hat keine Verbindungspunkte — referenzieren Sie ihn aus einem Ausdruck über seine ID.',
  'inspector.register.formatInvalid':
    'Format nicht erkannt — beim Export wird auf dezimal zurückgefallen.',
  'inspector.register.noStore':
    'Ein berechneter Wert speichert nichts und hat keine Verbindungspunkte.',
  'inspector.edge.kindLink': 'Verbindung vom Typ {kind}',
  'inspector.field.type': 'Typ',
  'inspector.edge.type.resource': 'Ressource — transportiert Ressourcen',
  'inspector.edge.type.state': 'Zustand — liest einen Wert, verändert das Ziel',
  'inspector.field.flow': 'Fluss',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.edge.flowParam.pickLabel': 'Über einen Parameter steuern',
  'inspector.edge.flowParam.literalOption': '— fester Wert —',
  'inspector.edge.flowParam.resolved': '= {value}',
  'inspector.edge.flowParam.unknown':
    'kein Parameter „{id}“ — diese Verbindung trägt 0 bei',
  'inspector.edge.flowParam.notParam':
    '„{id}“ ist kein Parameter — diese Verbindung trägt 0 bei',
  'inspector.edge.flowParam.malformed':
    'keine gültige Parameterreferenz — diese Verbindung trägt 0 bei',
  'inspector.edge.flowParam.hint':
    'Eine Parameterreferenz wird über die ID gehalten: Umbenennen ist unproblematisch; beim Löschen bleibt die Referenz ins Leere zeigen (sie wird nicht umgeschrieben).',
  'inspector.field.route': 'Linienführung',
  'inspector.edge.route.curved': 'Gebogen',
  'inspector.edge.route.orthogonal': 'Rechtwinklig',
  'inspector.edge.note':
    'Das Bearbeiten einer Verbindung startet den Lauf bei Schritt 0 neu und verwirft ausstehende Auslöser; ein fertiges Monte-Carlo-Ergebnis gilt dann als veraltet.',
  'inspector.field.mode': 'Modus',
  'inspector.edge.mode.trigger': 'Auslöser — stößt das Ziel zum Auslösen an',
  'inspector.edge.mode.activator': 'Aktivator — schaltet das Ziel frei oder sperrt es',
  'inspector.edge.mode.label': 'Beschriftung — addiert zum Zielspeicher oder setzt ihn',
  'inspector.field.delay': 'Verzögerung — Schritte, bis der Impuls ankommt',
  'inspector.delay.ok': 'kommt bei (ausgelöst + Verzögerung + 1) an; 0 heißt im nächsten Schritt.',
  'inspector.delay.bad':
    'verwenden Sie eine ganze Zahl ≥ 0 — die Engine führt jeden anderen Wert als 0 aus und lässt Ihre Eingabe unverändert.',
  'inspector.field.condition': 'Bedingung — Vergleich mit der Quelle',
  'inspector.field.modifier': 'Änderung — wird in jedem Schritt angewendet',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect':
    '{hint} — solange sie nicht lesbar ist, bleibt diese Verbindung ohne Wirkung.',
  'inspector.activator.describe': 'Ziel ist frei, solange die Quelle {op} {n}',
  'inspector.activator.paramPicker.pickLabel': 'Über einen Parameter steuern',
  'inspector.activator.paramPicker.literalOption': '— fester Wert —',
  'inspector.activator.offsetLabel': 'Versatz',
  'inspector.activator.preview.resolved':
    'Ziel ist frei, solange die Quelle {op} {threshold} (= {paramLabel}{offsetText}, aktuell {paramValue})',
  'inspector.activator.preview.unknown':
    'kein Parameter „{id}“ — dieser Aktivator sperrt sein Ziel gerade',
  // no fixed article works for all eight node kinds, so the kind is named
  // rather than inflected — the same call `fr` makes with `(type : {kind})`
  'inspector.activator.preview.notParam':
    '„{id}“ ist kein Parameter (Art: {kind}) — dieser Aktivator sperrt sein Ziel gerade',
  'inspector.activator.preview.nonFinite':
    'Parameter „{id}“ ist keine endliche Zahl — dieser Aktivator sperrt sein Ziel gerade',
  'inspector.activator.preview.overflow':
    'Parameter „{id}“ ergibt eine Zahl, die zum Vergleichen zu groß ist — dieser Aktivator sperrt sein Ziel gerade',
  'inspector.label.describe.set': 'setzt den Zielspeicher in jedem Schritt auf {amount}',
  'inspector.label.describe.add': 'addiert in jedem Schritt {amount} zum Zielspeicher',
  'inspector.label.describe.subtract': 'zieht in jedem Schritt {amount} vom Zielspeicher ab',
  'inspector.label.amountSource': 'der Wert des Quellspeichers',
  'inspector.legacy.note':
    'Nicht unterstützte Verbindung. Modus {mode} wird nicht ausgeführt — diese Verknüpfung hat keine Wirkung auf die Simulation. Loop Studio wandelt sie nie automatisch um; wählen Sie, was daraus werden soll, und wandeln Sie sie dann ausdrücklich um.',
  'inspector.legacy.convertTo': 'Umwandeln in',
  'inspector.legacy.convertButton': 'Umwandeln in {mode}',
  'stateExpr.activator.hint.empty': 'einen Vergleich eingeben, z. B. >= 5',
  'stateExpr.activator.hint.opOnly': 'eine Zahl ergänzen, z. B. >= 5',
  'stateExpr.activator.hint.notAComparison': '>= <= > < == != und dann eine Zahl verwenden',
  'stateExpr.activator.hint.nonFinite': 'die Zahl muss endlich sein',
  'stateExpr.label.hint.empty': 'eine Änderung eingeben, z. B. +1 oder =S',
  'stateExpr.label.hint.notAnAssignment': '+ - oder = und dann eine Zahl oder S verwenden',
  'stateExpr.label.hint.nonFinite': 'die Zahl muss endlich sein',
  'inspector.field.labelTiming': 'Wann sie greift',
  'inspector.labelTiming.always': 'Immer — zu Beginn jedes Schritts',
  'inspector.labelTiming.afterPull':
    'Wenn die Quelle auslöst — nach den Ergebnissen dieses Schritts',
  'inspector.labelTiming.previewAlways': 'Wird zu Beginn jedes Schritts angewendet.',
  'inspector.labelTiming.previewAfterPull':
    'Wird angewendet, sobald die Quelle dieser Verbindung in diesem Schritt auslöst, direkt nachdem die Ergebnisse des Schritts berechnet sind.',
  'inspector.labelTiming.warnTargetNotPool': 'Ziel muss ein Speicher sein',
  'inspector.labelTiming.warnModifierInvalid': 'Änderung muss ein gültiger Wert sein',
  'inspector.labelTiming.warnSourceNotPool': 'braucht einen Speicher als Quelle',
  'inspector.labelTiming.warnSourceNotRouter':
    'braucht einen Verteiler, Konverter, eine Senke oder ein Ende als Quelle',
  'inspector.labelTiming.warnSForm': 'braucht eine feste Zahl, nicht S',
  'inspector.labelTiming.unsupported':
    'Diese Verbindung hat eine Kombination aus Zeitpunkt und Bedingung, die Loop Studio nicht unterstützt (aktuell: timing = {timing}, when = {when}) — sie bleibt daher ohne Wirkung. Wählen Sie eine der beiden Möglichkeiten oben als Ersatz.',
  'panels.inputs.title': 'Eingaben',
  'panels.summary.title': 'Übersicht',
  'panels.inputs.collapse': 'Bereich „Eingaben“ einklappen',
  'panels.inputs.expand': 'Bereich „Eingaben“ ausklappen',
  'panels.summary.collapse': 'Bereich „Übersicht“ einklappen',
  'panels.summary.expand': 'Bereich „Übersicht“ ausklappen',
  'panels.inputs.paramValue': 'Wert von {label}',
  'panels.inputs.flowVia': 'Fluss über {param}',
  'panels.summary.showCalc': 'Rechenweg einblenden',
  'panels.summary.hideCalc': 'Rechenweg ausblenden',
  'panels.summary.noValue': '— kein Wert bei Schritt {step}',
  'panels.empty.inputs': 'Keine Parameter in diesem Graphen.',
  'panels.empty.summary': 'Keine berechneten Werte in diesem Graphen.',
  'regExpr.pick.listLabel': 'Einen Speicher, Parameter oder berechneten Wert referenzieren',
  'regExpr.pick.optionAria': '{name}, {kind}, aktueller Wert {value}',
  'regExpr.pick.noMatch': 'Kein passender Knoten',
  'regExpr.pick.more': '+{n} weitere — weiter tippen',
  'regExpr.block.self': 'kann sich nicht selbst referenzieren',
  'regExpr.block.cycle': 'würde einen Zyklus mit {name} erzeugen',
  'regExpr.empty': 'Der Ausdruck ist leer.',
  'regExpr.chip.deleted': '(gelöscht)',
  'regExpr.chip.wrongKind': '(nicht verwendbar)',
  'regExpr.row.unknownRef': '— Referenz "{id}" nicht gefunden',
  'regExpr.row.wrongKind': '— "{name}" ist kein Speicher, Parameter oder berechneter Wert',
  'regExpr.row.invalidId': '— "{id}" ist keine gültige Referenz',
  'regExpr.row.cycle': '— Zyklus: {name} → … → {name}',
  'regExpr.row.divZero': '→ Division durch 0 nicht möglich',
  'regExpr.row.notFinite': '→ keine endliche Zahl',
  'regExpr.row.dependsInvalid': '— hängt von einer ungültigen Referenz ab',
  'regExpr.row.generic': '— {code}',
  'regExpr.insert.title': '＋ Referenz einfügen',
  'regExpr.insert.armedLabel': 'Referenz wird ausgewählt',
  'regExpr.insert.hint':
    'Auf einen Speicher, Parameter oder berechneten Wert auf der Arbeitsfläche klicken, um die Referenz einzufügen.',
  'regExpr.insert.armed':
    'Einfügen einer Referenz vorbereitet. Auf einen Knoten auf der Arbeitsfläche klicken oder mit Esc abbrechen.',
  'regExpr.insert.cancelled': 'Einfügen der Referenz abgebrochen.',
  'regExpr.insert.done': 'Referenz auf {name} eingefügt.',
  'regExpr.insert.wrongKind':
    'Nur ein Speicher, Parameter oder berechneter Wert lässt sich einfügen.',
  'regExpr.op.groupName': 'Operatortasten',
  'regExpr.op.add': 'Addieren',
  'regExpr.op.sub': 'Subtrahieren',
  'regExpr.op.mul': 'Multiplizieren',
  'regExpr.op.div': 'Dividieren',
  'regExpr.op.group': 'Klammern',
  'regExpr.op.inserts': '{name} — fügt {sym} in die Formel ein',
  'regExpr.op.groupTitle': 'Klammern — den markierten Teil umschließen oder ( ) einfügen',
  'regExpr.op.inserted': '{name} eingefügt',
} satisfies Record<InspectorKey, string>

export default inspector
