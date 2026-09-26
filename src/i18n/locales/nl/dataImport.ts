// docs/data-import.md §DI16 / §DI17 — the CSV/TSV import wizard, `nl`.
// Key-checked against `../en/dataImport` by `satisfies`; same `{name}` slots.
//
// TWO DIFFERENT `{column}` SLOTS, and they must not share a word:
//   • `import.parseError` — `{column}` is the PARSER's character offset into
//     a line, so it is `teken`;
//   • `import.loc.*` — `{column}` is a spreadsheet TABLE column, so it is
//     `kolom`.
// `teken` and `kolom` share no stem, so a mix-up cannot hide behind a common
// prefix. `src/i18n/parserLocation.test.ts` asserts the two groups stay
// disjoint and exhaustive.

const dataImport = {
  'import.button': 'Gegevens ▾',
  'import.title': 'Spreadsheetgegevens importeren',
  'import.tableName': 'Tabelnaam',
  'import.removeTable': 'Tabel verwijderen',
  'import.addTable': 'Nog een tabel toevoegen',
  'import.pastePlaceholder': 'Plak hier CSV- of TSV-tekst',
  'import.pasteAria': 'CSV- of TSV-tekst',
  'import.tableNameRequired': 'Voer een tabelnaam in om door te gaan.',
  'import.pasteDataRequired': 'Plak of upload CSV-/TSV-gegevens om door te gaan.',
  'import.uploadFile': 'Bestand uploaden…',
  'import.delimiter': 'Scheidingsteken',
  'import.delimiterAuto': 'Automatisch herkennen',
  'import.delimiterComma': 'Komma',
  'import.delimiterTab': 'Tab',
  'import.headerRow': 'Koprij',
  'import.ignoreLastRows': 'Laatste N rijen negeren',
  'import.parseError': 'Deze tekst is geen geldige CSV/TSV: {kind} op regel {line}, teken {column}.',
  'import.parseErrorKind.unterminated-quote': 'een niet-afgesloten aanhalingsteken',
  'import.parseErrorKind.text-after-quote': 'onverwachte tekst direct na een sluitend aanhalingsteken',
  'import.parseErrorKind.quote-in-unquoted-field': 'een aanhalingsteken in een veld zonder aanhalingstekens',
  'import.role.ignored': 'Negeren',
  'import.role.key': 'Sleutel',
  'import.role.number': 'Getal',
  'import.role.label': 'Label',
  'import.role.foreignKey': 'Externe sleutel',
  'import.roleAria': 'Rol voor kolom {header}',
  'import.selectTable': 'Kies een tabel…',
  'import.selectColumn': 'Kies een kolom…',
  'import.selectFrame': 'Kies een kader…',
  'import.groupBy': 'Kader groeperen op:',
  'import.warningsFound': '{n, plural, one {# rij gebruikt een ruwe sleutel in plaats van een naam in het label.} other {# rijen gebruiken een ruwe sleutel in plaats van een naam in hun labels.}}',
  'import.parseErrorsBlockValidation': 'Herstel de CSV-/TSV-fouten hierboven voordat je doorgaat.',
  'import.placement.none': 'Op het tekengebied plaatsen, geen kaders',
  'import.placement.framePerTable': 'Eén kader per tabel',
  'import.placement.existingFrame': 'Aan een bestaand kader toevoegen',
  'import.summary': 'Klaar om {tables, plural, one {# tabel} other {# tabellen}} te importeren, wat {parameters, plural, one {# parameter} other {# parameters}} oplevert.',
  'import.next': 'Volgende',
  'import.back': 'Terug',
  'import.commit': 'Importeren',

  // §DI17 -- the quick start block
  'import.qs.title': 'Snel starten',
  'import.qs.toggleAria': 'Snel starten — tonen of verbergen',
  'import.qs.lead': 'Maak van de getallen in een spreadsheet instelbare Parameters.',
  'import.qs.body':
    'Elke rij heeft één kolom met een uniek ID nodig. Elke kolom die je als Getal markeert, levert één Parameter per rij op. Ze aan je model koppelen blijft daarna jouw stap. Er wordt niets geüpload, en je spreadsheet wordt nooit gewijzigd.',
  'import.qs.exampleHeading': 'Een minimaal voorbeeld',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 rijen × 2 Getal-kolommen = 4 Parameters',
  'import.qs.useExample': 'Dit voorbeeld gebruiken',
  'import.qs.tableLimit': 'De limiet van {max} tabellen is bereikt — verwijder eerst een tabel.',
  'import.qs.download': 'Voorbeeld-CSV downloaden',
  'import.qs.fullGuide': 'Volledige handleiding',
  'import.qs.fullGuideAria': 'Volledige handleiding — opent op GitHub in een nieuw tabblad',
  'import.qs.sources.summary': 'Gegevens uit Google Spreadsheets of Excel halen',
  'import.qs.sources.sheets': 'Google Spreadsheets: Bestand → Downloaden → Door komma’s gescheiden waarden (.csv), of selecteer een bereik en kopieer het.',
  'import.qs.sources.excel': 'Excel of Numbers: Opslaan als / Exporteren naar CSV, of kopieer een bereik.',
  'import.qs.sources.privacy':
    'Gebruik "Publiceren op internet" niet voor een privéspreadsheet — daarmee wordt het blad leesbaar voor iedereen met de link. Downloaden of kopiëren houdt het privé.',
  'import.qs.notImported.summary': 'Wat niet wordt geïmporteerd',
  'import.qs.notImported.formulas': 'Formules zelf worden niet geïmporteerd — een CSV of een plakactie draagt alleen de huidige berekende waarde van elke cel.',
  'import.qs.notImported.list': 'Opmaak, grafieken, samengevoegde cellen of cellen met meerdere waarden, .xlsx-bestanden en live synchronisatie. Hoe de waarden op elkaar inwerken, modelleer je zelf.',
  'import.qs.limits': 'Maximaal {tables} tabellen, {columns} toegewezen kolommen per tabel, {rows} rijen per tabel.',

  // §DI17 -- the shared role help (rendered ONCE per dialog; each role
  // select points at its role's line via aria-describedby)
  'import.roleHelp.title': 'Kolomrollen',
  'import.roleHelp.key': 'Uniek ID waarmee deze rij bij het vernieuwen wordt teruggevonden.',
  'import.roleHelp.label': 'Naam die op de gegenereerde Parameters wordt getoond.',
  'import.roleHelp.number': 'Maakt voor elke rij één instelbare Parameter.',
  'import.roleHelp.foreignKey': 'Koppelt deze waarde aan een rij in een andere geïmporteerde tabel.',
  'import.roleHelp.ignored': 'Houd deze kolom buiten Loop Studio.',
  'import.linkTables.summary': 'Meerdere tabellen koppelen',
  'import.linkTables.body':
    'Voeg een tweede tabel toe en markeer een kolom als Externe sleutel om naar de Sleutel van de andere tabel te verwijzen. Het Label daarvan verrijkt dan de gegenereerde namen. Een tabel met twee Externe sleutels moet kiezen welke de kaders groepeert.',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': 'Sleutel: {header}',
  'import.status.keyNone': 'Sleutel: nog geen',
  'import.status.keyMany': 'Sleutel: {n} kolommen — kies er precies één',
  'import.status.counts':
    '{cols, plural, one {# Getal-kolom} other {# Getal-kolommen}} × {rows, plural, one {# rij} other {# rijen}} → {n, plural, one {# Parameter} other {# Parameters}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp': 'Een kader is een benoemd vak dat knooppunten op het tekengebied groepeert.',
  'import.placement.noneResult': '{n, plural, one {# Parameter} other {# Parameters}} op het tekengebied, geen kaders',
  'import.placement.framePerTableResult': '{n, plural, one {er wordt # kader gemaakt} other {er worden # kaders gemaakt}}',
  'import.placement.noFramesYet': 'Nog geen kaders op dit tekengebied',

  // §DI17 -- the review breakdown
  'import.review.col.table': 'Tabel',
  'import.review.col.rows': 'Rijen',
  'import.review.col.numberColumns': 'Getal-kolommen',
  'import.review.col.parameters': 'Parameters',
  'import.review.col.frames': 'Kaders',
  'import.review.lookupOnly': '0 (alleen opzoeken)',
  'import.review.total': 'Totaal',
  'import.review.labelsPreview': 'De labels gaan er zo uitzien:',
  'import.review.more': '{n, plural, one {… en nog #} other {… en nog #}}',

  // §DI17 -- inline validation errors (no separate step)
  'import.issueSummary':
    '{n, plural, one {# probleem} other {# problemen}} in {m, plural, one {# tabel} other {# tabellen}}. Herstel ze hieronder en druk opnieuw op Volgende.',
  'import.issueSummaryStale': 'De invoer is gewijzigd sinds de laatste controle — druk op Volgende om opnieuw te controleren.',
  'import.issueJump': 'Ga naar deze cel',

  // location composers -- prefixed to an `import.issue.*` / `import.commitError.*`
  // description below, e.g. "Table Items, row 3: <description>".
  'import.loc.table': 'Tabel {table}',
  'import.loc.tableRow': 'Tabel {table}, rij {row}',
  'import.loc.tableRowColumn': 'Tabel {table}, rij {row}, kolom {column}',
  'import.loc.tableRowColumnHeader': 'Tabel {table}, rij {row}, kolom {column} ({header})',
  'import.loc.tableColumnHeader': 'Tabel {table}, kolom {column} ({header})',

  // one description per `IssueCode` (dataImportValidate.ts) -- the location
  // (table/row/column) is composed separately via `import.loc.*` above, so
  // these never repeat it.
  'import.issue.table-limit-exceeded': 'Te veel tabellen ({count}, maximaal {max}).',
  'import.issue.column-limit-exceeded': 'Te veel toegewezen kolommen ({count}, maximaal {max}).',
  'import.issue.row-limit-exceeded': 'Te veel rijen ({count}, maximaal {max}).',
  'import.issue.invalid-header-row': 'De koprij moet een geheel getal van 1 of hoger zijn.',
  'import.issue.invalid-ignore-rows': 'Laatste N rijen negeren moet een geheel getal van 0 of hoger zijn.',
  'import.issue.empty-table-name': 'De tabelnaam is leeg.',
  'import.issue.label-too-long': 'De tabelnaam is te lang (maximaal {max} tekens).',
  'import.issue.empty-column-header': 'De kop van deze kolom is leeg.',
  'import.issue.header-too-long': 'De kop van deze kolom is te lang (maximaal {max} tekens).',
  'import.issue.missing-source-column-id': 'Deze kolom mist zijn interne id — kies de rol opnieuw.',
  'import.issue.duplicate-source-table-id': 'Het interne id van deze tabel botst met dat van een andere tabel.',
  'import.issue.missing-key-column': 'Geen enkele kolom is als Sleutel gemarkeerd. Kies Sleutel op de kolom die elke rij identificeert, zoals een ID.',
  'import.issue.multiple-key-columns': 'Meer dan één kolom is als Sleutel gemarkeerd — houd er precies één over.',
  'import.issue.empty-key': 'De Sleutel is leeg. Elke rij heeft een Sleutelwaarde nodig.',
  'import.issue.key-too-long': 'De Sleutel is te lang (maximaal {max} bytes).',
  'import.issue.key-control-char': 'De Sleutel bevat een stuurteken.',
  'import.issue.duplicate-key': 'Sleutel "{value}" is al door een andere rij in gebruik. Geef elke rij een unieke Sleutel.',
  'import.issue.ragged-row': 'Deze rij heeft {actual} cellen; verwacht werden er {expected}. Controleer op een ontbrekende komma; samenvattingsrijen kun je weglaten met "Laatste N rijen negeren".',
  'import.issue.empty-number': 'Deze cel is leeg. Voer een getal in, of zet de kolom op Negeren.',
  'import.issue.invalid-number': '"{value}" is geen getal. Verwijder duizendtalscheidingstekens, valutasymbolen en %, bijvoorbeeld 4900.',
  'import.issue.orphan-foreign-key': 'Geen enkele rij in de doeltabel heeft de sleutel "{value}".',
  'import.issue.missing-fk-target': 'Deze kolom met een Externe sleutel heeft geen doeltabel. Kies onder de kolomkop naar welke tabel hij verwijst.',
  'import.issue.invalid-fk-target': 'De doeltabel voor deze externe sleutel bestaat niet meer.',
  'import.issue.missing-group-by': 'Deze tabel heeft twee of meer kolommen met een Externe sleutel — kies welke de kaders groepeert ("Kader groeperen op" onder de koprij).',
  'import.issue.invalid-group-by': 'De kolom om op te groeperen moet een van de kolommen met een externe sleutel van deze tabel zijn.',
  'import.issue.round-trip-mismatch': 'Deze gegevens konden niet veilig worden opgeslagen — vereenvoudig ze en probeer het opnieuw.',
  'import.issue.label-fallback': 'Er is geen naam beschikbaar voor deze verwijzing — in plaats daarvan wordt de ruwe sleutel getoond.',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision': 'Er bestaat al een tabel met hetzelfde interne id — probeer de import opnieuw.',
  'import.commitError.parameter-id-collision': 'Een gegenereerd id botste met een bestaand id — probeer de import opnieuw.',
  'import.commitError.frame-placement-failed': 'Kon geen ruimte vinden voor het kader van "{table}".',
  'import.commitError.frame-not-found': 'Het gekozen kader bestaat niet meer.',
  'import.commitError.frame-insufficient-space': 'Niet genoeg vrije ruimte in "{frame}".',
  'import.commitError.invalid-result-graph': 'Het resulterende diagram is ongeldig — neem contact op met de ondersteuning.',

  // docs/data-import.md §DI16 Phase 2 -- the manage-bindings dialog + the
  // 4-step refresh wizard. §DI17 reworded the menu items and added the guide entry.
  'import.menu.import': 'Spreadsheetwaarden als Parameters importeren…',
  'import.menu.manage': 'Geïmporteerde tabellen vernieuwen of beheren…',
  'import.menu.guide': 'Een spreadsheet voorbereiden…',
  'import.refresh.manageTitle': 'Spreadsheetkoppelingen beheren',
  'import.refresh.noBindings': 'Er zijn nog geen spreadsheettabellen gekoppeld.',
  'import.refresh.rowCount': '{n, plural, one {# rij} other {# rijen}}',
  'import.refresh.renameLabel': 'Tabelnaam',
  'import.refresh.refreshButton': 'Vernieuwen…',
  'import.refresh.exportCsv': 'CSV met wijzigingsvoorstel exporteren',
  'import.refresh.exportBlockedDuplicate': 'Exporteren geblokkeerd: dezelfde rij/kolom heeft meer dan één actieve Parameter. Herstel het duplicaat voordat je exporteert.',
  'import.refresh.title': '"{table}" vernieuwen',
  'import.refresh.commit': 'Vernieuwen doorvoeren',

  'import.refresh.columnEvents.title': 'Kolomwijzigingen',
  'import.refresh.columnEvents.none': 'Geen kolomwijzigingen — elke kolom is automatisch teruggevonden.',
  'import.refresh.columnEvents.missingHeader': 'De kolom "{header}" ({role}) staat niet meer in de nieuwe gegevens.',
  'import.refresh.columnEvents.ambiguousMatch': 'De kolom "{header}" past bij meer dan één binnenkomende kolom.',
  'import.refresh.columnEvents.unresolved': '— kies er een —',
  'import.refresh.columnEvents.removedOption': 'Kolom verwijderd',
  'import.refresh.columnEvents.mapMore': 'Meer kolommen toewijzen…',
  'import.refresh.columnEvents.unrecognized': 'Kolom "{header}" is niet toegewezen.',
  'import.refresh.columnEvents.doNotMap': 'Niet toewijzen',
  'import.refresh.columnEvents.fkTarget': 'Verwijst naar tabel…',

  'import.refresh.review.added': '{n, plural, one {er wordt # rij toegevoegd} other {er worden # rijen toegevoegd}}',
  'import.refresh.review.missing': '{n, plural, one {# rij ontbreekt in de nieuwe gegevens} other {# rijen ontbreken in de nieuwe gegevens}}',
  'import.refresh.review.changed': '{n, plural, one {# waarde wordt automatisch bijgewerkt} other {# waarden worden automatisch bijgewerkt}}',
  'import.refresh.review.conflicts': '{n, plural, one {# waarde geeft een conflict en vraagt om een keuze} other {# waarden geven een conflict en vragen om een keuze}}',
  'import.refresh.review.locallyDeleted': '{n, plural, one {# waarde is lokaal verwijderd} other {# waarden zijn lokaal verwijderd}}',
  'import.refresh.review.fkRepoints': '{n, plural, one {# externe sleutel is gewijzigd} other {# externe sleutels zijn gewijzigd}}',
  'import.refresh.review.newColumnValues': '{n, plural, one {er wordt # nieuwe kolomwaarde toegevoegd} other {er worden # nieuwe kolomwaarden toegevoegd}}',
  'import.refresh.review.confirmAdd': 'Deze rij toevoegen',
  'import.refresh.review.missingChoiceNone': '— kies —',
  'import.refresh.review.missingChoiceUnlink': 'Ongewijzigd laten, loskoppelen van de spreadsheet',
  'import.refresh.review.missingChoiceDelete': 'Verwijderen',
  'import.refresh.review.missingBlocked': 'Nog steeds gebruikt door {table} — vernieuw die tabel eerst.',
  'import.refresh.review.cellChoiceApplyIncoming': 'De nieuwe waarde gebruiken ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Mijn waarde behouden ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Opnieuw maken met de nieuwe waarde ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Verwerpen — deze cel niet meer volgen',
  'import.refresh.review.fkChoiceAccept': 'De nieuwe verwijzing accepteren ({value})',
  'import.refresh.review.fkChoiceReject': 'De oude verwijzing behouden ({value})',

  'import.refresh.duplicateTripleError': 'Deze gegevens zijn beschadigd: meer dan één Parameter is aan dezelfde rij en kolom gekoppeld. Vernieuwen is geblokkeerd tot dit is hersteld.',
  'import.refresh.commitError.referenced-node': 'De Parameter van deze rij kan niet worden verwijderd — er wordt elders in het diagram nog naar verwezen.',
  'import.refresh.commitError.missing-row-dependency': 'Deze rij kan niet worden losgekoppeld of verwijderd — een andere tabel verwijst er nog naar.',
  'import.refresh.commitError.placement-failed': 'Kon op het tekengebied geen ruimte vinden voor de nieuwe Parameter(s) — probeer het opnieuw vanuit een andere weergavepositie.',

  // one description per REFRESH-ONLY `RefreshIssueCode` not already covered
  // by an `import.issue.*` entry above (the overlapping codes reuse those
  // verbatim -- same meaning, same wording).
  'import.refreshIssue.table-not-found': 'Deze tabelkoppeling bestaat niet meer.',
  'import.refreshIssue.unresolved-column-event': 'Deze kolomwijziging vraagt om een keuze voordat je doorgaat.',
  'import.refreshIssue.invalid-column-pairing': 'Deze kolomkeuze past bij geen enkele openstaande kolomwijziging.',
  'import.refreshIssue.key-column-cannot-be-removed': 'De kolom met de rijsleutel kan niet worden verwijderd — hernoem hem in plaats daarvan naar een andere binnenkomende kolom.',
  'import.refreshIssue.duplicate-column-pairing': 'Deze kolomkeuze botst met een andere.',
  'import.refreshIssue.invalid-new-column-pairing': 'Het doel van de externe sleutel van deze nieuwe kolom is ongeldig.',
  'import.refreshIssue.duplicate-source-column-id': 'Het interne id van deze kolom botst met een bestaand id.',
} as const

export default dataImport
