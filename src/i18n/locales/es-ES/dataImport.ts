// docs/data-import.md §DI16 / §DI17 — the CSV/TSV import wizard, `es-ES`.//
// docs/localization.md §L2.15 — `es-ES` is a REGION AUDIT over the finished
// `es-419` catalog, not a re-translation. A string differs only where a Spain
// reader would find the Latin American one wrong or unnatural; everywhere else
// the two are deliberately identical, and that is not laziness.
//
// What actually differs, in the whole catalog: `ordenador` for the device
// (4 keys), `pulsar` for pressing a key or button (4), `escribir` for typing
// into a field (2), and a NO-BREAK SPACE before the percent sign (2) because
// `Intl.NumberFormat('es-ES')` emits one and `es-419` emits none.
//
// What deliberately does NOT differ: the `usted` register (Spain uses it for
// software too, and `vosotros` would be a tone change, not a correction),
// `archivo` (entirely natural in Spain — `fichero` is not required), the
// impersonal and infinitive command forms, and the whole node-kind glossary.
//
// §L2.11 — `{column}` names two different things and this file contains both.
// `import.parseError` is a PARSER position, so it reads `carácter`;
// `import.loc.*` is a real table column and reads `columna`. The two never
// borrow each other's word. `src/i18n/parserLocation.test.ts` enforces it.
//
// §L2.13 — the spreadsheet vocabulary splits three ways, plus the imported
// data itself:
//   `archivo de hoja de cálculo`     the file the user exports
//   `hoja de cálculo` / `hoja`       the sheet itself
//   `aplicación de hojas de cálculo` Excel, Google Sheets
//   `tabla`                          the rows and columns once imported
// Collapsing them would make `nombre de la tabla` ambiguous in a dialog that
// shows all of them at once.
//
// Every plural writes an explicit `many` arm even where it matches `other`:
// `Intl.PluralRules('es-419')` has the category, so leaving it out would be a
// silent gap rather than a decision (§L2.13).

