// docs/localization.md §L3.3 — the Canvas slice of the `de` catalog.
// `satisfies Record<CanvasKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/canvas`.
//
// Glossary (§L2.12): Speicher Pool · Quelle Source · Senke Drain ·
// Verteiler Gate · Konverter Converter · Ende End · Parameter Parameter ·
// Berechneter Wert Register · Knoten node · Verbindung connection ·
// Gruppenrahmen frame · Linienführung route · Schritt step · Auslöser
// trigger · Aktivator activator · Ausdruck expression · Kapazität capacity.
//
// `Senke` is the German flow-theory counterpart of `Quelle`, so the pair
// reads as a pair. `Verteiler` says what a Gate does; `Gatter` would be a
// logic gate. `Berechneter Wert` is spelled out rather than compressed into
// `Rechenwert` so a first-time reader knows what the node is — its width in
// the palette chip and the Inspector is measured, not assumed.
//
// Style: impersonal or infinitive, formal `Sie` when a subject is needed.
// German noun capitalisation only. Quotation marks „…“.

import type { CanvasKey } from '../en/canvas'

const canvas = {
  'palette.pool.name': 'Speicher',
  'palette.pool.description':
    'Hält Ressourcen und zeigt den aktuellen Bestand. Ist die Kapazität voll, staut sich der eingehende Fluss zurück.',
  'palette.source.name': 'Quelle',
  'palette.source.description':
    'Erzeugt in jedem Schritt neue Ressourcen und schickt sie an die Knoten, die sie versorgt.',
  'palette.drain.name': 'Senke',
  'palette.drain.description':
    'Zieht Ressourcen aus den Knoten, aus denen sie schöpft, und entfernt sie aus dem System.',
  'palette.gate.name': 'Verteiler',
  'palette.gate.description':
    'Teilt eingehende Ressourcen nach einem festen Verhältnis auf oder wählt einen Zweig nach Wahrscheinlichkeit. Hält nichts.',
  'palette.converter.name': 'Konverter',
  'palette.converter.description':
    'Verbraucht Eingangsressourcen und erzeugt Ausgangsressourcen im eingestellten Verhältnis. Hält nichts.',
  'palette.end.name': 'Ende',
  'palette.end.description': 'Beendet den Lauf, sobald eine Ressource es erreicht.',
  'palette.parameter.name': 'Parameter',
  'palette.parameter.description':
    'Eine feste Zahl, die Sie setzen. Er hat keine Verbindungspunkte, und ein Ausdruck kann ihn über seine ID referenzieren.',
  'palette.register.name': 'Berechneter Wert',
  'palette.register.description':
    'Wertet einen Ausdruck für den aktuellen Schritt aus und zeigt das Ergebnis. Er sammelt nichts an, speichert nichts und hat keine Verbindungspunkte.',
  'palette.addAction': 'Klicken oder auf die Arbeitsfläche ziehen, um eines hinzuzufügen.',
  'canvas.minimap': 'Übersichtskarte des Graphen',
  'canvas.minimap.hide': 'Übersichtskarte ausblenden',
  'canvas.minimap.show': 'Übersichtskarte einblenden',
  'canvas.lock.lock': 'Bearbeitung sperren — Auswählen und Lesen bleiben aktiv',
  'canvas.lock.unlock': 'Bearbeitung entsperren — bewegen, verbinden und Werte ändern',
  'canvas.focus.on': 'Fokus aus — klicken, um den ausgewählten Knoten zu fokussieren',
  'canvas.focus.off': 'Fokus an — klicken, um den ganzen Graphen zu zeigen',
  'canvas.focus.hint': 'Einen Knoten zum Fokussieren auswählen',
  'canvas.focus.rowLabel': 'Auswahl fokussieren',
  'canvas.focus.stateOn': 'An',
  'canvas.focus.stateOff': 'Aus',
  'canvas.panMode.off':
    'Verschiebemodus aus — leere Arbeitsfläche ziehen, um zu verschieben',
  'canvas.panMode.on': 'Verschiebemodus an — überall ziehen, um zu verschieben',
  'canvas.panMode.rowLabel': 'Verschiebemodus',
  'canvas.filter.open': 'Filter — Teile des Graphen beim Erkunden ausblenden',
  'canvas.filter.close': 'Filterleiste schließen',
  'canvas.filter.title': 'Filter',
  'canvas.filter.rowLabel': 'Filter',
  'canvas.filter.groupEdgeClass': 'Verbindungstyp',
  'canvas.filter.groupResourceType': 'Ressourcentyp',
  'canvas.filter.groupNodeKind': 'Knotenart',
  'canvas.filter.edgeClass.resource': 'Ressource',
  'canvas.filter.edgeClass.state': 'Zustand',
  'canvas.filter.edgeClass.hint': 'Abhängigkeitshinweis',
  'canvas.filter.untyped': 'ohne Typ',
  'canvas.filter.clear': 'Filter zurücksetzen',
  // English uses a plain slot here, so German cannot switch to an ICU plural
  // without breaking the shared argument shape — `ausgeblendet` is invariant
  // in this position, so no agreement is lost.
  'canvas.filter.hiddenCount': '{n} ausgeblendet',
  'canvas.filter.none': 'Nichts ausgeblendet',
  'canvas.filter.checkboxHint': 'angehakt = ausgeblendet',
  'canvas.nodeKind.source': 'Quelle',
  'canvas.nodeKind.pool': 'Speicher',
  'canvas.nodeKind.gate': 'Verteiler',
  'canvas.nodeKind.converter': 'Konverter',
  'canvas.nodeKind.drain': 'Senke',
  'canvas.nodeKind.end': 'Ende',
  'canvas.nodeKind.parameter': 'Parameter',
  'canvas.nodeKind.register': 'Berechneter Wert',
  'canvas.resetView':
    'Ansicht zurücksetzen — Graph einpassen, Filter und Fokus löschen',
  'canvas.regionSelect.off':
    'Bereich auswählen — auf leerer Arbeitsfläche ziehen; Umschalt+Ziehen geht auch',
  'canvas.regionSelect.on':
    'Bereich auswählen — läuft; auf leerer Arbeitsfläche ziehen, Esc bricht ab',
  'canvas.regionSelect.count':
    '{n, plural, one {# Knoten ausgewählt} other {# Knoten ausgewählt}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# Knoten ausgewählt} other {# Knoten ausgewählt}} · Bearbeitung entsperren, um sie zu bewegen',
  'canvas.frame.draw': 'Gruppenrahmen — auf leerer Arbeitsfläche ziehen, um einen aufzuziehen',
  'canvas.frame.drawing':
    'Gruppenrahmen — wird aufgezogen; auf leerer Arbeitsfläche ziehen, Esc bricht ab',
  'canvas.frame.defaultName': 'Gruppe {n}',
  'canvas.frame.delete': 'Diesen Rahmen löschen',
  'canvas.frame.suggest':
    'Rahmen vorschlagen — grobe Gruppierungsrechtecke um strukturell verbundene Knoten. Nur Struktur, keine fachliche Bedeutung.',
  'canvas.frame.suggestStale':
    'Rahmen vorschlagen — der Graph hat sich geändert; klicken, um die Gruppen neu zu berechnen',
  'canvas.frame.suggestRow': 'Rahmen vorschlagen',
  'canvas.frame.suggestNote':
    'Vorgeschlagene strukturelle Gruppen — sie entsprechen nicht unbedingt Ihrer eigenen Aufteilung.',
  'canvas.frame.suggestNoteDismiss': 'Diesen Hinweis ausblenden',
  'canvas.frame.areaName': 'Bereich {n}',
  'canvas.frame.dismiss': 'Diesen vorgeschlagenen Rahmen verwerfen',
  'canvas.frame.clearAll': 'Alle Rahmen löschen',
  'canvas.frame.clearSuggested': 'Vorgeschlagene Rahmen löschen',
  'canvas.frame.clearSuggestedRow': 'Vorgeschlagene Rahmen löschen',
  'canvas.frame.colorRow': 'Rahmenfarbe',
  'canvas.frame.color.neutral': 'Neutral',
  'canvas.frame.color.slate': 'Schiefer',
  'canvas.frame.color.sage': 'Salbei',
  'canvas.frame.color.gold': 'Gold',
  'canvas.frame.color.violet': 'Violett',
  'canvas.frame.color.rose': 'Rosé',
  'canvas.frame.props.title': 'Rahmeneinstellungen — {label}',
  'canvas.frame.props.name': 'Name',
  'canvas.activity.off':
    'Aktivitätsebene aus — klicken, um zuletzt aktive Teile einzufärben',
  'canvas.activity.on': 'Aktivitätsebene an — klicken, um die Einfärbung auszublenden',
  'canvas.activity.rowLabel': 'Aktivitätsebene',
  'canvas.route.invalidFlag':
    'ungültige Linienführung — ein Wegpunkt liegt in einem Knoten',
  'canvas.edgeLabel.clamp': 'gekappt',
  'canvas.edgeLabel.clamp.title':
    'vom einmaligen Kappen des Zielspeichers am Ende von Phase 0 entfernt',
  'canvas.edgeLabel.blocked': 'blockiert',
  'canvas.edgeLabel.blocked.title':
    'geliefert, aber das Ziel konnte nicht auslösen (falscher Aktivierungsmodus, oder ein Aktivator hielt es geschlossen)',
  'canvas.edgeLabel.breakdown.title': 'die Übertragungen dieses Schritts auf dieser Verbindung',
  'canvas.edgeLabel.refMissing': 'Fehler bei der Parameterreferenz',
  'node.unreadable.title': 'unlesbar: {kind}',
  'node.unreadable.sub': 'Daten nicht lesbar — in der Datei korrigieren',
  'node.invalidFlag': 'Dieser Knoten ist ungültig',
  'node.aria.invalid': 'ungültig',
  'node.aria.selected': 'ausgewählt',
  // keyboard focus, not the Focus-dimming feature (which this UI also calls
  // `Fokus`) — see the same distinction in `fr`
  'node.aria.focused': 'im Tastaturfokus',
  'node.evaluatedCue': 'In diesem Schritt ausgewertet, aber ohne Wirkung',
  'node.default.pool': 'Speicher',
  'node.default.source': 'Quelle',
  'node.default.drain': 'Senke',
  'node.default.gate': 'Verteiler',
  'node.default.converter': 'Konverter',
  'node.default.end': 'Ende',
  'node.default.parameter': 'Parameter',
  'node.default.register': 'Berechneter Wert',
  'canvas.frame.a11y.roledescription': 'Gruppenrahmen',
  'canvas.frame.a11y.roledescriptionAuto': 'vorgeschlagener Gruppenrahmen',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# Knoten} other {# Knoten}}',
  'canvas.frame.a11y.desc': 'Mit Eingabe oder Leertaste diesen Rahmen auswählen.',
  'canvas.frame.a11y.descSelected':
    'Ausgewählt. Die Pfeiltasten bewegen den Rahmen mit allem darin, Umschalt für größere Schritte. Rücktaste oder Entf entfernt ihn. Esc hebt die Auswahl auf.',
  'canvas.frame.a11y.descReadonly':
    'Schreibgeschützt — dieser Rahmen lässt sich auswählen und lesen, aber nicht bearbeiten.',
  'canvas.frame.a11y.resize':
    '{label} skalieren — Breite {w}, Höhe {h}. Die Pfeiltasten skalieren ihn, Umschalt für größere Schritte.',
  'canvas.frame.a11y.moved': '{label} verschoben auf x {x}, y {y}',
  'canvas.frame.a11y.resized': '{label} skaliert auf Breite {w}, Höhe {h}',
  'rf.node.moveCancelled': 'Verschieben abgebrochen. Der Knoten ist zurück bei x {x}, y {y}',
  'rf.node.moved':
    'Ausgewählten Knoten nach {direction} verschoben. Neue Position, x {x}, y {y}',
  'rf.dir.left': 'links',
  'rf.dir.right': 'rechts',
  'rf.dir.up': 'oben',
  'rf.dir.down': 'unten',
  'rf.controls.label': 'Steuerung der Arbeitsfläche',
  'rf.controls.zoomIn': 'Vergrößern',
  'rf.controls.zoomOut': 'Verkleinern',
  'rf.controls.fitView': 'Diagramm in die Ansicht einpassen',
  'rf.controls.interactive': 'Bearbeitung der Arbeitsfläche umschalten',
  'rf.handle.label': 'Verbindungspunkt',
  'rf.node.a11y':
    'Mit Eingabe oder Leertaste diesen Knoten auswählen. Mit Entf entfernen, mit Esc abbrechen.',
  'rf.node.a11yKeyboard':
    'Mit Eingabe oder Leertaste diesen Knoten auswählen, dann mit den Pfeiltasten bewegen. Mit Entf entfernen, mit Esc abbrechen.',
  'rf.edge.a11y':
    'Mit Eingabe oder Leertaste diese Verbindung auswählen. Mit Entf entfernen, mit Esc abbrechen.',
} satisfies Record<CanvasKey, string>

export default canvas
