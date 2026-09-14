// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard's own key
// group, mirroring `templates.ts`'s `modules.*` split-by-feature convention.

const dataImport = {
  'import.button': 'Spreadsheet data ▾',
  'import.title': 'Import spreadsheet data',
  'import.tableName': 'Table name',
  'import.removeTable': 'Remove table',
  'import.addTable': 'Add another table',
  'import.pastePlaceholder': 'Paste CSV or TSV text here',
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
  'import.selectTable': 'Select a table…',
  'import.selectColumn': 'Select a column…',
  'import.selectFrame': 'Select a frame…',
  'import.groupBy': 'Group frame by:',
  'import.errorsFound': '{n, plural, one {# problem must be fixed before continuing:} other {# problems must be fixed before continuing:}}',
  'import.warningsFound': '{n, plural, one {# row will use a raw key instead of a name in its label.} other {# rows will use a raw key instead of a name in their labels.}}',
  'import.parseErrorsBlockValidation': 'Fix the CSV/TSV errors above before continuing.',
  'import.placement.none': 'Place on the canvas, no frames',
  'import.placement.framePerTable': 'One frame per table',
  'import.placement.existingFrame': 'Add to an existing frame',
  'import.summary': 'Ready to import {tables, plural, one {# table} other {# tables}}, creating {parameters, plural, one {# parameter} other {# parameters}}.',
  'import.next': 'Next',
  'import.back': 'Back',
  'import.commit': 'Import',

  // location composers -- prefixed to an `import.issue.*` / `import.commitError.*`
  // description below, e.g. "Table Items, row 3: <description>".
  'import.loc.table': 'Table {table}',
  'import.loc.tableRow': 'Table {table}, row {row}',
  'import.loc.tableRowColumn': 'Table {table}, row {row}, column {column}',

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
  'import.issue.missing-key-column': 'No column is marked as the row key.',
  'import.issue.multiple-key-columns': 'More than one column is marked as the row key.',
  'import.issue.empty-key': "This row's key is empty.",
  'import.issue.key-too-long': "This row's key is too long (maximum {max} bytes).",
  'import.issue.key-control-char': "This row's key contains a control character.",
  'import.issue.duplicate-key': 'This key is already used by another row in this table.',
  'import.issue.ragged-row': 'This row has {actual} cells; expected {expected}.',
  'import.issue.empty-number': 'This cell is empty — a number is required.',
  'import.issue.invalid-number': 'This cell is not a valid number.',
  'import.issue.orphan-foreign-key': 'No row in the target table has the key "{value}".',
  'import.issue.missing-fk-target': 'No target table is selected for this foreign key column.',
  'import.issue.invalid-fk-target': 'The target table for this foreign key no longer exists.',
  'import.issue.missing-group-by': 'Pick which foreign key groups the frames for this table.',
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
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
