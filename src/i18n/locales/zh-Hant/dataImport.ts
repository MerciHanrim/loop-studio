// docs/data-import.md §DI16 / §DI17 — the CSV/TSV import-wizard slice of the
// `zh-Hant` catalog. `satisfies Record<DataImportKey, string>` makes `tsc`
// fail on a missing or an extra key against `../en/dataImport`.
//
// Glossary (Taiwan convention, §L2.4): 試算表 spreadsheet · 匯入／匯出
// import/export · 表格 table · **欄 column** · **列 row** · 儲存格 cell ·
// 主鍵 Key role · 外鍵 Foreign key · 名稱 Label role · 數值 Number role ·
// 對應 mapping · 參數 parameter · 群組框 frame.
//
// NOTE the row/column pair is the OPPOSITE of Simplified Chinese: Traditional
// (and Excel zh-TW) uses 列 for a ROW and 欄 for a COLUMN, where Simplified
// uses 行 and 列. This catalog was written from the English source for exactly
// that reason — a mechanical conversion of `zh-Hans` would invert both.
// 行 is used only for a LINE of raw text in the parse error, never for a data
// row. Column ids in the example (`item_id`, `price`, …), file extensions,
// `CSV` / `TSV` / `Loop Studio` and every `{slot}` name stay as they are.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': '資料 ▾',
  'import.title': '匯入試算表資料',
  'import.tableName': '表格名稱',
  'import.removeTable': '移除這個表格',
  'import.addTable': '再加入一個表格',
  'import.pastePlaceholder': '在這裡貼上 CSV 或 TSV 文字',
  'import.pasteAria': 'CSV 或 TSV 文字',
  'import.tableNameRequired': '請填寫表格名稱後再繼續。',
  'import.pasteDataRequired': '請貼上或上傳 CSV/TSV 資料後再繼續。',
  'import.uploadFile': '上傳檔案…',
  'import.delimiter': '分隔符號',
  'import.delimiterAuto': '自動偵測',
  'import.delimiterComma': '逗號',
  'import.delimiterTab': '定位字元',
  'import.headerRow': '標題列',
  'import.ignoreLastRows': '忽略最後 N 列',
  'import.parseError': '這段文字不是有效的 CSV/TSV：第 {line} 行第 {column} 個字元{kind}。',
  'import.parseErrorKind.unterminated-quote': '有未結束的引號',
  'import.parseErrorKind.text-after-quote': '在結束引號後緊接著出現非預期的文字',
  'import.parseErrorKind.quote-in-unquoted-field': '未加引號的欄位中出現引號',
  'import.role.ignored': '忽略',
  'import.role.key': '主鍵',
  'import.role.number': '數值',
  'import.role.label': '名稱',
  'import.role.foreignKey': '外鍵',
  'import.roleAria': '{header} 欄的角色',
  'import.selectTable': '選擇一個表格…',
  'import.selectColumn': '選擇一欄…',
  'import.selectFrame': '選擇一個群組框…',
  'import.groupBy': '群組框依據：',
  'import.warningsFound': '{n, plural, other {有 # 列的名稱會顯示原始主鍵，而不是名稱欄的值。}}',
  'import.parseErrorsBlockValidation': '請先修正上面的 CSV/TSV 錯誤再繼續。',
  'import.placement.none': '放到畫布上，不建立群組框',
  'import.placement.framePerTable': '每個表格一個群組框',
  'import.placement.existingFrame': '加入已有的群組框',
  'import.summary': '準備匯入 {tables, plural, other {# 個表格}}，將建立 {parameters, plural, other {# 個參數}}。',
  'import.next': '下一步',
  'import.back': '上一步',
  'import.commit': '匯入',

  // §DI17 -- the quick start block
  'import.qs.title': '快速上手',
  'import.qs.toggleAria': '快速上手——顯示或隱藏',
  'import.qs.lead': '把試算表裡的數字變成可調整的參數。',
  'import.qs.body':
    '每一列都需要一欄作為唯一 ID。每一欄只要標記為「數值」，就會為每一列產生一個參數。把它們接進模型仍是你之後要做的事。不會上傳任何內容，你的試算表也不會被更動。',
  'import.qs.exampleHeading': '一個最小的範例',
  'import.qs.mapping': 'item_id：{key} · item_name：{label} · price：{number} · drop_rate：{number}',
  'import.qs.result': '2 列 × 2 個數值欄 = 4 個參數',
  'import.qs.useExample': '使用這個範例',
  'import.qs.tableLimit': '已達到 {max} 個表格的上限——請先移除一個表格。',
  'import.qs.download': '下載範例 CSV',
  'import.qs.fullGuide': '完整指南',
  'import.qs.fullGuideAria': '完整指南——在新分頁中開啟 GitHub 頁面',
  'import.qs.sources.summary': '從 Google 試算表或 Excel 取出資料',
  'import.qs.sources.sheets':
    'Google 試算表：檔案 → 下載 → 逗號分隔值 (.csv)，或選取一段範圍複製。',
  'import.qs.sources.excel': 'Excel 或 Numbers：另存新檔／匯出為 CSV，或複製一段範圍。',
  'import.qs.sources.privacy':
    '不要對私人試算表使用「發布到網路」——那會讓任何拿到連結的人都能讀取。下載或複製則不會公開試算表。',
  'import.qs.notImported.summary': '哪些內容不會匯入',
  'import.qs.notImported.formulas':
    '公式本身不會匯入——CSV 或貼上的內容只帶有每個儲存格當下算出的值。',
  'import.qs.notImported.list':
    '格式、圖表、合併或多值儲存格、.xlsx 檔案，以及即時同步。這些數值之間如何互相影響，由你自己建模。',
  'import.qs.limits': '最多 {tables} 個表格，每個表格最多 {columns} 個對應欄、{rows} 列。',

  // §DI17 -- the shared role help
  'import.roleHelp.title': '欄的角色',
  'import.roleHelp.key': '唯一 ID，重新整理時用它比對這一列。',
  'import.roleHelp.label': '產生的參數上顯示的名稱。',
  'import.roleHelp.number': '為每一列建立一個可調整的參數。',
  'import.roleHelp.foreignKey': '把這個值連到另一個已匯入表格中的某一列。',
  'import.roleHelp.ignored': '不要把這一欄帶進 Loop Studio。',
  'import.linkTables.summary': '連結多個表格',
  'import.linkTables.body':
    '再加入一個表格，把某一欄標記為外鍵，去引用另一個表格的主鍵。那個表格的名稱接著會讓產生的名字更完整。有兩欄以上外鍵的表格，必須指定由哪一欄來分組。',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': '主鍵：{header}',
  'import.status.keyNone': '主鍵：尚未指定',
  'import.status.keyMany': '主鍵：{n} 欄——請只保留一欄',
  'import.status.counts':
    '{cols, plural, other {# 個數值欄}} × {rows, plural, other {# 列}} → {n, plural, other {# 個參數}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp': '群組框是畫布上把節點圈在一起、帶有標題的方框。',
  'import.placement.noneResult': '{n, plural, other {# 個參數}}放到畫布上，不建立群組框',
  'import.placement.framePerTableResult': '將建立 {n, plural, other {# 個群組框}}',
  'import.placement.noFramesYet': '這張畫布上還沒有群組框',

  // §DI17 -- the review breakdown
  'import.review.col.table': '表格',
  'import.review.col.rows': '列數',
  'import.review.col.numberColumns': '數值欄',
  'import.review.col.parameters': '參數',
  'import.review.col.frames': '群組框',
  'import.review.lookupOnly': '0（僅供查表）',
  'import.review.total': '合計',
  'import.review.labelsPreview': '名稱大致會像這樣：',
  'import.review.more': '{n, plural, other {…另有 # 項}}',

  // §DI17 -- inline validation errors
  'import.issueSummary':
    '{m, plural, other {# 個表格}}中共有 {n, plural, other {# 個問題}}。請在下方修正後再按一次「下一步」。',
  'import.issueSummaryStale': '上次檢查之後輸入有變動——請再按一次「下一步」重新檢查。',
  'import.issueJump': '跳到這個儲存格',

  // location composers
  'import.loc.table': '表格 {table}',
  'import.loc.tableRow': '表格 {table} 第 {row} 列',
  'import.loc.tableRowColumn': '表格 {table} 第 {row} 列第 {column} 欄',
  'import.loc.tableRowColumnHeader': '表格 {table} 第 {row} 列第 {column} 欄（{header}）',
  'import.loc.tableColumnHeader': '表格 {table} 第 {column} 欄（{header}）',

  // one description per `IssueCode` (dataImportValidate.ts)
  'import.issue.table-limit-exceeded': '表格太多（{count} 個，上限 {max} 個）。',
  'import.issue.column-limit-exceeded': '對應的欄太多（{count} 欄，上限 {max} 欄）。',
  'import.issue.row-limit-exceeded': '列太多（{count} 列，上限 {max} 列）。',
  'import.issue.invalid-header-row': '標題列必須是 1 或更大的整數。',
  'import.issue.invalid-ignore-rows': '「忽略最後 N 列」必須是 0 或更大的整數。',
  'import.issue.empty-table-name': '表格名稱是空的。',
  'import.issue.label-too-long': '表格名稱太長（最多 {max} 個字元）。',
  'import.issue.empty-column-header': '這一欄的標題是空的。',
  'import.issue.header-too-long': '這一欄的標題太長（最多 {max} 個字元）。',
  'import.issue.missing-source-column-id': '這一欄缺少內部 ID——請重新選擇它的角色。',
  'import.issue.duplicate-source-table-id': '這個表格的內部 ID 與另一個表格衝突。',
  'import.issue.missing-key-column': '沒有任何一欄標記為主鍵。請在用來識別每一列的那一欄（例如 ID）上選擇「主鍵」。',
  'import.issue.multiple-key-columns': '有多欄標記為主鍵——請只保留一欄。',
  'import.issue.empty-key': '主鍵是空的。每一列都需要主鍵值。',
  'import.issue.key-too-long': '主鍵太長（最多 {max} 位元組）。',
  'import.issue.key-control-char': '主鍵中含有控制字元。',
  'import.issue.duplicate-key': '主鍵「{value}」已經被另一列使用。請讓每一列都有唯一的主鍵。',
  'import.issue.ragged-row':
    '這一列有 {actual} 個儲存格，預期為 {expected} 個。請檢查是不是漏了逗號；彙總列可以用「忽略最後 N 列」去掉。',
  'import.issue.empty-number': '這個儲存格是空的。請填入數字，或把這一欄設為「忽略」。',
  'import.issue.invalid-number': '「{value}」不是數字。請去掉千位分隔符號、貨幣符號和 %，例如寫成 4900。',
  'import.issue.orphan-foreign-key': '目標表格中沒有主鍵為「{value}」的列。',
  'import.issue.missing-fk-target': '這個外鍵欄還沒有目標表格。請在欄標題下方選擇它引用的表格。',
  'import.issue.invalid-fk-target': '這個外鍵的目標表格已經不存在。',
  'import.issue.missing-group-by':
    '這個表格有兩欄以上的外鍵——請指定由哪一欄來分組（標題列下方的「群組框依據」）。',
  'import.issue.invalid-group-by': '用來分組的欄必須是這個表格的外鍵欄之一。',
  'import.issue.round-trip-mismatch': '這份資料無法安全儲存——請簡化後再試一次。',
  'import.issue.label-fallback': '這個引用沒有可用的名稱——將改為顯示原始主鍵。',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision': '已經有一個內部 ID 相同的表格——請重新匯入一次。',
  'import.commitError.parameter-id-collision': '產生的 ID 與既有的 ID 衝突——請重新匯入一次。',
  'import.commitError.frame-placement-failed': '找不到可以放「{table}」群組框的空間。',
  'import.commitError.frame-not-found': '選取的群組框已經不存在。',
  'import.commitError.frame-insufficient-space': '「{frame}」裡的空間不足。',
  'import.commitError.invalid-result-graph': '產生的圖無效——請聯絡技術支援。',

  // §DI16 Phase 2 -- manage bindings + the refresh wizard
  'import.menu.import': '把試算表數值匯入為參數…',
  'import.menu.manage': '重新整理或管理已匯入的表格…',
  'import.menu.guide': '如何準備試算表…',
  'import.refresh.manageTitle': '管理試算表連結',
  'import.refresh.noBindings': '還沒有連結任何試算表表格。',
  'import.refresh.rowCount': '{n, plural, other {# 列}}',
  'import.refresh.renameLabel': '表格名稱',
  'import.refresh.refreshButton': '重新整理…',
  'import.refresh.exportCsv': '匯出變更提案 CSV',
  'import.refresh.exportBlockedDuplicate':
    '匯出被擋下：同一列同一欄上有多個生效的參數。請先修正重複再匯出。',
  'import.refresh.title': '重新整理「{table}」',
  'import.refresh.commit': '送出重新整理',

  'import.refresh.columnEvents.title': '欄的變動',
  'import.refresh.columnEvents.none': '沒有任何欄變動——每一欄都自動比對成功。',
  'import.refresh.columnEvents.missingHeader': '新資料中已經沒有「{header}」欄（{role}）。',
  'import.refresh.columnEvents.ambiguousMatch': '「{header}」欄同時比對到多個傳入欄。',
  'import.refresh.columnEvents.unresolved': '— 請選一個 —',
  'import.refresh.columnEvents.removedOption': '這一欄已移除',
  'import.refresh.columnEvents.mapMore': '對應更多欄…',
  'import.refresh.columnEvents.unrecognized': '「{header}」欄尚未對應。',
  'import.refresh.columnEvents.doNotMap': '不要對應',
  'import.refresh.columnEvents.fkTarget': '引用的表格…',

  'import.refresh.review.added': '{n, plural, other {將新增 # 列}}',
  'import.refresh.review.missing': '{n, plural, other {新資料中少了 # 列}}',
  'import.refresh.review.changed': '{n, plural, other {# 個數值會自動更新}}',
  'import.refresh.review.conflicts': '{n, plural, other {# 個數值有衝突，需要你選擇}}',
  'import.refresh.review.locallyDeleted': '{n, plural, other {# 個數值已在本機刪除}}',
  'import.refresh.review.fkRepoints': '{n, plural, other {# 個外鍵有變動}}',
  'import.refresh.review.newColumnValues': '{n, plural, other {將新增 # 個新欄的數值}}',
  'import.refresh.review.confirmAdd': '加入這一列',
  'import.refresh.review.missingChoiceNone': '— 請選擇 —',
  'import.refresh.review.missingChoiceUnlink': '維持原樣，解除與試算表的連結',
  'import.refresh.review.missingChoiceDelete': '刪除',
  'import.refresh.review.missingBlocked': '{table} 仍在引用它——請先重新整理那個表格。',
  'import.refresh.review.cellChoiceApplyIncoming': '使用新的值（{value}）',
  'import.refresh.review.cellChoiceKeepMine': '保留我的值（{value}）',
  'import.refresh.review.locallyDeletedChoiceRecreate': '用新的值重新建立（{value}）',
  'import.refresh.review.locallyDeletedChoiceDiscard': '捨棄——不再追蹤這個儲存格',
  'import.refresh.review.fkChoiceAccept': '接受新的引用（{value}）',
  'import.refresh.review.fkChoiceReject': '保留原本的引用（{value}）',

  'import.refresh.duplicateTripleError':
    '這份資料已損毀：同一列同一欄綁定了多個參數。在修正之前無法重新整理。',
  'import.refresh.commitError.referenced-node':
    '無法刪除這一列的參數——圖中其他地方仍在引用它。',
  'import.refresh.commitError.missing-row-dependency':
    '無法解除連結或刪除這一列——還有別的表格在引用它。',
  'import.refresh.commitError.placement-failed':
    '在畫布上找不到可以放新參數的空間——請把檢視移到別的位置再試一次。',

  // REFRESH-ONLY `RefreshIssueCode` descriptions
  'import.refreshIssue.table-not-found': '這個表格連結已經不存在。',
  'import.refreshIssue.unresolved-column-event': '這項欄變動需要先做出選擇才能繼續。',
  'import.refreshIssue.invalid-column-pairing': '這個欄的選擇與任何待處理的欄變動都不相符。',
  'import.refreshIssue.key-column-cannot-be-removed':
    '列主鍵欄不能移除——請改為把它對應到另一個傳入欄。',
  'import.refreshIssue.duplicate-column-pairing': '這個欄的選擇與另一個選擇衝突。',
  'import.refreshIssue.invalid-new-column-pairing': '這個新欄的外鍵目標無效。',
  'import.refreshIssue.duplicate-source-column-id': '這一欄的內部 ID 與既有的衝突。',
} satisfies Record<DataImportKey, string>

export default dataImport
