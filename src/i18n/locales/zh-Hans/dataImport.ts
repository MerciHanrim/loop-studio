// docs/data-import.md §DI16 / §DI17 — the CSV/TSV import wizard slice of the
// `zh-Hans` catalog. `satisfies Record<DataImportKey, string>` makes `tsc` fail
// on a missing or an extra key against `../en/dataImport`.
//
// Glossary: 导入 import · 导出 export · 表 table · 列 column · 行 row ·
// 主键 Key role · 外键 Foreign key · 名称 Label role · 数值 Number role ·
// 参数 parameter · 分组框 frame. Column ids in the example (`item_id`,
// `price`, …), file extensions, `CSV` / `TSV` / `Loop Studio` and every
// `{slot}` name stay exactly as they are.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': '数据 ▾',
  'import.title': '导入电子表格数据',
  'import.tableName': '表名称',
  'import.removeTable': '移除此表',
  'import.addTable': '添加另一个表',
  'import.pastePlaceholder': '在此粘贴 CSV 或 TSV 文本',
  'import.pasteAria': 'CSV 或 TSV 文本',
  'import.tableNameRequired': '请填写表名称后继续。',
  'import.pasteDataRequired': '请粘贴或上传 CSV/TSV 数据后继续。',
  'import.uploadFile': '上传文件…',
  'import.delimiter': '分隔符',
  'import.delimiterAuto': '自动检测',
  'import.delimiterComma': '逗号',
  'import.delimiterTab': '制表符',
  'import.headerRow': '表头行',
  'import.ignoreLastRows': '忽略末尾 N 行',
  'import.parseError': '这段文本不是有效的 CSV/TSV：第 {line} 行第 {column} 个字符{kind}。',
  'import.parseErrorKind.unterminated-quote': '有未闭合的引号',
  'import.parseErrorKind.text-after-quote': '在结束引号后紧跟了意外的文本',
  'import.parseErrorKind.quote-in-unquoted-field': '未加引号的字段中出现了引号',
  'import.role.ignored': '忽略',
  'import.role.key': '主键',
  'import.role.number': '数值',
  'import.role.label': '名称',
  'import.role.foreignKey': '外键',
  'import.roleAria': '列 {header} 的角色',
  'import.selectTable': '选择一个表…',
  'import.selectColumn': '选择一列…',
  'import.selectFrame': '选择一个分组框…',
  'import.groupBy': '分组框依据：',
  'import.warningsFound': '{n, plural, other {有 # 行的名称将显示原始主键，而不是名称列的值。}}',
  'import.parseErrorsBlockValidation': '请先修正上面的 CSV/TSV 错误再继续。',
  'import.placement.none': '放到画布上，不创建分组框',
  'import.placement.framePerTable': '每个表一个分组框',
  'import.placement.existingFrame': '加入已有的分组框',
  'import.summary': '准备导入 {tables, plural, other {# 个表}}，将创建 {parameters, plural, other {# 个参数}}。',
  'import.next': '下一步',
  'import.back': '上一步',
  'import.commit': '导入',

  // §DI17 -- the quick start block
  'import.qs.title': '快速上手',
  'import.qs.toggleAria': '快速上手——显示或隐藏',
  'import.qs.lead': '把电子表格里的数字变成可调节的参数。',
  'import.qs.body':
    '每一行都需要一列作为唯一 ID。每一列只要标记为“数值”，就会为每一行生成一个参数。把它们接入模型仍是你之后要做的事。不会上传任何内容，你的电子表格也不会被改动。',
  'import.qs.exampleHeading': '一个最小示例',
  'import.qs.mapping': 'item_id：{key} · item_name：{label} · price：{number} · drop_rate：{number}',
  'import.qs.result': '2 行 × 2 个数值列 = 4 个参数',
  'import.qs.useExample': '使用这个示例',
  'import.qs.tableLimit': '已达到 {max} 个表的上限——请先移除一个表。',
  'import.qs.download': '下载示例 CSV',
  'import.qs.fullGuide': '完整指南',
  'import.qs.fullGuideAria': '完整指南——在新标签页中打开 GitHub 页面',
  'import.qs.sources.summary': '从 Google 表格或 Excel 取出数据',
  'import.qs.sources.sheets': 'Google 表格：文件 → 下载 → 逗号分隔值 (.csv)，或选中一段区域复制。',
  'import.qs.sources.excel': 'Excel 或 Numbers：另存为／导出为 CSV，或复制一段区域。',
  'import.qs.sources.privacy':
    '不要对私有表格使用“发布到网页”——那会让任何拿到链接的人都能查看。下载或复制则不会公开表格。',
  'import.qs.notImported.summary': '哪些内容不会被导入',
  'import.qs.notImported.formulas': '公式本身不会被导入——CSV 或粘贴的内容只带有每个单元格当前的计算结果。',
  'import.qs.notImported.list': '格式、图表、合并或多值单元格、.xlsx 文件，以及实时同步。数值之间如何相互作用由你来建模。',
  'import.qs.limits': '最多 {tables} 个表，每个表最多 {columns} 个映射列、{rows} 行。',

  // §DI17 -- the shared role help (rendered ONCE per dialog; each role
  // select points at its role's line via aria-describedby)
  'import.roleHelp.title': '列的角色',
  'import.roleHelp.key': '唯一 ID，刷新时用它匹配这一行。',
  'import.roleHelp.label': '生成的参数上显示的名称。',
  'import.roleHelp.number': '为每一行创建一个可调节的参数。',
  'import.roleHelp.foreignKey': '把这个值关联到另一张已导入表中的某一行。',
  'import.roleHelp.ignored': '不把这一列带进 Loop Studio。',
  'import.linkTables.summary': '关联多个表',
  'import.linkTables.body':
    '添加第二个表，把某一列标记为外键，去引用另一张表的主键。那张表的名称随后会让生成的名字更完整。有两列或更多外键的表，必须选定由哪一个来分组。',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': '主键：{header}',
  'import.status.keyNone': '主键：尚未指定',
  'import.status.keyMany': '主键：{n} 列——请只保留一列',
  'import.status.counts':
    '{cols, plural, other {# 个数值列}} × {rows, plural, other {# 行}} → {n, plural, other {# 个参数}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp': '分组框是画布上给节点分组的带标题矩形。',
  'import.placement.noneResult': '{n, plural, other {# 个参数}}放到画布上，不创建分组框',
  'import.placement.framePerTableResult': '将创建 {n, plural, other {# 个分组框}}',
  'import.placement.noFramesYet': '此画布上还没有分组框',

  // §DI17 -- the review breakdown
  'import.review.col.table': '表',
  'import.review.col.rows': '行数',
  'import.review.col.numberColumns': '数值列',
  'import.review.col.parameters': '参数',
  'import.review.col.frames': '分组框',
  'import.review.lookupOnly': '0（仅用于查表）',
  'import.review.total': '合计',
  'import.review.labelsPreview': '名称大致会是这样：',
  'import.review.more': '{n, plural, other {…另有 # 项}}',

  // §DI17 -- inline validation errors (no separate step)
  'import.issueSummary':
    '{m, plural, other {# 个表}}中共有 {n, plural, other {# 个问题}}。请在下方修正后再次点击“下一步”。',
  'import.issueSummaryStale': '上次检查后输入有改动——请再次点击“下一步”进行检查。',
  'import.issueJump': '跳到这个单元格',

  // location composers -- prefixed to an `import.issue.*` / `import.commitError.*`
  // description below, e.g. "Table Items, row 3: <description>".
  'import.loc.table': '表 {table}',
  'import.loc.tableRow': '表 {table} 第 {row} 行',
  'import.loc.tableRowColumn': '表 {table} 第 {row} 行第 {column} 列',
  'import.loc.tableRowColumnHeader': '表 {table} 第 {row} 行第 {column} 列（{header}）',
  'import.loc.tableColumnHeader': '表 {table} 第 {column} 列（{header}）',

  // one description per `IssueCode` (dataImportValidate.ts) -- the location
  // (table/row/column) is composed separately via `import.loc.*` above, so
  // these never repeat it.
  'import.issue.table-limit-exceeded': '表太多（{count} 个，上限 {max} 个）。',
  'import.issue.column-limit-exceeded': '映射的列太多（{count} 列，上限 {max} 列）。',
  'import.issue.row-limit-exceeded': '行太多（{count} 行，上限 {max} 行）。',
  'import.issue.invalid-header-row': '表头行必须是 1 或更大的整数。',
  'import.issue.invalid-ignore-rows': '“忽略末尾 N 行”必须是 0 或更大的整数。',
  'import.issue.empty-table-name': '表名称为空。',
  'import.issue.label-too-long': '表名称过长（最多 {max} 个字符）。',
  'import.issue.empty-column-header': '这一列的表头为空。',
  'import.issue.header-too-long': '这一列的表头过长（最多 {max} 个字符）。',
  'import.issue.missing-source-column-id': '这一列缺少内部 ID——请重新选择它的角色。',
  'import.issue.duplicate-source-table-id': '这个表的内部 ID 与另一个表冲突。',
  'import.issue.missing-key-column': '没有任何一列被标记为主键。请在用于标识每一行的列（例如 ID）上选择“主键”。',
  'import.issue.multiple-key-columns': '有多列被标记为主键——请只保留一列。',
  'import.issue.empty-key': '主键为空。每一行都需要主键值。',
  'import.issue.key-too-long': '主键过长（最多 {max} 字节）。',
  'import.issue.key-control-char': '主键中包含控制字符。',
  'import.issue.duplicate-key': '主键“{value}”已被另一行使用。请给每一行一个唯一的主键。',
  'import.issue.ragged-row': '这一行有 {actual} 个单元格，应为 {expected} 个。请检查是否漏了逗号；汇总行可以用“忽略末尾 N 行”去掉。',
  'import.issue.empty-number': '这个单元格是空的。请填入数字，或把该列设为“忽略”。',
  'import.issue.invalid-number': '“{value}”不是数字。请去掉千位分隔符、货币符号和 %，例如写成 4900。',
  'import.issue.orphan-foreign-key': '目标表中没有主键为“{value}”的行。',
  'import.issue.missing-fk-target': '这个外键列还没有目标表。请在列标题下选择它引用的表。',
  'import.issue.invalid-fk-target': '这个外键的目标表已不存在。',
  'import.issue.missing-group-by': '这个表有两列或更多外键——请选定由哪一个来分组（表头行下方的“分组框依据”）。',
  'import.issue.invalid-group-by': '用于分组的列必须是这个表的外键列之一。',
  'import.issue.round-trip-mismatch': '这份数据无法安全保存——请简化后重试。',
  'import.issue.label-fallback': '这个引用没有可用的名称——将显示原始主键。',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision': '已存在内部 ID 相同的表——请重新导入一次。',
  'import.commitError.parameter-id-collision': '生成的 ID 与已有 ID 冲突——请重新导入一次。',
  'import.commitError.frame-placement-failed': '找不到放置“{table}”分组框的空间。',
  'import.commitError.frame-not-found': '所选的分组框已不存在。',
  'import.commitError.frame-insufficient-space': '“{frame}”中的空间不足。',
  'import.commitError.invalid-result-graph': '生成的图无效——请联系技术支持。',

  // docs/data-import.md §DI16 Phase 2 -- the manage-bindings dialog + the
  // 4-step refresh wizard. §DI17 reworded the menu items and added the guide entry.
  'import.menu.import': '把电子表格数值导入为参数…',
  'import.menu.manage': '刷新或管理已导入的表…',
  'import.menu.guide': '如何准备电子表格…',
  'import.refresh.manageTitle': '管理电子表格绑定',
  'import.refresh.noBindings': '还没有绑定任何电子表格。',
  'import.refresh.rowCount': '{n, plural, other {# 行}}',
  'import.refresh.renameLabel': '表名称',
  'import.refresh.refreshButton': '刷新…',
  'import.refresh.exportCsv': '导出变更建议 CSV',
  'import.refresh.exportBlockedDuplicate': '导出被阻止：同一行同一列上有多个生效的参数。请先修正重复再导出。',
  'import.refresh.title': '刷新“{table}”',
  'import.refresh.commit': '提交刷新',

  'import.refresh.columnEvents.title': '列的变化',
  'import.refresh.columnEvents.none': '没有列发生变化——所有列都自动匹配上了。',
  'import.refresh.columnEvents.missingHeader': '新数据中已经没有列“{header}”（{role}）。',
  'import.refresh.columnEvents.ambiguousMatch': '列“{header}”同时匹配到多个新列。',
  'import.refresh.columnEvents.unresolved': '— 请选择 —',
  'import.refresh.columnEvents.removedOption': '该列已删除',
  'import.refresh.columnEvents.mapMore': '映射更多列…',
  'import.refresh.columnEvents.unrecognized': '列“{header}”尚未映射。',
  'import.refresh.columnEvents.doNotMap': '不映射',
  'import.refresh.columnEvents.fkTarget': '引用的表…',

  'import.refresh.review.added': '{n, plural, other {将新增 # 行}}',
  'import.refresh.review.missing': '{n, plural, other {新数据中缺少 # 行}}',
  'import.refresh.review.changed': '{n, plural, other {# 个数值将自动更新}}',
  'import.refresh.review.conflicts': '{n, plural, other {# 个数值有冲突，需要你选择}}',
  'import.refresh.review.locallyDeleted': '{n, plural, other {# 个数值已在本地删除}}',
  'import.refresh.review.fkRepoints': '{n, plural, other {# 个外键发生了变化}}',
  'import.refresh.review.newColumnValues': '{n, plural, other {将新增 # 个新列的数值}}',
  'import.refresh.review.confirmAdd': '添加这一行',
  'import.refresh.review.missingChoiceNone': '— 请选择 —',
  'import.refresh.review.missingChoiceUnlink': '保持原样，解除与电子表格的关联',
  'import.refresh.review.missingChoiceDelete': '删除',
  'import.refresh.review.missingBlocked': '仍被 {table} 引用——请先刷新那个表。',
  'import.refresh.review.cellChoiceApplyIncoming': '使用新值（{value}）',
  'import.refresh.review.cellChoiceKeepMine': '保留我的值（{value}）',
  'import.refresh.review.locallyDeletedChoiceRecreate': '用新值重新创建（{value}）',
  'import.refresh.review.locallyDeletedChoiceDiscard': '放弃——不再跟踪这个单元格',
  'import.refresh.review.fkChoiceAccept': '接受新的引用（{value}）',
  'import.refresh.review.fkChoiceReject': '保留原来的引用（{value}）',

  'import.refresh.duplicateTripleError': '这份数据已损坏：同一行同一列上绑定了多个参数。在修正之前无法刷新。',
  'import.refresh.commitError.referenced-node': '无法删除这一行的参数——图中其他地方仍在引用它。',
  'import.refresh.commitError.missing-row-dependency': '无法解除关联或删除这一行——还有别的表在引用它。',
  'import.refresh.commitError.placement-failed': '在画布上找不到放置新参数的空间——请把视图移到别处再试。',

  // one description per REFRESH-ONLY `RefreshIssueCode` not already covered
  // by an `import.issue.*` entry above (the overlapping codes reuse those
  // verbatim — same meaning, same wording).
  'import.refreshIssue.table-not-found': '这个表绑定已不存在。',
  'import.refreshIssue.unresolved-column-event': '这项列变化需要先做出选择才能继续。',
  'import.refreshIssue.invalid-column-pairing': '这个列选择与任何待处理的列变化都不匹配。',
  'import.refreshIssue.key-column-cannot-be-removed': '行主键列不能删除——请改为把它映射到另一个传入列。',
  'import.refreshIssue.duplicate-column-pairing': '这个列选择与另一个选择冲突。',
  'import.refreshIssue.invalid-new-column-pairing': '这个新列的外键目标无效。',
  'import.refreshIssue.duplicate-source-column-id': '这一列的内部 ID 与已有的冲突。',
} satisfies Record<DataImportKey, string>

export default dataImport
