// docs/data-import.md §DI16/§DI17 — the CSV/TSV import wizard, `pt-PT`.
//
// `folha de cálculo` is the European word for a spreadsheet (`planilha` is
// Brazilian). `tabela` / `linha` / `coluna` throughout.
//
// docs/localization.md §L2.11 — `{column}` names TWO things and Portuguese
// splits them: `import.parseError` is a PARSER position, so it reads
// `carácter`; `import.loc.*` is a real table column and reads `coluna`. The
// two never borrow each other's word (`parserLocation.test.ts`). European
// `carácter` — never the Brazilian `caractere`. The guard forces the European
// form on the seven PARSER-location keys only: `carácter` in its ordinary
// sense elsewhere is not banned, and `caracteres` is the plural in both.
//
// Every plural writes an explicit `many` arm: `Intl.PluralRules('pt-PT')` has
// `one` / `other` / `many`, `many` is reachable at 1e6, and Portuguese puts
// `de` before the noun there (`1 000 000 de linhas`).
//
// MEASURED, and the one real behavioural split from `pt-BR`: `pt-PT` selects
// `other` at ZERO where `pt-BR` selects `one` — "0 linhas", not "0 linha".
// The arms themselves are the same shape; only the selection differs, so no
// key gains or loses an arm.
//
// A group frame is a `quadro`, the canvas is the `tela` (see `./canvas.ts`).
// `Gold / Energy / XP / Player / Item` and the sample headers
// `item_id / item_name / price / drop_rate` are DATA the user sees in their own
// file, not prose, so they stay verbatim (key-scoped in `ptBrCopy.test.ts`).

