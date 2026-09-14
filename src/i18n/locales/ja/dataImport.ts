// docs/data-import.md §DI16 Phase 1B — the CSV/TSV import wizard's `ja` slice.
// `satisfies Record<DataImportKey, string>` makes `tsc` fail on a missing or
// an extra key against `../en/dataImport`.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': 'データを読み込む ▾',
  'import.title': '表計算データを読み込む',
  'import.tableName': 'テーブル名',
  'import.removeTable': 'テーブルを削除',
  'import.addTable': 'テーブルを追加',
  'import.pastePlaceholder': 'CSVまたはTSVのテキストを貼り付けてください',
  'import.uploadFile': 'ファイルをアップロード…',
  'import.delimiter': '区切り文字',
  'import.delimiterAuto': '自動検出',
  'import.delimiterComma': 'カンマ',
  'import.delimiterTab': 'タブ',
  'import.headerRow': 'ヘッダー行',
  'import.ignoreLastRows': '末尾のN行を無視',
  'import.parseError': '有効なCSV/TSVではありません: {line}行目 {column}列目で{kind}。',
  'import.role.ignored': '無視',
  'import.role.key': 'キー',
  'import.role.number': '数値',
  'import.role.label': 'ラベル',
  'import.role.foreignKey': '外部キー',
  'import.selectTable': 'テーブルを選択…',
  'import.selectColumn': '列を選択…',
  'import.selectFrame': 'フレームを選択…',
  'import.groupBy': 'フレームのグループ基準:',
  'import.errorsFound': '{n, plural, other {続行する前に解決すべき問題が#件あります:}}',
  'import.warningsFound': '{n, plural, other {#件の行は、ラベルに名前の代わりに元のキーを使用します。}}',
  'import.placement.none': 'フレームなしでキャンバスに配置',
  'import.placement.framePerTable': 'テーブルごとに1つのフレーム',
  'import.placement.existingFrame': '既存のフレームに追加',
  'import.summary': '{tables, plural, other {テーブル#件}}を読み込み、{parameters, plural, other {パラメータ#個}}を作成します。',
  'import.next': '次へ',
  'import.back': '戻る',
  'import.commit': '読み込む',
} satisfies Record<DataImportKey, string>

export default dataImport
