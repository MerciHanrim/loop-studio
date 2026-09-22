// docs/localization.md §L3.3 — the spreadsheet-import slice of the `de`
// catalog. `satisfies Record<DataImportKey, string>` makes `tsc` fail on a
// missing or an extra key against `../en/dataImport`.
//
// Three different words the English single word "spreadsheet"/"table" blurs,
// and German must keep apart (§L2.12):
//   Tabellenblatt       the spreadsheet DOCUMENT the user imports
//   Tabellenkalkulation the APPLICATION (Excel, Google Sheets) it came from
//   Tabelle             the data TABLE inside this wizard
// Collapsing them would make "Tabellenname" ambiguous in a dialog that shows
// all three at once.
//
// §L2.11 — `{column}` is a CHARACTER offset in `import.parseError` and a real
// table COLUMN in `import.loc.*`. German says `Zeichen` for the first and
// `Spalte` for the second, and never one for the other.
//
// Glossary: Zeile row · Spalte column · Schlüssel key · Fremdschlüssel
// foreign key · Zuordnung mapping · Gruppenrahmen frame · Parameter.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': 'Daten ▾',
  'import.title': 'Daten aus einem Tabellenblatt importieren',
  'import.tableName': 'Tabellenname',
  'import.removeTable': 'Tabelle entfernen',
  'import.addTable': 'Weitere Tabelle hinzufügen',
  'import.pastePlaceholder': 'CSV- oder TSV-Text hier einfügen',
  'import.pasteAria': 'CSV- oder TSV-Text',
  'import.tableNameRequired': 'Geben Sie einen Tabellennamen ein, um fortzufahren.',
  'import.pasteDataRequired': 'Fügen Sie CSV-/TSV-Daten ein oder laden Sie eine Datei hoch, um fortzufahren.',
  'import.uploadFile': 'Datei hochladen…',
  'import.delimiter': 'Trennzeichen',
  'import.delimiterAuto': 'Automatisch erkennen',
  'import.delimiterComma': 'Komma',
  'import.delimiterTab': 'Tabulator',
  'import.headerRow': 'Kopfzeile',
  'import.ignoreLastRows': 'Letzte N Zeilen ignorieren',
  // §L2.11 — `{column}` here is a 1-based CHARACTER offset, never a column
  'import.parseError':
    'Dieser Text ist kein gültiges CSV/TSV: {kind} in Zeile {line}, Zeichen {column}.',
  'import.parseErrorKind.unterminated-quote': 'ein nicht geschlossenes Anführungszeichen',
  'import.parseErrorKind.text-after-quote':
    'unerwarteter Text direkt nach einem schließenden Anführungszeichen',
  'import.parseErrorKind.quote-in-unquoted-field':
    'ein Anführungszeichen in einem Feld ohne Anführungszeichen',
  'import.role.ignored': 'Ignorieren',
  'import.role.key': 'Schlüssel',
  'import.role.number': 'Zahl',
  'import.role.label': 'Name',
  'import.role.foreignKey': 'Fremdschlüssel',
  'import.roleAria': 'Rolle für Spalte {header}',
  'import.selectTable': 'Tabelle auswählen…',
  'import.selectColumn': 'Spalte auswählen…',
  'import.selectFrame': 'Rahmen auswählen…',
  'import.groupBy': 'Rahmen gruppieren nach:',
  'import.warningsFound':
    '{n, plural, one {# Zeile zeigt statt eines Namens den rohen Schlüssel.} other {# Zeilen zeigen statt eines Namens den rohen Schlüssel.}}',
  'import.parseErrorsBlockValidation':
    'Beheben Sie die CSV-/TSV-Fehler oben, bevor Sie fortfahren.',
  'import.placement.none': 'Auf der Arbeitsfläche platzieren, ohne Rahmen',
  'import.placement.framePerTable': 'Ein Rahmen pro Tabelle',
  'import.placement.existingFrame': 'Zu einem vorhandenen Rahmen hinzufügen',
  'import.summary':
    'Bereit, {tables, plural, one {# Tabelle} other {# Tabellen}} zu importieren und dabei {parameters, plural, one {# Parameter} other {# Parameter}} zu erzeugen.',
  'import.next': 'Weiter',
  'import.back': 'Zurück',
  'import.commit': 'Importieren',
  'import.qs.title': 'Schnelleinstieg',
  'import.qs.toggleAria': 'Schnelleinstieg — ein- oder ausblenden',
  'import.qs.lead':
    'Machen Sie aus den Zahlen in einem Tabellenblatt einstellbare Parameter.',
  'import.qs.body':
    'Jede Zeile braucht eine Spalte mit einer eindeutigen ID. Jede Spalte, die Sie als „Zahl“ markieren, wird zu einem Parameter pro Zeile. Das Verbinden mit Ihrem Modell bleibt danach Ihre Aufgabe. Es wird nichts hochgeladen, und Ihr Tabellenblatt wird nie verändert.',
  'import.qs.exampleHeading': 'Ein minimales Beispiel',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 Zeilen × 2 Zahlenspalten = 4 Parameter',
  'import.qs.useExample': 'Dieses Beispiel verwenden',
  'import.qs.tableLimit':
    'Die Grenze von {max} Tabellen ist erreicht — entfernen Sie zuerst eine Tabelle.',
  'import.qs.download': 'Beispiel-CSV herunterladen',
  'import.qs.fullGuide': 'Vollständige Anleitung',
  'import.qs.fullGuideAria':
    'Vollständige Anleitung — öffnet sich auf GitHub in einem neuen Tab',
  'import.qs.sources.summary': 'Daten aus Google Sheets oder Excel herausbekommen',
  'import.qs.sources.sheets':
    'Google Sheets: Datei → Herunterladen → Kommagetrennte Werte (.csv), oder einen Bereich markieren und kopieren.',
  'import.qs.sources.excel':
    'Excel oder Numbers: Speichern unter / Als CSV exportieren, oder einen Bereich kopieren.',
  'import.qs.sources.privacy':
    'Nutzen Sie „Im Web veröffentlichen“ nicht für ein privates Blatt — dadurch kann jede Person mit dem Link es lesen. Ein Download oder eine Kopie hält es privat.',
  'import.qs.notImported.summary': 'Was nicht importiert wird',
  'import.qs.notImported.formulas':
    'Die Formeln selbst werden nicht importiert — ein CSV oder eine Zwischenablage trägt nur den aktuell berechneten Wert jeder Zelle.',
  'import.qs.notImported.list':
    'Formatierung, Diagramme, verbundene Zellen oder Zellen mit mehreren Werten, .xlsx-Dateien und laufende Synchronisierung. Wie die Werte zusammenwirken, modellieren Sie selbst.',
  'import.qs.limits':
    'Bis zu {tables} Tabellen, {columns} zugeordnete Spalten je Tabelle, {rows} Zeilen je Tabelle.',
  'import.roleHelp.title': 'Spaltenrollen',
  'import.roleHelp.key':
    'Eindeutige ID, über die diese Zeile beim Aktualisieren wiedergefunden wird.',
  'import.roleHelp.label': 'Name, der an den erzeugten Parametern steht.',
  'import.roleHelp.number': 'Erzeugt für jede Zeile einen einstellbaren Parameter.',
  'import.roleHelp.foreignKey':
    'Verknüpft diesen Wert mit einer Zeile in einer anderen importierten Tabelle.',
  'import.roleHelp.ignored': 'Diese Spalte aus Loop Studio heraushalten.',
  'import.linkTables.summary': 'Mehrere Tabellen verknüpfen',
  'import.linkTables.body':
    'Fügen Sie eine zweite Tabelle hinzu und markieren Sie eine Spalte als Fremdschlüssel, um den Schlüssel der anderen Tabelle zu referenzieren. Deren Name macht die erzeugten Namen dann aussagekräftiger. Eine Tabelle mit zwei Fremdschlüsseln muss angeben, welcher die Rahmen gruppiert.',
  'import.status.key': 'Schlüssel: {header}',
  'import.status.keyNone': 'Schlüssel: noch keiner',
  'import.status.keyMany': 'Schlüssel: {n} Spalten — genau eine auswählen',
  'import.status.counts':
    '{cols, plural, one {# Zahlenspalte} other {# Zahlenspalten}} × {rows, plural, one {# Zeile} other {# Zeilen}} → {n, plural, one {# Parameter} other {# Parameter}}',
  'import.placement.frameHelp':
    'Ein Rahmen ist ein beschrifteter Kasten, der Knoten auf der Arbeitsfläche gruppiert.',
  'import.placement.noneResult':
    '{n, plural, one {# Parameter} other {# Parameter}} auf der Arbeitsfläche, ohne Rahmen',
  'import.placement.framePerTableResult':
    '{n, plural, one {# Rahmen wird erstellt} other {# Rahmen werden erstellt}}',
  'import.placement.noFramesYet': 'Noch keine Rahmen auf dieser Arbeitsfläche',
  'import.review.col.table': 'Tabelle',
  'import.review.col.rows': 'Zeilen',
  'import.review.col.numberColumns': 'Zahlenspalten',
  'import.review.col.parameters': 'Parameter',
  'import.review.col.frames': 'Rahmen',
  'import.review.lookupOnly': '0 (nur zum Nachschlagen)',
  'import.review.total': 'Gesamt',
  'import.review.labelsPreview': 'Die Namen sehen so aus:',
  'import.review.more': '{n, plural, one {… und # weitere} other {… und # weitere}}',
  'import.issueSummary':
    '{n, plural, one {# Problem} other {# Probleme}} in {m, plural, one {# Tabelle} other {# Tabellen}}. Beheben Sie sie unten und drücken Sie erneut auf „Weiter“.',
  'import.issueSummaryStale':
    'Die Eingabe hat sich seit der letzten Prüfung geändert — mit „Weiter“ erneut prüfen.',
  'import.issueJump': 'Zu dieser Zelle springen',
  'import.loc.table': 'Tabelle {table}',
  'import.loc.tableRow': 'Tabelle {table}, Zeile {row}',
  // §L2.11 — a real table column, so `Spalte`
  'import.loc.tableRowColumn': 'Tabelle {table}, Zeile {row}, Spalte {column}',
  'import.loc.tableRowColumnHeader': 'Tabelle {table}, Zeile {row}, Spalte {column} ({header})',
  'import.loc.tableColumnHeader': 'Tabelle {table}, Spalte {column} ({header})',
  'import.issue.table-limit-exceeded': 'Zu viele Tabellen ({count}, Höchstzahl {max}).',
  'import.issue.column-limit-exceeded':
    'Zu viele zugeordnete Spalten ({count}, Höchstzahl {max}).',
  'import.issue.row-limit-exceeded': 'Zu viele Zeilen ({count}, Höchstzahl {max}).',
  'import.issue.invalid-header-row': 'Die Kopfzeile muss eine ganze Zahl ab 1 sein.',
  'import.issue.invalid-ignore-rows':
    '„Letzte N Zeilen ignorieren“ muss eine ganze Zahl ab 0 sein.',
  'import.issue.empty-table-name': 'Der Tabellenname ist leer.',
  'import.issue.label-too-long': 'Der Tabellenname ist zu lang (höchstens {max} Zeichen).',
  'import.issue.empty-column-header': 'Die Überschrift dieser Spalte ist leer.',
  'import.issue.header-too-long':
    'Die Überschrift dieser Spalte ist zu lang (höchstens {max} Zeichen).',
  'import.issue.missing-source-column-id':
    'Dieser Spalte fehlt ihre interne ID — wählen Sie ihre Rolle erneut aus.',
  'import.issue.duplicate-source-table-id':
    'Die interne ID dieser Tabelle kollidiert mit der einer anderen Tabelle.',
  'import.issue.missing-key-column':
    'Keine Spalte ist als Schlüssel markiert. Wählen Sie „Schlüssel“ für die Spalte, die jede Zeile identifiziert, zum Beispiel eine ID.',
  'import.issue.multiple-key-columns':
    'Mehr als eine Spalte ist als Schlüssel markiert — behalten Sie genau eine.',
  'import.issue.empty-key': 'Der Schlüssel ist leer. Jede Zeile braucht einen Schlüsselwert.',
  'import.issue.key-too-long': 'Der Schlüssel ist zu lang (höchstens {max} Bytes).',
  'import.issue.key-control-char': 'Der Schlüssel enthält ein Steuerzeichen.',
  'import.issue.duplicate-key':
    'Der Schlüssel "{value}" wird bereits von einer anderen Zeile verwendet. Geben Sie jeder Zeile einen eindeutigen Schlüssel.',
  'import.issue.ragged-row':
    'Diese Zeile hat {actual} Zellen; erwartet waren {expected}. Prüfen Sie, ob ein Komma fehlt; Summenzeilen lassen sich mit „Letzte N Zeilen ignorieren“ entfernen.',
  'import.issue.empty-number':
    'Diese Zelle ist leer. Geben Sie eine Zahl ein oder stellen Sie die Spalte auf „Ignorieren“.',
  'import.issue.invalid-number':
    '"{value}" ist keine Zahl. Entfernen Sie Tausendertrennzeichen, Währungssymbole und %, zum Beispiel 4900.',
  'import.issue.orphan-foreign-key':
    'Keine Zeile in der Zieltabelle hat den Schlüssel "{value}".',
  'import.issue.missing-fk-target':
    'Diese Fremdschlüsselspalte hat keine Zieltabelle. Wählen Sie unter der Spaltenüberschrift die Tabelle aus, auf die sie verweist.',
  'import.issue.invalid-fk-target':
    'Die Zieltabelle dieses Fremdschlüssels gibt es nicht mehr.',
  'import.issue.missing-group-by':
    'Diese Tabelle hat zwei oder mehr Fremdschlüsselspalten — wählen Sie aus, welche die Rahmen gruppiert („Rahmen gruppieren nach“ unter der Kopfzeile).',
  'import.issue.invalid-group-by':
    'Die Gruppierungsspalte muss eine der Fremdschlüsselspalten dieser Tabelle sein.',
  'import.issue.round-trip-mismatch':
    'Diese Daten ließen sich nicht sicher speichern — vereinfachen Sie sie und versuchen Sie es erneut.',
  'import.issue.label-fallback':
    'Für diese Referenz ist kein Name verfügbar — stattdessen wird der rohe Schlüssel angezeigt.',
  'import.commitError.source-table-id-collision':
    'Eine Tabelle mit derselben internen ID gibt es bereits — starten Sie den Import erneut.',
  'import.commitError.parameter-id-collision':
    'Eine erzeugte ID kollidierte mit einer vorhandenen — starten Sie den Import erneut.',
  'import.commitError.frame-placement-failed':
    'Für den Rahmen von "{table}" war kein Platz zu finden.',
  'import.commitError.frame-not-found': 'Den ausgewählten Rahmen gibt es nicht mehr.',
  'import.commitError.frame-insufficient-space': 'Zu wenig freier Platz in "{frame}".',
  'import.commitError.invalid-result-graph':
    'Der entstandene Graph ist ungültig — wenden Sie sich bitte an den Support.',
  'import.menu.import': 'Werte aus einem Tabellenblatt als Parameter importieren…',
  'import.menu.manage': 'Importierte Tabellen aktualisieren oder verwalten…',
  'import.menu.guide': 'Ein Tabellenblatt vorbereiten…',
  'import.refresh.manageTitle': 'Verknüpfungen mit Tabellenblättern verwalten',
  'import.refresh.noBindings': 'Noch keine Tabellen aus Tabellenblättern verknüpft.',
  'import.refresh.rowCount': '{n, plural, one {# Zeile} other {# Zeilen}}',
  'import.refresh.renameLabel': 'Tabellenname',
  'import.refresh.refreshButton': 'Aktualisieren…',
  'import.refresh.exportCsv': 'CSV mit Änderungsvorschlägen exportieren',
  'import.refresh.exportBlockedDuplicate':
    'Export blockiert: Dieselbe Zeile und Spalte trägt mehr als einen aktiven Parameter. Beheben Sie die Dopplung vor dem Export.',
  'import.refresh.title': '"{table}" aktualisieren',
  'import.refresh.commit': 'Aktualisierung übernehmen',
  'import.refresh.columnEvents.title': 'Spaltenänderungen',
  'import.refresh.columnEvents.none':
    'Keine Spaltenänderungen — jede Spalte wurde automatisch zugeordnet.',
  'import.refresh.columnEvents.missingHeader':
    'Die Spalte "{header}" ({role}) ist in den neuen Daten nicht mehr enthalten.',
  'import.refresh.columnEvents.ambiguousMatch':
    'Die Spalte "{header}" passt auf mehr als eine eingehende Spalte.',
  'import.refresh.columnEvents.unresolved': '— eine auswählen —',
  'import.refresh.columnEvents.removedOption': 'Spalte entfernt',
  'import.refresh.columnEvents.mapMore': 'Weitere Spalten zuordnen…',
  'import.refresh.columnEvents.unrecognized': 'Die Spalte "{header}" ist nicht zugeordnet.',
  'import.refresh.columnEvents.doNotMap': 'Nicht zuordnen',
  'import.refresh.columnEvents.fkTarget': 'Verweist auf Tabelle…',
  'import.refresh.review.added':
    '{n, plural, one {# Zeile wird hinzugefügt} other {# Zeilen werden hinzugefügt}}',
  'import.refresh.review.missing':
    '{n, plural, one {# Zeile fehlt in den neuen Daten} other {# Zeilen fehlen in den neuen Daten}}',
  'import.refresh.review.changed':
    '{n, plural, one {# Wert wird automatisch aktualisiert} other {# Werte werden automatisch aktualisiert}}',
  'import.refresh.review.conflicts':
    '{n, plural, one {# Wert steht im Konflikt und braucht eine Entscheidung} other {# Werte stehen im Konflikt und brauchen eine Entscheidung}}',
  'import.refresh.review.locallyDeleted':
    '{n, plural, one {# Wert wurde lokal entfernt} other {# Werte wurden lokal entfernt}}',
  'import.refresh.review.fkRepoints':
    '{n, plural, one {# Fremdschlüssel hat sich geändert} other {# Fremdschlüssel haben sich geändert}}',
  'import.refresh.review.newColumnValues':
    '{n, plural, one {# neuer Spaltenwert wird hinzugefügt} other {# neue Spaltenwerte werden hinzugefügt}}',
  'import.refresh.review.confirmAdd': 'Diese Zeile hinzufügen',
  'import.refresh.review.missingChoiceNone': '— auswählen —',
  'import.refresh.review.missingChoiceUnlink':
    'Unverändert behalten, Verknüpfung zum Tabellenblatt lösen',
  'import.refresh.review.missingChoiceDelete': 'Löschen',
  'import.refresh.review.missingBlocked':
    'Wird noch von {table} referenziert — aktualisieren Sie zuerst diese Tabelle.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Den neuen Wert verwenden ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Meinen Wert behalten ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate':
    'Mit dem neuen Wert neu anlegen ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard':
    'Verwerfen — diese Zelle nicht mehr verfolgen',
  'import.refresh.review.fkChoiceAccept': 'Die neue Referenz übernehmen ({value})',
  'import.refresh.review.fkChoiceReject': 'Die alte Referenz behalten ({value})',
  'import.refresh.duplicateTripleError':
    'Diese Daten sind beschädigt: Mehr als ein Parameter ist an dieselbe Zeile und Spalte gebunden. Die Aktualisierung bleibt blockiert, bis das behoben ist.',
  'import.refresh.commitError.referenced-node':
    'Der Parameter dieser Zeile lässt sich nicht löschen — er wird an anderer Stelle im Graphen noch referenziert.',
  'import.refresh.commitError.missing-row-dependency':
    'Diese Zeile lässt sich nicht lösen oder löschen — eine andere Tabelle referenziert sie noch.',
  'import.refresh.commitError.placement-failed':
    'Auf der Arbeitsfläche war kein Platz für die neuen Parameter zu finden — versuchen Sie es aus einer anderen Ansichtsposition erneut.',
  'import.refreshIssue.table-not-found': 'Diese Tabellenverknüpfung gibt es nicht mehr.',
  'import.refreshIssue.unresolved-column-event':
    'Diese Spaltenänderung braucht eine Entscheidung, bevor es weitergeht.',
  'import.refreshIssue.invalid-column-pairing':
    'Diese Spaltenauswahl passt zu keiner ausstehenden Spaltenänderung.',
  'import.refreshIssue.key-column-cannot-be-removed':
    'Die Schlüsselspalte lässt sich nicht entfernen — ordnen Sie sie stattdessen einer anderen eingehenden Spalte zu.',
  'import.refreshIssue.duplicate-column-pairing':
    'Diese Spaltenauswahl steht im Widerspruch zu einer anderen.',
  'import.refreshIssue.invalid-new-column-pairing':
    'Das Fremdschlüsselziel dieser neuen Spalte ist ungültig.',
  'import.refreshIssue.duplicate-source-column-id':
    'Die interne ID dieser Spalte kollidiert mit einer vorhandenen.',
} satisfies Record<DataImportKey, string>

export default dataImport