const dataImport = {
  'import.button': 'Datos ▾',
  'import.title': 'Importar datos de una hoja de cálculo',
  'import.tableName': 'Nombre de la tabla',
  'import.removeTable': 'Quitar la tabla',
  'import.addTable': 'Añadir otra tabla',
  'import.pastePlaceholder': 'Pegue aquí texto CSV o TSV',
  'import.pasteAria': 'Texto CSV o TSV',
  'import.tableNameRequired': 'Ingrese un nombre de tabla para continuar.',
  'import.pasteDataRequired': 'Pegue o cargue datos CSV/TSV para continuar.',
  'import.uploadFile': 'Cargar un archivo…',
  'import.delimiter': 'Separador',
  'import.delimiterAuto': 'Detectar automáticamente',
  'import.delimiterComma': 'Coma',
  'import.delimiterTab': 'Tabulación',
  'import.headerRow': 'Fila de encabezados',
  'import.ignoreLastRows': 'Ignorar las últimas N filas',
  'import.parseError': 'Este texto no es CSV/TSV válido: {kind} en la línea {line}, carácter {column}.',
  'import.parseErrorKind.unterminated-quote': 'una comilla sin cerrar',
  'import.parseErrorKind.text-after-quote': 'texto inesperado justo después de una comilla de cierre',
  'import.parseErrorKind.quote-in-unquoted-field': 'una comilla dentro de un campo sin comillas',
  'import.role.ignored': 'Ignorar',
  'import.role.key': 'Clave',
  'import.role.number': 'Número',
  'import.role.label': 'Etiqueta',
  'import.role.foreignKey': 'Clave externa',
  'import.roleAria': 'Rol de la columna {header}',
  'import.selectTable': 'Seleccione una tabla…',
  'import.selectColumn': 'Seleccione una columna…',
  'import.selectFrame': 'Seleccione un marco…',
  'import.groupBy': 'Agrupar el marco por:',
  'import.warningsFound': '{n, plural, one {# fila usará una clave sin procesar en lugar de un nombre en su etiqueta.} many {# filas usarán una clave sin procesar en lugar de un nombre en sus etiquetas.} other {# filas usarán una clave sin procesar en lugar de un nombre en sus etiquetas.}}',
  'import.parseErrorsBlockValidation': 'Corrija los errores de CSV/TSV de arriba antes de continuar.',
  'import.placement.none': 'Colocar en el lienzo, sin marcos',
  'import.placement.framePerTable': 'Un marco por tabla',
  'import.placement.existingFrame': 'Añadir a un marco existente',
  'import.summary': 'Todo listo para importar {tables, plural, one {# tabla} many {# tablas} other {# tablas}} y crear {parameters, plural, one {# parámetro} many {# parámetros} other {# parámetros}}.',
  'import.next': 'Siguiente',
  'import.back': 'Atrás',
  'import.commit': 'Importar',

  'import.qs.title': 'Inicio rápido',
  'import.qs.toggleAria': 'Inicio rápido: mostrar u ocultar',
  'import.qs.lead': 'Convierta los números de una hoja de cálculo en Parámetros ajustables.',
  'import.qs.body':
    'Cada fila necesita una columna con un ID único. Cada columna que marque como Número se convierte en un Parámetro por fila. Conectarlos a su modelo sigue siendo un paso suyo después. No se sube nada y su hoja de cálculo nunca se modifica.',
  'import.qs.exampleHeading': 'Un ejemplo mínimo',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 filas × 2 columnas de Número = 4 Parámetros',
  'import.qs.useExample': 'Usar este ejemplo',
  'import.qs.tableLimit': 'Se alcanzó el límite de {max} tablas: quite una tabla primero.',
  'import.qs.download': 'Descargar el CSV de ejemplo',
  'import.qs.fullGuide': 'Guía completa',
  'import.qs.fullGuideAria': 'Guía completa: se abre en GitHub en una pestaña nueva',
  'import.qs.sources.summary': 'Cómo sacar los datos de Google Sheets o Excel',
  'import.qs.sources.sheets': 'Google Sheets: Archivo → Descargar → Valores separados por comas (.csv), o seleccione un rango y cópielo.',
  'import.qs.sources.excel': 'Excel o Numbers: Guardar como / Exportar a CSV, o copie un rango.',
  'import.qs.sources.privacy':
    'No use “Publicar en la web” en una hoja privada: eso la vuelve legible para cualquiera que tenga el enlace. Descargarla o copiarla la mantiene privada.',
  'import.qs.notImported.summary': 'Qué no se importa',
  'import.qs.notImported.formulas': 'Las fórmulas en sí no se importan: un CSV o un pegado solo llevan el valor calculado actual de cada celda.',
  'import.qs.notImported.list': 'Formato, gráficos, celdas combinadas o con varios valores, archivos .xlsx y sincronización en vivo. Usted modela por su cuenta cómo interactúan los valores.',
  'import.qs.limits': 'Hasta {tables} tablas, {columns} columnas asignadas por tabla y {rows} filas por tabla.',

  'import.roleHelp.title': 'Roles de las columnas',
  'import.roleHelp.key': 'ID único que se usa para reconocer esta fila al actualizar.',
  'import.roleHelp.label': 'Nombre que se muestra en los Parámetros generados.',
  'import.roleHelp.number': 'Crea un Parámetro ajustable por cada fila.',
  'import.roleHelp.foreignKey': 'Vincula este valor con una fila de otra tabla importada.',
  'import.roleHelp.ignored': 'Deja esta columna fuera de Loop Studio.',
  'import.linkTables.summary': 'Vincular varias tablas',
  'import.linkTables.body':
    'Añada una segunda tabla y marque una columna como Clave externa para referenciar la Clave de la otra tabla. Su Etiqueta enriquece entonces los nombres generados. Una tabla con dos Claves externas debe elegir cuál agrupa los marcos.',

  'import.status.key': 'Clave: {header}',
  'import.status.keyNone': 'Clave: todavía ninguna',
  'import.status.keyMany': 'Clave: {n} columnas — elija exactamente una',
  'import.status.counts':
    '{cols, plural, one {# columna de Número} many {# columnas de Número} other {# columnas de Número}} × {rows, plural, one {# fila} many {# filas} other {# filas}} → {n, plural, one {# Parámetro} many {# Parámetros} other {# Parámetros}}',

  'import.placement.frameHelp': 'Un marco es una caja con nombre que agrupa nodos en el lienzo.',
  'import.placement.noneResult': '{n, plural, one {# Parámetro} many {# Parámetros} other {# Parámetros}} en el lienzo, sin marcos',
  'import.placement.framePerTableResult': '{n, plural, one {se creará # marco} many {se crearán # marcos} other {se crearán # marcos}}',
  'import.placement.noFramesYet': 'Todavía no hay marcos en este lienzo',

  'import.review.col.table': 'Tabla',
  'import.review.col.rows': 'Filas',
  'import.review.col.numberColumns': 'Columnas de Número',
  'import.review.col.parameters': 'Parámetros',
  'import.review.col.frames': 'Marcos',
  'import.review.lookupOnly': '0 (solo consulta)',
  'import.review.total': 'Total',
  'import.review.labelsPreview': 'Las etiquetas se verán así:',
  'import.review.more': '{n, plural, one {… y # más} many {… y # más} other {… y # más}}',

  'import.issueSummary':
    '{n, plural, one {# problema} many {# problemas} other {# problemas}} en {m, plural, one {# tabla} many {# tablas} other {# tablas}}. Corríjalos abajo y pulse Siguiente otra vez.',
  'import.issueSummaryStale': 'La entrada cambió desde la última revisión: pulse Siguiente para revisar de nuevo.',
  'import.issueJump': 'Ir a esta celda',

  'import.loc.table': 'Tabla {table}',
  'import.loc.tableRow': 'Tabla {table}, fila {row}',
  'import.loc.tableRowColumn': 'Tabla {table}, fila {row}, columna {column}',
  'import.loc.tableRowColumnHeader': 'Tabla {table}, fila {row}, columna {column} ({header})',
  'import.loc.tableColumnHeader': 'Tabla {table}, columna {column} ({header})',

  'import.issue.table-limit-exceeded': 'Demasiadas tablas ({count}, máximo {max}).',
  'import.issue.column-limit-exceeded': 'Demasiadas columnas asignadas ({count}, máximo {max}).',
  'import.issue.row-limit-exceeded': 'Demasiadas filas ({count}, máximo {max}).',
  'import.issue.invalid-header-row': 'La fila de encabezados debe ser un número entero de 1 o más.',
  'import.issue.invalid-ignore-rows': 'Ignorar las últimas N filas debe ser un número entero de 0 o más.',
  'import.issue.empty-table-name': 'El nombre de la tabla está vacío.',
  'import.issue.label-too-long': 'El nombre de la tabla es demasiado largo (máximo {max} caracteres).',
  'import.issue.empty-column-header': 'El encabezado de esta columna está vacío.',
  'import.issue.header-too-long': 'El encabezado de esta columna es demasiado largo (máximo {max} caracteres).',
  'import.issue.missing-source-column-id': 'A esta columna le falta su id interno: vuelva a elegir su rol.',
  'import.issue.duplicate-source-table-id': 'El id interno de esta tabla choca con el de otra tabla.',
  'import.issue.missing-key-column': 'Ninguna columna está marcada como Clave. Elija Clave en la columna que identifica cada fila, por ejemplo un ID.',
  'import.issue.multiple-key-columns': 'Hay más de una columna marcada como Clave: deje exactamente una.',
  'import.issue.empty-key': 'La Clave está vacía. Cada fila necesita un valor de Clave.',
  'import.issue.key-too-long': 'La Clave es demasiado larga (máximo {max} bytes).',
  'import.issue.key-control-char': 'La Clave contiene un carácter de control.',
  'import.issue.duplicate-key': 'La Clave “{value}” ya la usa otra fila. Dele a cada fila una Clave única.',
  'import.issue.ragged-row': 'Esta fila tiene {actual} celdas; se esperaban {expected}. Revise si falta una coma; las filas de resumen se pueden descartar con “Ignorar las últimas N filas”.',
  'import.issue.empty-number': 'Esta celda está vacía. Ingrese un número o ponga la columna en Ignorar.',
  'import.issue.invalid-number': '“{value}” no es un número. Quite los separadores de miles, los símbolos de moneda y el %, por ejemplo 4900.',
  'import.issue.orphan-foreign-key': 'Ninguna fila de la tabla de destino tiene la clave “{value}”.',
  'import.issue.missing-fk-target': 'Esta columna de Clave externa no tiene tabla de destino. Elija debajo del encabezado la tabla a la que se refiere.',
  'import.issue.invalid-fk-target': 'La tabla de destino de esta clave externa ya no existe.',
  'import.issue.missing-group-by': 'Esta tabla tiene dos o más columnas de Clave externa: elija cuál agrupa los marcos (“Agrupar el marco por” debajo de la fila de encabezados).',
  'import.issue.invalid-group-by': 'La columna de agrupación debe ser una de las columnas de clave externa de esta tabla.',
  'import.issue.round-trip-mismatch': 'Estos datos no se pudieron guardar de forma segura: simplifíquelos e inténtelo de nuevo.',
  'import.issue.label-fallback': 'No hay un nombre disponible para esta referencia: se mostrará la clave sin procesar.',

  'import.commitError.source-table-id-collision': 'Ya existe una tabla con el mismo id interno: vuelva a intentar la importación.',
  'import.commitError.parameter-id-collision': 'Un id generado chocó con uno existente: vuelva a intentar la importación.',
  'import.commitError.frame-placement-failed': 'No se encontró espacio para el marco de “{table}”.',
  'import.commitError.frame-not-found': 'El marco seleccionado ya no existe.',
  'import.commitError.frame-insufficient-space': 'No hay suficiente espacio libre en “{frame}”.',
  'import.commitError.invalid-result-graph': 'El grafo resultante es inválido: comuníquese con soporte.',

  'import.menu.import': 'Importar valores de una hoja de cálculo como Parámetros…',
  'import.menu.manage': 'Actualizar o administrar las tablas importadas…',
  'import.menu.guide': 'Cómo preparar una hoja de cálculo…',
  'import.refresh.manageTitle': 'Administrar los vínculos con hojas de cálculo',
  'import.refresh.noBindings': 'Todavía no hay tablas de hojas de cálculo vinculadas.',
  'import.refresh.rowCount': '{n, plural, one {# fila} many {# filas} other {# filas}}',
  'import.refresh.renameLabel': 'Nombre de la tabla',
  'import.refresh.refreshButton': 'Actualizar…',
  'import.refresh.exportCsv': 'Exportar el CSV de cambios propuestos',
  'import.refresh.exportBlockedDuplicate': 'Exportación bloqueada: la misma fila/columna tiene más de un Parámetro activo. Corrija el duplicado antes de exportar.',
  'import.refresh.title': 'Actualizar “{table}”',
  'import.refresh.commit': 'Confirmar la actualización',

  'import.refresh.columnEvents.title': 'Cambios en las columnas',
  'import.refresh.columnEvents.none': 'Sin cambios en las columnas: todas coincidieron automáticamente.',
  'import.refresh.columnEvents.missingHeader': 'La columna “{header}” ({role}) ya no está en los datos nuevos.',
  'import.refresh.columnEvents.ambiguousMatch': 'La columna “{header}” coincide con más de una columna entrante.',
  'import.refresh.columnEvents.unresolved': '— elija una —',
  'import.refresh.columnEvents.removedOption': 'Columna eliminada',
  'import.refresh.columnEvents.mapMore': 'Asignar más columnas…',
  'import.refresh.columnEvents.unrecognized': 'La columna “{header}” no está asignada.',
  'import.refresh.columnEvents.doNotMap': 'No asignar',
  'import.refresh.columnEvents.fkTarget': 'Referencia a la tabla…',

  'import.refresh.review.added': '{n, plural, one {se añadirá # fila} many {se añadirán # filas} other {se añadirán # filas}}',
  'import.refresh.review.missing': '{n, plural, one {falta # fila en los datos nuevos} many {faltan # filas en los datos nuevos} other {faltan # filas en los datos nuevos}}',
  'import.refresh.review.changed': '{n, plural, one {# valor se actualizará automáticamente} many {# valores se actualizarán automáticamente} other {# valores se actualizarán automáticamente}}',
  'import.refresh.review.conflicts': '{n, plural, one {# valor está en conflicto y necesita una decisión} many {# valores están en conflicto y necesitan una decisión} other {# valores están en conflicto y necesitan una decisión}}',
  'import.refresh.review.locallyDeleted': '{n, plural, one {# valor se eliminó localmente} many {# valores se eliminaron localmente} other {# valores se eliminaron localmente}}',
  'import.refresh.review.fkRepoints': '{n, plural, one {# clave externa cambió} many {# claves externas cambiaron} other {# claves externas cambiaron}}',
  'import.refresh.review.newColumnValues': '{n, plural, one {se añadirá # valor de columna nuevo} many {se añadirán # valores de columna nuevos} other {se añadirán # valores de columna nuevos}}',
  'import.refresh.review.confirmAdd': 'Añadir esta fila',
  'import.refresh.review.missingChoiceNone': '— elija —',
  'import.refresh.review.missingChoiceUnlink': 'Dejar como está, desvincular de la hoja de cálculo',
  'import.refresh.review.missingChoiceDelete': 'Eliminar',
  'import.refresh.review.missingBlocked': '{table} todavía la referencia: actualice esa tabla primero.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Usar el valor nuevo ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Conservar mi valor ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Volver a crear con el valor nuevo ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Descartar: dejar de seguir esta celda',
  'import.refresh.review.fkChoiceAccept': 'Aceptar la referencia nueva ({value})',
  'import.refresh.review.fkChoiceReject': 'Conservar la referencia anterior ({value})',

  'import.refresh.duplicateTripleError': 'Estos datos están dañados: hay más de un Parámetro vinculado a la misma fila y columna. La actualización queda bloqueada hasta que se corrija.',
  'import.refresh.commitError.referenced-node': 'No se puede eliminar el Parámetro de esta fila: todavía está referenciado en otra parte del grafo.',
  'import.refresh.commitError.missing-row-dependency': 'No se puede desvincular ni eliminar esta fila: otra tabla todavía la referencia.',
  'import.refresh.commitError.placement-failed': 'No se encontró espacio en el lienzo para los Parámetros nuevos: inténtelo otra vez desde otra posición de la vista.',

  'import.refreshIssue.table-not-found': 'Este vínculo de tabla ya no existe.',
  'import.refreshIssue.unresolved-column-event': 'Este cambio de columna necesita una decisión antes de continuar.',
  'import.refreshIssue.invalid-column-pairing': 'Esta elección de columna no corresponde a ningún cambio de columna pendiente.',
  'import.refreshIssue.key-column-cannot-be-removed': 'La columna de clave de fila no se puede quitar: renómbrela a otra columna entrante en su lugar.',
  'import.refreshIssue.duplicate-column-pairing': 'Esta elección de columna entra en conflicto con otra.',
  'import.refreshIssue.invalid-new-column-pairing': 'El destino de clave externa de esta columna nueva es inválido.',
  'import.refreshIssue.duplicate-source-column-id': 'El id interno de esta columna choca con uno existente.',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
