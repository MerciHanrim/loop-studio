// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard's own key
// group, mirroring `templates.ts`'s `modules.*` split-by-feature convention.

const dataImport = {
  'import.button': 'Import data ▾',
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
  'import.placement.none': 'Place on the canvas, no frames',
  'import.placement.framePerTable': 'One frame per table',
  'import.placement.existingFrame': 'Add to an existing frame',
  'import.summary': 'Ready to import {tables, plural, one {# table} other {# tables}}, creating {parameters, plural, one {# parameter} other {# parameters}}.',
  'import.next': 'Next',
  'import.back': 'Back',
  'import.commit': 'Import',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