const dataImport = {
  'import.button': 'Dados ▾',
  'import.title': 'Importar dados de folha de cálculo',
  'import.tableName': 'Nome da tabela',
  'import.removeTable': 'Remover tabela',
  'import.addTable': 'Adicionar outra tabela',
  'import.pastePlaceholder': 'Cole aqui o texto CSV ou TSV',
  'import.pasteAria': 'Texto CSV ou TSV',
  'import.tableNameRequired': 'Digite um nome de tabela para continuar.',
  'import.pasteDataRequired': 'Cole ou envie dados CSV/TSV para continuar.',
  'import.uploadFile': 'Enviar ficheiro…',
  'import.delimiter': 'Delimitador',
  'import.delimiterAuto': 'Detetar automaticamente',
  'import.delimiterComma': 'Vírgula',
  'import.delimiterTab': 'Tabulação',
  'import.headerRow': 'Linha de cabeçalho',
  'import.ignoreLastRows': 'Ignorar as últimas N linhas',
  'import.parseError': 'Este texto não é um CSV/TSV válido: {kind} na linha {line}, carácter {column}.',
  'import.parseErrorKind.unterminated-quote': 'uma aspa não fechada',
  'import.parseErrorKind.text-after-quote': 'texto inesperado logo após uma aspa de fechamento',
  'import.parseErrorKind.quote-in-unquoted-field': 'uma aspa dentro de um campo sem aspas',
  'import.role.ignored': 'Ignorar',
  'import.role.key': 'Chave',
  'import.role.number': 'Número',
  'import.role.label': 'Rótulo',
  'import.role.foreignKey': 'Chave estrangeira',
  'import.roleAria': 'Papel da coluna {header}',
  'import.selectTable': 'Selecione uma tabela…',
  'import.selectColumn': 'Selecione uma coluna…',
  'import.selectFrame': 'Selecione um quadro…',
  'import.groupBy': 'Agrupar o quadro por:',
  'import.warningsFound': '{n, plural, one {# linha usará uma chave bruta em vez de um nome no rótulo.} many {# de linhas usarão uma chave bruta em vez de um nome nos rótulos.} other {# linhas usarão uma chave bruta em vez de um nome nos rótulos.}}',
  'import.parseErrorsBlockValidation': 'Corrija os erros de CSV/TSV acima antes de continuar.',
  'import.placement.none': 'Colocar na tela, sem quadros',
  'import.placement.framePerTable': 'Um quadro por tabela',
  'import.placement.existingFrame': 'Adicionar a um quadro existente',
  'import.summary': 'Tudo pronto para importar {tables, plural, one {# tabela} many {# de tabelas} other {# tabelas}}, criando {parameters, plural, one {# parâmetro} many {# de parâmetros} other {# parâmetros}}.',
  'import.next': 'Avançar',
  'import.back': 'Voltar',
  'import.commit': 'Importar',

  'import.qs.title': 'Início rápido',
  'import.qs.toggleAria': 'Início rápido — mostrar ou ocultar',
  'import.qs.lead': 'Transforme os números de uma folha de cálculo em Parâmetros ajustáveis.',
  'import.qs.body':
    'Cada linha precisa de uma coluna com um ID único. Cada coluna marcada como Número dá origem a um Parâmetro por linha. Ligá-los ao modelo continua a ser um passo à parte. Nada é enviado para nenhum servidor, e a sua folha de cálculo nunca é alterada.',
  'import.qs.exampleHeading': 'Um exemplo mínimo',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 linhas × 2 colunas de Número = 4 Parâmetros',
  'import.qs.useExample': 'Usar este exemplo',
  'import.qs.tableLimit': 'O limite de {max} tabelas foi atingido — remova uma tabela primeiro.',
  'import.qs.download': 'Transferir CSV de exemplo',
  'import.qs.fullGuide': 'Guia completo',
  'import.qs.fullGuideAria': 'Guia completo — abre no GitHub num novo separador',
  'import.qs.sources.summary': 'Como tirar os dados do Folhas de cálculo Google ou do Excel',
  'import.qs.sources.sheets': 'Folhas de cálculo Google: Ficheiro → Transferir → Valores separados por vírgulas (.csv), ou selecione um intervalo e copie.',
  'import.qs.sources.excel': 'Excel ou Numbers: Guardar como / Exportar para CSV, ou copie um intervalo.',
  'import.qs.sources.privacy':
    'Não use “Publicar na web” numa folha de cálculo privada — isso deixa a folha de cálculo visível para qualquer pessoa com o link. Transferir ou copiar mantém tudo privado.',
  'import.qs.notImported.summary': 'O que não é importado',
  'import.qs.notImported.formulas': 'As fórmulas em si não são importadas — um CSV ou uma colagem levam apenas o valor calculado atual de cada célula.',
  'import.qs.notImported.list': 'Formatação, gráficos, células mescladas ou com vários valores, ficheiros .xlsx e sincronização ao vivo. Modelar a forma como os valores interagem fica a seu cargo.',
  'import.qs.limits': 'Até {tables} tabelas, {columns} colunas mapeadas por tabela e {rows} linhas por tabela.',

  'import.roleHelp.title': 'Papéis das colunas',
  'import.roleHelp.key': 'ID único usado para identificar esta linha na atualização.',
  'import.roleHelp.label': 'Nome exibido nos Parâmetros gerados.',
  'import.roleHelp.number': 'Cria um Parâmetro ajustável para cada linha.',
  'import.roleHelp.foreignKey': 'Liga este valor a uma linha de outra tabela importada.',
  'import.roleHelp.ignored': 'Deixa esta coluna de fora do Loop Studio.',
  'import.linkTables.summary': 'Ligar várias tabelas',
  'import.linkTables.body':
    'Adicione uma segunda tabela e marque uma coluna como Chave estrangeira para referenciar a Chave da outra tabela. O Rótulo dela enriquece os nomes gerados. Uma tabela com duas Chaves estrangeiras precisa escolher qual delas agrupa os quadros.',

  'import.status.key': 'Chave: {header}',
  'import.status.keyNone': 'Chave: ainda nenhuma',
  'import.status.keyMany': 'Chave: {n} colunas — escolha exatamente uma',
  'import.status.counts':
    '{cols, plural, one {# coluna de Número} many {# de colunas de Número} other {# colunas de Número}} × {rows, plural, one {# linha} many {# de linhas} other {# linhas}} → {n, plural, one {# Parâmetro} many {# de Parâmetros} other {# Parâmetros}}',

  'import.placement.frameHelp': 'Um quadro é uma caixa com nome que agrupa nós na tela.',
  'import.placement.noneResult': '{n, plural, one {# Parâmetro} many {# de Parâmetros} other {# Parâmetros}} na tela, sem quadros',
  'import.placement.framePerTableResult': '{n, plural, one {# quadro será criado} many {# de quadros serão criados} other {# quadros serão criados}}',
  'import.placement.noFramesYet': 'Ainda não há quadros nesta tela',

  'import.review.col.table': 'Tabela',
  'import.review.col.rows': 'Linhas',
  'import.review.col.numberColumns': 'Colunas de Número',
  'import.review.col.parameters': 'Parâmetros',
  'import.review.col.frames': 'Quadros',
  'import.review.lookupOnly': '0 (somente consulta)',
  'import.review.total': 'Total',
  'import.review.labelsPreview': 'Os rótulos ficarão assim:',
  'import.review.more': '{n, plural, one {… e mais #} many {… e mais #} other {… e mais #}}',

  'import.issueSummary':
    '{n, plural, one {# problema} many {# de problemas} other {# problemas}} em {m, plural, one {# tabela} many {# de tabelas} other {# tabelas}}. Corrija-os abaixo e prima Avançar novamente.',
  'import.issueSummaryStale': 'A entrada mudou desde a última verificação — prima Avançar para verificar de novo.',
  'import.issueJump': 'Ir para esta célula',

  'import.loc.table': 'Tabela {table}',
  'import.loc.tableRow': 'Tabela {table}, linha {row}',
  'import.loc.tableRowColumn': 'Tabela {table}, linha {row}, coluna {column}',
  'import.loc.tableRowColumnHeader': 'Tabela {table}, linha {row}, coluna {column} ({header})',
  'import.loc.tableColumnHeader': 'Tabela {table}, coluna {column} ({header})',

  'import.issue.table-limit-exceeded': 'Tabelas demais ({count}, máximo {max}).',
  'import.issue.column-limit-exceeded': 'Colunas mapeadas demais ({count}, máximo {max}).',
  'import.issue.row-limit-exceeded': 'Linhas demais ({count}, máximo {max}).',
  'import.issue.invalid-header-row': 'A linha de cabeçalho precisa ser um número inteiro igual ou maior que 1.',
  'import.issue.invalid-ignore-rows': 'Ignorar as últimas N linhas precisa ser um número inteiro igual ou maior que 0.',
  'import.issue.empty-table-name': 'O nome da tabela está vazio.',
  'import.issue.label-too-long': 'O nome da tabela é longo demais (máximo {max} caracteres).',
  'import.issue.empty-column-header': 'O cabeçalho desta coluna está vazio.',
  'import.issue.header-too-long': 'O cabeçalho desta coluna é longo demais (máximo {max} caracteres).',
  'import.issue.missing-source-column-id': 'Falta o id interno desta coluna — selecione o papel dela de novo.',
  'import.issue.duplicate-source-table-id': 'O id interno desta tabela conflita com o de outra tabela.',
  'import.issue.missing-key-column': 'Nenhuma coluna está marcada como Chave. Escolha Chave na coluna que identifica cada linha, como um ID.',
  'import.issue.multiple-key-columns': 'Mais de uma coluna está marcada como Chave — mantenha exatamente uma.',
  'import.issue.empty-key': 'A Chave está vazia. Toda linha precisa de um valor de Chave.',
  'import.issue.key-too-long': 'A Chave é longa demais (máximo {max} bytes).',
  'import.issue.key-control-char': 'A Chave contém um carácter de controlo.',
  'import.issue.duplicate-key': 'A Chave "{value}" já é usada por outra linha. Dê uma Chave única a cada linha.',
  'import.issue.ragged-row': 'Esta linha tem {actual} células; eram esperadas {expected}. Verifique se falta uma vírgula; linhas de totais podem ser descartadas com “Ignorar as últimas N linhas”.',
  'import.issue.empty-number': 'Esta célula está vazia. Digite um número ou defina a coluna como Ignorar.',
  'import.issue.invalid-number': '"{value}" não é um número. Remova separadores de milhar, símbolos de moeda e %, por exemplo 4900.',
  'import.issue.orphan-foreign-key': 'Nenhuma linha da tabela de destino tem a chave "{value}".',
  'import.issue.missing-fk-target': 'Esta coluna de Chave estrangeira não tem tabela de destino. Escolha a tabela a que ela se refere sob o cabeçalho da coluna.',
  'import.issue.invalid-fk-target': 'A tabela de destino desta chave estrangeira não existe mais.',
  'import.issue.missing-group-by': 'Esta tabela tem duas ou mais colunas de Chave estrangeira — escolha qual delas agrupa os quadros (“Agrupar o quadro por” sob a linha de cabeçalho).',
  'import.issue.invalid-group-by': 'A coluna de agrupamento precisa ser uma das colunas de chave estrangeira desta tabela.',
  'import.issue.round-trip-mismatch': 'Não foi possível armazenar estes dados com segurança — simplifique-os e tente de novo.',
  'import.issue.label-fallback': 'Não há nome disponível para esta referência — a chave bruta será exibida no lugar.',

  'import.commitError.source-table-id-collision': 'Já existe uma tabela com o mesmo id interno — refaça a importação.',
  'import.commitError.parameter-id-collision': 'Um id gerado conflitou com um id existente — refaça a importação.',
  'import.commitError.frame-placement-failed': 'Não foi possível encontrar espaço para o quadro de "{table}".',
  'import.commitError.frame-not-found': 'O quadro selecionado não existe mais.',
  'import.commitError.frame-insufficient-space': 'Não há espaço livre suficiente em "{frame}".',
  'import.commitError.invalid-result-graph': 'O grafo resultante é inválido — entre em contacto com o suporte.',

  'import.menu.import': 'Importar valores de folha de cálculo como Parâmetros…',
  'import.menu.manage': 'Atualizar ou gerir tabelas importadas…',
  'import.menu.guide': 'Como preparar uma folha de cálculo…',
  'import.refresh.manageTitle': 'Gerir vínculos de folha de cálculo',
  'import.refresh.noBindings': 'Nenhuma tabela de folha de cálculo está vinculada ainda.',
  'import.refresh.rowCount': '{n, plural, one {# linha} many {# de linhas} other {# linhas}}',
  'import.refresh.renameLabel': 'Nome da tabela',
  'import.refresh.refreshButton': 'Atualizar…',
  'import.refresh.exportCsv': 'Exportar CSV de proposta de mudanças',
  'import.refresh.exportBlockedDuplicate': 'Exportação bloqueada: a mesma linha/coluna tem mais de um Parâmetro ativo. Corrija a duplicidade antes de exportar.',
  'import.refresh.title': 'Atualizar "{table}"',
  'import.refresh.commit': 'Confirmar a atualização',

  'import.refresh.columnEvents.title': 'Mudanças de coluna',
  'import.refresh.columnEvents.none': 'Nenhuma mudança de coluna — todas as colunas foram associadas automaticamente.',
  'import.refresh.columnEvents.missingHeader': 'A coluna "{header}" ({role}) não está mais nos novos dados.',
  'import.refresh.columnEvents.ambiguousMatch': 'A coluna "{header}" corresponde a mais de uma coluna recebida.',
  'import.refresh.columnEvents.unresolved': '— escolha uma —',
  'import.refresh.columnEvents.removedOption': 'Coluna removida',
  'import.refresh.columnEvents.mapMore': 'Mapear mais colunas…',
  'import.refresh.columnEvents.unrecognized': 'A coluna "{header}" não está mapeada.',
  'import.refresh.columnEvents.doNotMap': 'Não mapear',
  'import.refresh.columnEvents.fkTarget': 'Referencia a tabela…',

  'import.refresh.review.added': '{n, plural, one {# linha será adicionada} many {# de linhas serão adicionadas} other {# linhas serão adicionadas}}',
  'import.refresh.review.missing': '{n, plural, one {falta # linha nos novos dados} many {faltam # de linhas nos novos dados} other {faltam # linhas nos novos dados}}',
  'import.refresh.review.changed': '{n, plural, one {# valor será atualizado automaticamente} many {# de valores serão atualizados automaticamente} other {# valores serão atualizados automaticamente}}',
  'import.refresh.review.conflicts': '{n, plural, one {# valor está em conflito e precisa de uma escolha} many {# de valores estão em conflito e precisam de uma escolha} other {# valores estão em conflito e precisam de uma escolha}}',
  'import.refresh.review.locallyDeleted': '{n, plural, one {# valor foi removido localmente} many {# de valores foram removidos localmente} other {# valores foram removidos localmente}}',
  'import.refresh.review.fkRepoints': '{n, plural, one {# chave estrangeira mudou} many {# de chaves estrangeiras mudaram} other {# chaves estrangeiras mudaram}}',
  'import.refresh.review.newColumnValues': '{n, plural, one {# novo valor de coluna será adicionado} many {# de novos valores de coluna serão adicionados} other {# novos valores de coluna serão adicionados}}',
  'import.refresh.review.confirmAdd': 'Adicionar esta linha',
  'import.refresh.review.missingChoiceNone': '— escolha —',
  'import.refresh.review.missingChoiceUnlink': 'Manter como está, desvincular da folha de cálculo',
  'import.refresh.review.missingChoiceDelete': 'Eliminar',
  'import.refresh.review.missingBlocked': 'Ainda é referenciada por {table} — atualize aquela tabela primeiro.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Usar o novo valor ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Manter o meu valor ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Recriar com o novo valor ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Descartar — parar de acompanhar esta célula',
  'import.refresh.review.fkChoiceAccept': 'Aceitar a nova referência ({value})',
  'import.refresh.review.fkChoiceReject': 'Manter a referência antiga ({value})',

  'import.refresh.duplicateTripleError': 'Estes dados estão corrompidos: mais de um Parâmetro está vinculado à mesma linha e coluna. A atualização fica bloqueada até que isso seja corrigido.',
  'import.refresh.commitError.referenced-node': 'Não é possível eliminar o Parâmetro desta linha — ele ainda é referenciado em outro ponto do grafo.',
  'import.refresh.commitError.missing-row-dependency': 'Não é possível desvincular nem eliminar esta linha — outra tabela ainda a referencia.',
  'import.refresh.commitError.placement-failed': 'Não foi possível encontrar espaço na tela para o(s) novo(s) Parâmetro(s) — tente de novo a partir de outra posição da visualização.',

  'import.refreshIssue.table-not-found': 'Este vínculo de tabela não existe mais.',
  'import.refreshIssue.unresolved-column-event': 'Esta mudança de coluna precisa de uma escolha antes de continuar.',
  'import.refreshIssue.invalid-column-pairing': 'Esta escolha de coluna não corresponde a nenhuma mudança de coluna pendente.',
  'import.refreshIssue.key-column-cannot-be-removed': 'A coluna da chave de linha não pode ser removida — renomeie-a para outra coluna recebida.',
  'import.refreshIssue.duplicate-column-pairing': 'Esta escolha de coluna conflita com outra.',
  'import.refreshIssue.invalid-new-column-pairing': 'O destino de chave estrangeira desta nova coluna é inválido.',
  'import.refreshIssue.duplicate-source-column-id': 'O id interno desta coluna conflita com um id existente.',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
