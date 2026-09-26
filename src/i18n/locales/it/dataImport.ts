// docs/localization.md §L2.22 — Italian, the spreadsheet-import slice.
//
// PLURAL. `Intl.PluralRules('it')` declares THREE categories — `one`, `many`
// and `other` — so every plural message here writes all three arms, the way
// `ru` and the Portuguese pair do. `many` selects a non-zero integer multiple
// of 1,000,000 and nothing else, so for a row or table count it is not
// reachable through the product's own limits; the arm is written anyway,
// because `check:i18n` and §L4.3 want the declared set complete and because an
// unreachable arm costs nothing while a missing one is a silent fallthrough.
// Its text is identical to `other` for every key in this file — that is the
// correct Italian, not a placeholder.
//
// TERMS: Parameter `Parametro` · Frame `Riquadro` · Canvas `area di disegno` ·
// Refresh `Aggiorna` · import `Importa` / `importazione` ·
// proposal `proposta` · Key/Label/Number/Foreign key are COLUMN ROLES and are
// translated (`Chiave`, `Etichetta`, `Numero`, `Chiave esterna`) because they
// name a control the reader sets, not a wire token.
//
// `import.loc.*` uses `colonna` for a TABLE column. The parser errors in
// `ui.ts` use `carattere` for a character offset — docs §L2.16 keeps those two
// senses apart, and `parserLocation.test.ts` asserts the groups are disjoint.
//
// The Google Sheets and Excel menu paths in `import.qs.sources.*` are
// translated from the published Italian help text. NOBODY HAS OPENED A
// SIGNED-IN ITALIAN GOOGLE SHEETS to read the menu, so they are recorded as
// unverified in §L2.22 rather than treated as settled.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': 'Dati ▾',
  'import.title': 'Importa dati da foglio di calcolo',
  'import.tableName': 'Nome della tabella',
  'import.removeTable': 'Rimuovi la tabella',
  'import.addTable': 'Aggiungi un’altra tabella',
  'import.pastePlaceholder': 'Incolla qui il testo CSV o TSV',
  'import.pasteAria': 'Testo CSV o TSV',
  'import.tableNameRequired': 'Inserisci un nome per la tabella per continuare.',
  'import.pasteDataRequired': 'Incolla o carica dati CSV/TSV per continuare.',
  'import.uploadFile': 'Carica un file…',
  'import.delimiter': 'Delimitatore',
  'import.delimiterAuto': 'Rilevamento automatico',
  'import.delimiterComma': 'Virgola',
  'import.delimiterTab': 'Tabulazione',
  'import.headerRow': 'Riga di intestazione',
  'import.ignoreLastRows': 'Ignora le ultime N righe',
  // `{column}` here is the CSV PARSER's 1-based CHARACTER offset within the
  // row (`src/model/csv.ts`), not a table column — English says "column" for
  // both senses, which is the ambiguity §L2.16 exists to split. `carattere`,
  // never `colonna`. `parserLocation.test.ts` caught this exact key.
  'import.parseError': 'Questo testo non è un CSV/TSV valido: {kind} alla riga {line}, carattere {column}.',
  'import.parseErrorKind.unterminated-quote': 'virgolette non chiuse',
  'import.parseErrorKind.text-after-quote': 'testo inatteso subito dopo le virgolette di chiusura',
  'import.parseErrorKind.quote-in-unquoted-field': 'virgolette dentro un campo non quotato',
  'import.role.ignored': 'Ignora',
  'import.role.key': 'Chiave',
  'import.role.number': 'Numero',
  'import.role.label': 'Etichetta',
  'import.role.foreignKey': 'Chiave esterna',
  'import.roleAria': 'Ruolo della colonna {header}',
  'import.selectTable': 'Seleziona una tabella…',
  'import.selectColumn': 'Seleziona una colonna…',
  'import.selectFrame': 'Seleziona un riquadro…',
  'import.groupBy': 'Raggruppa in riquadri per:',
  'import.warningsFound': '{n, plural, one {# riga userà una chiave grezza al posto di un nome nella sua etichetta.} many {# righe useranno una chiave grezza al posto di un nome nelle loro etichette.} other {# righe useranno una chiave grezza al posto di un nome nelle loro etichette.}}',
  'import.parseErrorsBlockValidation': 'Correggi gli errori CSV/TSV qui sopra prima di continuare.',
  'import.placement.none': 'Colloca sull’area di disegno, senza riquadri',
  'import.placement.framePerTable': 'Un riquadro per tabella',
  'import.placement.existingFrame': 'Aggiungi a un riquadro esistente',
  'import.summary': 'Pronto a importare {tables, plural, one {# tabella} many {# tabelle} other {# tabelle}}, creando {parameters, plural, one {# parametro} many {# parametri} other {# parametri}}.',
  'import.next': 'Avanti',
  'import.back': 'Indietro',
  'import.commit': 'Importa',

  'import.qs.title': 'Guida rapida',
  'import.qs.toggleAria': 'Guida rapida — mostra o nascondi',
  'import.qs.lead': 'Trasforma i numeri di un foglio di calcolo in Parametri regolabili.',
  'import.qs.body':
    'Ogni riga ha bisogno di una colonna con un ID univoco. Ogni colonna che contrassegni come Numero diventa un Parametro per riga. Collegarli al tuo modello resta un passaggio da fare dopo. Non viene caricato nulla e il tuo foglio di calcolo non viene mai modificato.',
  'import.qs.exampleHeading': 'Un esempio minimo',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 righe × 2 colonne Numero = 4 Parametri',
  'import.qs.useExample': 'Usa questo esempio',
  'import.qs.tableLimit': 'Limite di {max} tabelle raggiunto — rimuovi prima una tabella.',
  'import.qs.download': 'Scarica il CSV di esempio',
  'import.qs.fullGuide': 'Guida completa',
  'import.qs.fullGuideAria': 'Guida completa — si apre su GitHub in una nuova scheda',
  'import.qs.sources.summary': 'Come estrarre i dati da Google Sheets o Excel',
  'import.qs.sources.sheets': 'Google Sheets: File → Scarica → Valori separati da virgola (.csv), oppure seleziona un intervallo e copialo.',
  'import.qs.sources.excel': 'Excel o Numbers: Salva con nome / Esporta in CSV, oppure copia un intervallo.',
  'import.qs.sources.privacy':
    'Non usare "Pubblica sul web" su un foglio privato — rende il foglio leggibile da chiunque abbia il link. Uno scaricamento o una copia lo mantengono privato.',
  'import.qs.notImported.summary': 'Che cosa non viene importato',
  'import.qs.notImported.formulas': 'Le formule in sé non vengono importate — un CSV o un incolla portano solo il valore calcolato attuale di ogni cella.',
  'import.qs.notImported.list': 'Formattazione, grafici, celle unite o con più valori, file .xlsx e la sincronizzazione in tempo reale. Il modo in cui i valori interagiscono lo modelli tu.',
  'import.qs.limits': 'Fino a {tables} tabelle, {columns} colonne mappate per tabella, {rows} righe per tabella.',

  'import.roleHelp.title': 'Ruoli delle colonne',
  'import.roleHelp.key': 'ID univoco usato per riconoscere questa riga a ogni aggiornamento.',
  'import.roleHelp.label': 'Nome mostrato sui Parametri generati.',
  'import.roleHelp.number': 'Crea un Parametro regolabile per ogni riga.',
  'import.roleHelp.foreignKey': 'Collega questo valore a una riga di un’altra tabella importata.',
  'import.roleHelp.ignored': 'Tieni questa colonna fuori da Loop Studio.',
  'import.linkTables.summary': 'Collega più tabelle',
  'import.linkTables.body':
    'Aggiungi una seconda tabella e contrassegna una colonna come Chiave esterna per fare riferimento alla Chiave dell’altra tabella. La sua Etichetta arricchisce poi i nomi generati. Una tabella con due Chiavi esterne deve indicare quale delle due raggruppa i riquadri.',

  'import.status.key': 'Chiave: {header}',
  'import.status.keyNone': 'Chiave: ancora nessuna',
  'import.status.keyMany': 'Chiave: {n} colonne — scegline esattamente una',
  'import.status.counts':
    '{cols, plural, one {# colonna Numero} many {# colonne Numero} other {# colonne Numero}} × {rows, plural, one {# riga} many {# righe} other {# righe}} → {n, plural, one {# Parametro} many {# Parametri} other {# Parametri}}',

  'import.placement.frameHelp': 'Un riquadro è un’area delimitata con un’etichetta che raggruppa i nodi sull’area di disegno.',
  'import.placement.noneResult': '{n, plural, one {# Parametro} many {# Parametri} other {# Parametri}} sull’area di disegno, senza riquadri',
  'import.placement.framePerTableResult': '{n, plural, one {verrà creato # riquadro} many {verranno creati # riquadri} other {verranno creati # riquadri}}',
  'import.placement.noFramesYet': 'Ancora nessun riquadro su quest’area di disegno',

  'import.review.col.table': 'Tabella',
  'import.review.col.rows': 'Righe',
  'import.review.col.numberColumns': 'Colonne Numero',
  'import.review.col.parameters': 'Parametri',
  'import.review.col.frames': 'Riquadri',
  'import.review.lookupOnly': '0 (solo consultazione)',
  'import.review.total': 'Totale',
  'import.review.labelsPreview': 'Le etichette saranno così:',
  'import.review.more': '{n, plural, one {… e # altro} many {… e altri #} other {… e altri #}}',

  'import.issueSummary':
    '{n, plural, one {# problema} many {# problemi} other {# problemi}} in {m, plural, one {# tabella} many {# tabelle} other {# tabelle}}. Correggili qui sotto e premi di nuovo Avanti.',
  'import.issueSummaryStale': 'I dati sono cambiati dall’ultimo controllo — premi Avanti per ricontrollare.',
  'import.issueJump': 'Vai a questa cella',

  'import.loc.table': 'Tabella {table}',
  'import.loc.tableRow': 'Tabella {table}, riga {row}',
  'import.loc.tableRowColumn': 'Tabella {table}, riga {row}, colonna {column}',
  'import.loc.tableRowColumnHeader': 'Tabella {table}, riga {row}, colonna {column} ({header})',
  'import.loc.tableColumnHeader': 'Tabella {table}, colonna {column} ({header})',

  'import.issue.table-limit-exceeded': 'Troppe tabelle ({count}, massimo {max}).',
  'import.issue.column-limit-exceeded': 'Troppe colonne mappate ({count}, massimo {max}).',
  'import.issue.row-limit-exceeded': 'Troppe righe ({count}, massimo {max}).',
  'import.issue.invalid-header-row': 'La riga di intestazione deve essere un numero intero maggiore o uguale a 1.',
  'import.issue.invalid-ignore-rows': '"Ignora le ultime N righe" deve essere un numero intero maggiore o uguale a 0.',
  'import.issue.empty-table-name': 'Il nome della tabella è vuoto.',
  'import.issue.label-too-long': 'Il nome della tabella è troppo lungo (massimo {max} caratteri).',
  'import.issue.empty-column-header': 'L’intestazione di questa colonna è vuota.',
  'import.issue.header-too-long': 'L’intestazione di questa colonna è troppo lunga (massimo {max} caratteri).',
  'import.issue.missing-source-column-id': 'A questa colonna manca l’id interno — riseleziona il suo ruolo.',
  'import.issue.duplicate-source-table-id': 'L’id interno di questa tabella coincide con quello di un’altra.',
  'import.issue.missing-key-column': 'Nessuna colonna è contrassegnata come Chiave. Scegli Chiave sulla colonna che identifica ogni riga, ad esempio un ID.',
  'import.issue.multiple-key-columns': 'Più di una colonna è contrassegnata come Chiave — tienine esattamente una.',
  'import.issue.empty-key': 'La Chiave è vuota. Ogni riga deve avere un valore di Chiave.',
  'import.issue.key-too-long': 'La Chiave è troppo lunga (massimo {max} byte).',
  'import.issue.key-control-char': 'La Chiave contiene un carattere di controllo.',
  'import.issue.duplicate-key': 'La Chiave "{value}" è già usata da un’altra riga. Dai a ogni riga una Chiave univoca.',
  'import.issue.ragged-row': 'Questa riga ha {actual} celle; ne erano attese {expected}. Controlla se manca una virgola; le righe di totale si possono escludere con "Ignora le ultime N righe".',
  'import.issue.empty-number': 'Questa cella è vuota. Inserisci un numero, oppure imposta la colonna su Ignora.',
  'import.issue.invalid-number': '"{value}" non è un numero. Togli i separatori delle migliaia, i simboli di valuta e il %, ad esempio 4900.',
  'import.issue.orphan-foreign-key': 'Nessuna riga della tabella di destinazione ha la chiave "{value}".',
  'import.issue.missing-fk-target': 'Questa colonna Chiave esterna non ha una tabella di destinazione. Scegli la tabella a cui si riferisce sotto l’intestazione della colonna.',
  'import.issue.invalid-fk-target': 'La tabella di destinazione di questa chiave esterna non esiste più.',
  'import.issue.missing-group-by': 'Questa tabella ha due o più colonne Chiave esterna — scegli quale raggruppa i riquadri ("Raggruppa in riquadri per" sotto la riga di intestazione).',
  'import.issue.invalid-group-by': 'La colonna di raggruppamento deve essere una delle colonne chiave esterna di questa tabella.',
  'import.issue.round-trip-mismatch': 'Non è stato possibile salvare questi dati in modo sicuro — semplificali e riprova.',
  'import.issue.label-fallback': 'Per questo riferimento non è disponibile alcun nome — verrà mostrata la chiave grezza.',

  'import.commitError.source-table-id-collision': 'Esiste già una tabella con lo stesso id interno — riprova l’importazione.',
  'import.commitError.parameter-id-collision': 'Un id generato coincide con uno esistente — riprova l’importazione.',
  'import.commitError.frame-placement-failed': 'Non è stato trovato spazio per il riquadro di "{table}".',
  'import.commitError.frame-not-found': 'Il riquadro selezionato non esiste più.',
  'import.commitError.frame-insufficient-space': 'Spazio libero insufficiente in "{frame}".',
  'import.commitError.invalid-result-graph': 'Il grafo risultante non è valido — contatta l’assistenza.',

  'import.menu.import': 'Importa valori da foglio di calcolo come Parametri…',
  'import.menu.manage': 'Aggiorna o gestisci le tabelle importate…',
  'import.menu.guide': 'Come preparare un foglio di calcolo…',
  'import.refresh.manageTitle': 'Gestisci i collegamenti ai fogli di calcolo',
  'import.refresh.noBindings': 'Non è ancora collegata alcuna tabella di foglio di calcolo.',
  'import.refresh.rowCount': '{n, plural, one {# riga} many {# righe} other {# righe}}',
  'import.refresh.renameLabel': 'Nome della tabella',
  'import.refresh.refreshButton': 'Aggiorna…',
  'import.refresh.exportCsv': 'Esporta il CSV della proposta di modifica',
  'import.refresh.exportBlockedDuplicate': 'Esportazione bloccata: la stessa riga/colonna ha più di un Parametro attivo. Correggi il duplicato prima di esportare.',
  'import.refresh.title': 'Aggiorna "{table}"',
  'import.refresh.commit': 'Applica l’aggiornamento',

  'import.refresh.columnEvents.title': 'Modifiche alle colonne',
  'import.refresh.columnEvents.none': 'Nessuna modifica alle colonne — ogni colonna è stata riconosciuta automaticamente.',
  'import.refresh.columnEvents.missingHeader': 'La colonna "{header}" ({role}) non è più presente nei nuovi dati.',
  'import.refresh.columnEvents.ambiguousMatch': 'La colonna "{header}" corrisponde a più di una colonna in arrivo.',
  'import.refresh.columnEvents.unresolved': '— scegline una —',
  'import.refresh.columnEvents.removedOption': 'Colonna rimossa',
  'import.refresh.columnEvents.mapMore': 'Mappa altre colonne…',
  'import.refresh.columnEvents.unrecognized': 'La colonna "{header}" non è mappata.',
  'import.refresh.columnEvents.doNotMap': 'Non mappare',
  'import.refresh.columnEvents.fkTarget': 'Fa riferimento alla tabella…',

  'import.refresh.review.added': '{n, plural, one {verrà aggiunta # riga} many {verranno aggiunte # righe} other {verranno aggiunte # righe}}',
  'import.refresh.review.missing': '{n, plural, one {# riga manca nei nuovi dati} many {# righe mancano nei nuovi dati} other {# righe mancano nei nuovi dati}}',
  'import.refresh.review.changed': '{n, plural, one {# valore verrà aggiornato automaticamente} many {# valori verranno aggiornati automaticamente} other {# valori verranno aggiornati automaticamente}}',
  'import.refresh.review.conflicts': '{n, plural, one {# valore è in conflitto e richiede una scelta} many {# valori sono in conflitto e richiedono una scelta} other {# valori sono in conflitto e richiedono una scelta}}',
  'import.refresh.review.locallyDeleted': '{n, plural, one {# valore è stato rimosso in locale} many {# valori sono stati rimossi in locale} other {# valori sono stati rimossi in locale}}',
  'import.refresh.review.fkRepoints': '{n, plural, one {# chiave esterna è cambiata} many {# chiavi esterne sono cambiate} other {# chiavi esterne sono cambiate}}',
  'import.refresh.review.newColumnValues': '{n, plural, one {verrà aggiunto # nuovo valore di colonna} many {verranno aggiunti # nuovi valori di colonna} other {verranno aggiunti # nuovi valori di colonna}}',
  'import.refresh.review.confirmAdd': 'Aggiungi questa riga',
  'import.refresh.review.missingChoiceNone': '— scegli —',
  'import.refresh.review.missingChoiceUnlink': 'Mantieni com’è, scollega dal foglio di calcolo',
  'import.refresh.review.missingChoiceDelete': 'Elimina',
  'import.refresh.review.missingBlocked': 'Ancora referenziata da {table} — aggiorna prima quella tabella.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Usa il nuovo valore ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Mantieni il mio valore ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Ricrea con il nuovo valore ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Scarta — smetti di tracciare questa cella',
  'import.refresh.review.fkChoiceAccept': 'Accetta il nuovo riferimento ({value})',
  'import.refresh.review.fkChoiceReject': 'Mantieni il vecchio riferimento ({value})',

  'import.refresh.duplicateTripleError': 'Questi dati sono corrotti: più di un Parametro è collegato alla stessa riga e colonna. L’aggiornamento è bloccato finché non viene corretto.',
  'import.refresh.commitError.referenced-node': 'Impossibile eliminare il Parametro di questa riga — è ancora referenziato altrove nel grafo.',
  'import.refresh.commitError.missing-row-dependency': 'Impossibile scollegare o eliminare questa riga — un’altra tabella la referenzia ancora.',
  'import.refresh.commitError.placement-failed': 'Non è stato trovato spazio sull’area di disegno per i nuovi Parametri — riprova da una posizione diversa della vista.',

  'import.refreshIssue.table-not-found': 'Questo collegamento alla tabella non esiste più.',
  'import.refreshIssue.unresolved-column-event': 'Questa modifica di colonna richiede una scelta prima di continuare.',
  'import.refreshIssue.invalid-column-pairing': 'Questa scelta di colonna non corrisponde ad alcuna modifica di colonna in sospeso.',
  'import.refreshIssue.key-column-cannot-be-removed': 'La colonna chiave delle righe non può essere rimossa — rinominala su una diversa colonna in arrivo.',
  'import.refreshIssue.duplicate-column-pairing': 'Questa scelta di colonna è in conflitto con un’altra.',
  'import.refreshIssue.invalid-new-column-pairing': 'La destinazione della chiave esterna di questa nuova colonna non è valida.',
  'import.refreshIssue.duplicate-source-column-id': 'L’id interno di questa colonna coincide con uno esistente.',
} satisfies Record<DataImportKey, string>

export default dataImport
