// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard's own key
// group, mirroring `templates.ts`'s `modules.*` split-by-feature convention.
// §DI17 added the in-tool guide keys (`import.qs.*`, `import.roleHelp.*`,
// `import.status.*`, `import.review.*`, the inline-error summary).

const dataImport = {
  'import.button': 'Data ▾',
  'import.title': 'Import spreadsheet data',
  'import.tableName': 'Table name',
  'import.removeTable': 'Remove table',
  'import.addTable': 'Add another table',
  'import.pastePlaceholder': 'Paste CSV or TSV text here',
  'import.pasteAria': 'CSV or TSV text',
  'import.tableNameRequired': 'Enter a table name to continue.',
  'import.pasteDataRequired': 'Paste or upload CSV/TSV data to continue.',
  'import.uploadFile': 'Upload file…',
  'import.delimiter': 'Delimiter',
  'import.delimiterAuto': 'Auto-detect',
  'import.delimiterComma': 'Comma',
  'import.delimiterTab': 'Tab',
  'import.headerRow': 'Header row',
  'import.ignoreLastRows': 'Ignore last N rows',
  'import.parseError': 'This text is not valid CSV/TSV: {kind} at line {line}, column {column}.',
  'import.parseErrorKind.unterminated-quote': 'an unterminated quote',
  'import.parseErrorKind.text-after-quote': 'unexpected text right after a closing quote',
  'import.parseErrorKind.quote-in-unquoted-field': 'a quote inside an unquoted field',
  'import.role.ignored': 'Ignore',
  'import.role.key': 'Key',
  'import.role.number': 'Number',
  'import.role.label': 'Label',
  'import.role.foreignKey': 'Foreign key',
  'import.roleAria': 'Role for column {header}',
  'import.selectTable': 'Select a table…',
  'import.selectColumn': 'Select a column…',
  'import.selectFrame': 'Select a frame…',
  'import.groupBy': 'Group frame by:',
  'import.warningsFound': '{n, plural, one {# row will use a raw key instead of a name in its label.} other {# rows will use a raw key instead of a name in their labels.}}',
  'import.parseErrorsBlockValidation': 'Fix the CSV/TSV errors above before continuing.',
  'import.placement.none': 'Place on the canvas, no frames',
  'import.placement.framePerTable': 'One frame per table',
  'import.placement.existingFrame': 'Add to an existing frame',
  'import.summary': 'Ready to import {tables, plural, one {# table} other {# tables}}, creating {parameters, plural, one {# parameter} other {# parameters}}.',
  'import.next': 'Next',
  'import.back': 'Back',
  'import.commit': 'Import',

  // §DI17 -- the quick start block
  'import.qs.title': 'Quick start',
  'import.qs.toggleAria': 'Quick start — show or hide',
  'import.qs.lead': 'Turn the numbers in a spreadsheet into adjustable Parameters.',
  'import.qs.body':
    'Each row needs one column with a unique ID. Every column you mark as Number becomes one Parameter per row. Connecting them to your model is still your step afterwards. Nothing is uploaded, and your spreadsheet is never changed.',
  'import.qs.exampleHeading': 'A minimal example',
  'import.qs.mapping': 'item_id → {key} · item_name → {label} · price → {number} · drop_rate → {number}',
  'import.qs.result': '2 rows × 2 Number columns = 4 Parameters',
  'import.qs.useExample': 'Use this example',
  'import.qs.tableLimit': 'The {max}-table limit is reached — remove a table first.',
  'import.qs.download': 'Download sample CSV',
  'import.qs.fullGuide': 'Full guide',
  'import.qs.fullGuideAria': 'Full guide — opens on GitHub in a new tab',
  'import.qs.sources.summary': 'Getting data out of Google Sheets or Excel',
  'import.qs.sources.sheets': 'Google Sheets: File → Download → Comma-separated values (.csv), or select a range and copy it.',
  'import.qs.sources.excel': 'Excel or Numbers: Save As / Export to CSV, or copy a range.',
  'import.qs.sources.privacy':
    'Do not use "Publish to web" on a private sheet — it makes the sheet readable by anyone with the link. A download or a copy keeps it private.',
  'import.qs.notImported.summary': 'What is not imported',
  'import.qs.notImported.formulas': "Formulas themselves are not imported — a CSV or a paste only carries each cell's current calculated value.",
  'import.qs.notImported.list': 'Formatting, charts, merged or multi-value cells, .xlsx files, and live sync. You model how the values interact yourself.',
  'import.qs.limits': 'Up to {tables} tables, {columns} mapped columns per table, {rows} rows per table.',

  // §DI17 -- the shared role help (rendered ONCE per dialog; each role
  // select points at its role's line via aria-describedby)
  'import.roleHelp.title': 'Column roles',
  'import.roleHelp.key': 'Unique ID used to match this row on refresh.',
  'import.roleHelp.label': 'Name shown on generated Parameters.',
  'import.roleHelp.number': 'Creates one adjustable Parameter for every row.',
  'import.roleHelp.foreignKey': 'Links this value to a row in another imported table.',
  'import.roleHelp.ignored': 'Keep this column out of Loop Studio.',
  'import.linkTables.summary': 'Link multiple tables',
  'import.linkTables.body':
    'Add a second table and mark a column Foreign key to reference the other table\'s Key. Its Label then enriches the generated names. A table with two Foreign keys must pick which one groups the frames.',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': 'Key: {header}',
  'import.status.keyNone': 'Key: none yet',
  'import.status.keyMany': 'Key: {n} columns — choose exactly one',
  'import.status.counts':
    '{cols, plural, one {# Number column} other {# Number columns}} × {rows, plural, one {# row} other {# rows}} → {n, plural, one {# Parameter} other {# Parameters}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp': 'A frame is a labelled box that groups nodes on the canvas.',
  'import.placement.noneResult': '{n, plural, one {# Parameter} other {# Parameters}} on the canvas, no frames',
  'import.placement.framePerTableResult': '{n, plural, one {# frame} other {# frames}} will be created',
  'import.placement.noFramesYet': 'No frames on this canvas yet',

  // §DI17 -- the review breakdown
  'import.review.col.table': 'Table',
  'import.review.col.rows': 'Rows',
  'import.review.col.numberColumns': 'Number columns',
  'import.review.col.parameters': 'Parameters',
  'import.review.col.frames': 'Frames',
  'import.review.lookupOnly': '0 (lookup only)',
  'import.review.total': 'Total',
  'import.review.labelsPreview': 'Labels will look like:',
  'import.review.more': '{n, plural, one {… and # more} other {… and # more}}',

  // §DI17 -- inline validation errors (no separate step)
  'import.issueSummary':
    '{n, plural, one {# problem} other {# problems}} in {m, plural, one {# table} other {# tables}}. Fix them below and press Next again.',
  'import.issueSummaryStale': 'The input changed since the last check — press Next to check again.',
  'import.issueJump': 'Go to this cell',

  // location composers -- prefixed to an `import.issue.*` / `import.commitError.*`
  // description below, e.g. "Table Items, row 3: <description>".
  'import.loc.table': 'Table {table}',
  'import.loc.tableRow': 'Table {table}, row {row}',
  'import.loc.tableRowColumn': 'Table {table}, row {row}, column {column}',
  'import.loc.tableRowColumnHeader': 'Table {table}, row {row}, column {column} ({header})',
  'import.loc.tableColumnHeader': 'Table {table}, column {column} ({header})',

  // one description per `IssueCode` (dataImportValidate.ts) -- the location
  // (table/row/column) is composed separately via `import.loc.*` above, so
  // these never repeat it.
  'import.issue.table-limit-exceeded': 'Too many tables ({count}, maximum {max}).',
  'import.issue.column-limit-exceeded': 'Too many mapped columns ({count}, maximum {max}).',
  'import.issue.row-limit-exceeded': 'Too many rows ({count}, maximum {max}).',
  'import.issue.invalid-header-row': 'The header row must be a whole number of 1 or more.',
  'import.issue.invalid-ignore-rows': 'Ignore last N rows must be a whole number of 0 or more.',
  'import.issue.empty-table-name': 'The table name is empty.',
  'import.issue.label-too-long': 'The table name is too long (maximum {max} characters).',
  'import.issue.empty-column-header': "This column's header is empty.",
  'import.issue.header-too-long': "This column's header is too long (maximum {max} characters).",
  'import.issue.missing-source-column-id': 'This column is missing its internal id — re-select its role.',
  'import.issue.duplicate-source-table-id': "This table's internal id collides with another table's.",
  'import.issue.missing-key-column': 'No column is marked Key. Choose Key on the column that identifies each row, such as an ID.',
  'import.issue.multiple-key-columns': 'More than one column is marked Key — keep exactly one.',
  'import.issue.empty-key': 'The Key is empty. Every row needs a Key value.',
  'import.issue.key-too-long': 'The Key is too long (maximum {max} bytes).',
  'import.issue.key-control-char': 'The Key contains a control character.',
  'import.issue.duplicate-key': 'Key "{value}" is already used by another row. Give every row a unique Key.',
  'import.issue.ragged-row': 'This row has {actual} cells; expected {expected}. Check for a missing comma; summary rows can be dropped with "Ignore last N rows".',
  'import.issue.empty-number': 'This cell is empty. Enter a number, or set the column to Ignore.',
  'import.issue.invalid-number': '"{value}" is not a number. Remove thousands separators, currency symbols and %, for example 4900.',
  'import.issue.orphan-foreign-key': 'No row in the target table has the key "{value}".',
  'import.issue.missing-fk-target': 'This Foreign key column has no target table. Pick the table it refers to under the column header.',
  'import.issue.invalid-fk-target': 'The target table for this foreign key no longer exists.',
  'import.issue.missing-group-by': 'This table has two or more Foreign key columns — pick which one groups the frames ("Group frame by" under the header row).',
  'import.issue.invalid-group-by': "The group-by column must be one of this table's foreign key columns.",
  'import.issue.round-trip-mismatch': 'This data could not be stored safely — please simplify it and try again.',
  'import.issue.label-fallback': 'No name is available for this reference — the raw key will be shown instead.',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision': 'A table with a matching internal id already exists — please retry the import.',
  'import.commitError.parameter-id-collision': 'A generated id collided with an existing one — please retry the import.',
  'import.commitError.frame-placement-failed': 'Could not find space for "{table}"\'s frame.',
  'import.commitError.frame-not-found': 'The selected frame no longer exists.',
  'import.commitError.frame-insufficient-space': 'Not enough free space in "{frame}".',
  'import.commitError.invalid-result-graph': 'The resulting graph is invalid — please contact support.',

  // docs/data-import.md §DI16 Phase 2 -- the manage-bindings dialog + the
  // 4-step refresh wizard. §DI17 reworded the menu items and added the guide entry.
  'import.menu.import': 'Import spreadsheet values as Parameters…',
  'import.menu.manage': 'Refresh or manage imported tables…',
  'import.menu.guide': 'How to prepare a spreadsheet…',
  'import.refresh.manageTitle': 'Manage spreadsheet bindings',
  'import.refresh.noBindings': 'No spreadsheet tables are bound yet.',
  'import.refresh.rowCount': '{n, plural, one {# row} other {# rows}}',
  'import.refresh.renameLabel': 'Table name',
  'import.refresh.refreshButton': 'Refresh…',
  'import.refresh.exportCsv': 'Export change-proposal CSV',
  'import.refresh.exportBlockedDuplicate': 'Export blocked: the same row/column has more than one active Parameter. Fix the duplicate before exporting.',
  'import.refresh.title': 'Refresh "{table}"',
  'import.refresh.commit': 'Commit refresh',

  'import.refresh.columnEvents.title': 'Column changes',
  'import.refresh.columnEvents.none': 'No column changes — every column matched automatically.',
  'import.refresh.columnEvents.missingHeader': 'The column "{header}" ({role}) is no longer in the new data.',
  'import.refresh.columnEvents.ambiguousMatch': 'The column "{header}" matches more than one incoming column.',
  'import.refresh.columnEvents.unresolved': '— choose one —',
  'import.refresh.columnEvents.removedOption': 'Column removed',
  'import.refresh.columnEvents.mapMore': 'Map more columns…',
  'import.refresh.columnEvents.unrecognized': 'Column "{header}" is not mapped.',
  'import.refresh.columnEvents.doNotMap': "Don't map",
  'import.refresh.columnEvents.fkTarget': 'References table…',

  'import.refresh.review.added': '{n, plural, one {# row will be added} other {# rows will be added}}',
  'import.refresh.review.missing': '{n, plural, one {# row is missing from the new data} other {# rows are missing from the new data}}',
  'import.refresh.review.changed': '{n, plural, one {# value will update automatically} other {# values will update automatically}}',
  'import.refresh.review.conflicts': '{n, plural, one {# value conflicts and needs a choice} other {# values conflict and need a choice}}',
  'import.refresh.review.locallyDeleted': '{n, plural, one {# value was removed locally} other {# values were removed locally}}',
  'import.refresh.review.fkRepoints': '{n, plural, one {# foreign key changed} other {# foreign keys changed}}',
  'import.refresh.review.newColumnValues': '{n, plural, one {# new column value will be added} other {# new column values will be added}}',
  'import.refresh.review.confirmAdd': 'Add this row',
  'import.refresh.review.missingChoiceNone': '— choose —',
  'import.refresh.review.missingChoiceUnlink': 'Keep as-is, unlink from spreadsheet',
  'import.refresh.review.missingChoiceDelete': 'Delete',
  'import.refresh.review.missingBlocked': 'Still referenced by {table} — refresh that table first.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Use the new value ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Keep my value ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Recreate with the new value ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Discard — stop tracking this cell',
  'import.refresh.review.fkChoiceAccept': 'Accept the new reference ({value})',
  'import.refresh.review.fkChoiceReject': 'Keep the old reference ({value})',

  'import.refresh.duplicateTripleError': 'This data is corrupted: more than one Parameter is bound to the same row and column. Refresh is blocked until this is fixed.',
  'import.refresh.commitError.referenced-node': "Can't delete this row's Parameter — it is still referenced elsewhere in the graph.",
  'import.refresh.commitError.missing-row-dependency': "Can't unlink or delete this row — another table still references it.",
  'import.refresh.commitError.placement-failed': 'Could not find space on the canvas for the new Parameter(s) — try again from a different viewport position.',

  // one description per REFRESH-ONLY `RefreshIssueCode` not already covered
  // by an `import.issue.*` entry above (the overlapping codes reuse those
  // verbatim — same meaning, same wording).
  'import.refreshIssue.table-not-found': 'This table binding no longer exists.',
  'import.refreshIssue.unresolved-column-event': 'This column change needs a choice before continuing.',
  'import.refreshIssue.invalid-column-pairing': "This column choice doesn't match any pending column change.",
  'import.refreshIssue.key-column-cannot-be-removed': "The row-key column can't be removed — rename it to a different incoming column instead.",
  'import.refreshIssue.duplicate-column-pairing': 'This column choice conflicts with another one.',
  'import.refreshIssue.invalid-new-column-pairing': "This new column's foreign-key target is invalid.",
  'import.refreshIssue.duplicate-source-column-id': "This column's internal id collides with an existing one.",
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
