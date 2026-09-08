// docs/localization.md §L3.3 — Canvas surface slice of the `ja` catalog.
// `satisfies Record<CanvasKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/canvas`. Merged in `./index.ts`.
//
// Palette / node-kind names use the product katakana terms (プール / ソース …);
// `node.default.*` uses the descriptive names from the confirmed JA table
// (ストック / 供給源 / 排出口 / ゲート / 変換器 / 終点 / パラメーター / 計算値).

import type { CanvasKey } from '../en/canvas'

const canvas = {
  'palette.pool.name': 'プール',
  'palette.pool.description':
    'リソースを保持して現在量を表示します。容量があり、満杯になると押し戻します。',
  'palette.source.name': 'ソース',
  'palette.source.description':
    '毎ステップ新しいリソースを生み出し、つながっているノードへ送り出します。',
  'palette.drain.name': 'ドレイン',
  'palette.drain.description':
    'つながっているノードからリソースを引き出し、システムの外へ取り除きます。',
  'palette.gate.name': 'ゲート',
  'palette.gate.description':
    'リソースを引き出し、出ていく接続へ固定比率または確率で振り分けます。自身は何も保持しません。',
  'palette.converter.name': 'コンバーター',
  'palette.converter.description':
    '入力を消費し、独自の比率で出力を生み出します。自身は何も保持しません。',
  'palette.end.name': 'エンド',
  'palette.end.description': 'リソースが到達した瞬間に実行を停止します。',
  'palette.parameter.name': 'パラメーター',
  'palette.parameter.description':
    '調整できる固定値です。ポートはなく、式から id で参照します。',
  'palette.register.name': 'レジスター',
  'palette.register.description':
    '式で現在ステップから計算した値を表示します。何も保存せず、ポートもありません。',
  'palette.addAction': 'クリック、またはキャンバスへドラッグして追加します。',
  'canvas.minimap': 'グラフのミニマップ',
  'canvas.minimap.hide': 'ミニマップを隠す',
  'canvas.minimap.show': 'ミニマップを表示',
  'canvas.lock.lock': '編集をロック — 選択と閲覧は有効なまま',
  'canvas.lock.unlock': '編集をロック解除 — 移動・接続・値の変更ができます',
  'canvas.focus.on': 'フォーカス オフ — クリックで選択ノードにフォーカス',
  'canvas.focus.off': 'フォーカス オン — クリックでグラフ全体を表示',
  'canvas.focus.hint': 'フォーカスするノードを選択してください',
  'canvas.focus.rowLabel': 'フォーカス対象',
  'canvas.focus.stateOn': 'オン',
  'canvas.focus.stateOff': 'オフ',
  'canvas.panMode.off': 'パンモード オフ — 空のキャンバスをドラッグしてパン',
  'canvas.panMode.on': 'パンモード オン — どこをドラッグしてもパン',
  'canvas.panMode.rowLabel': 'パンモード',
  'canvas.filter.open': 'フィルター — 確認しながらグラフの一部を隠します',
  'canvas.filter.close': 'フィルターパネルを閉じる',
  'canvas.filter.title': 'フィルター',
  'canvas.filter.rowLabel': 'フィルター',
  'canvas.filter.groupEdgeClass': '接続の種類',
  'canvas.filter.groupResourceType': 'リソースの種類',
  'canvas.filter.groupNodeKind': 'ノードの種類',
  'canvas.filter.edgeClass.resource': 'リソース',
  'canvas.filter.edgeClass.state': '状態',
  'canvas.filter.edgeClass.hint': '依存のヒント',
  'canvas.filter.untyped': '種類なし',
  'canvas.filter.clear': 'フィルターをクリア',
  'canvas.filter.hiddenCount': '{n} 件を非表示',
  'canvas.filter.none': '非表示なし',
  'canvas.filter.checkboxHint': 'チェック = 非表示',
  'canvas.nodeKind.source': 'ソース',
  'canvas.nodeKind.pool': 'プール',
  'canvas.nodeKind.gate': 'ゲート',
  'canvas.nodeKind.converter': 'コンバーター',
  'canvas.nodeKind.drain': 'ドレイン',
  'canvas.nodeKind.end': 'エンド',
  'canvas.nodeKind.parameter': 'パラメーター',
  'canvas.nodeKind.register': 'レジスター',
  'canvas.resetView': '表示をリセット — グラフを合わせ、フィルターとフォーカスを解除',
  'canvas.frame.draw': 'グループフレーム — 空のキャンバスをドラッグして描画',
  'canvas.frame.drawing':
    'グループフレーム — 描画中。空のキャンバスをドラッグ、Esc で中止',
  'canvas.frame.defaultName': 'グループ {n}',
  'canvas.frame.delete': 'このフレームを削除',
  'canvas.frame.suggest':
    'フレームを提案 — 構造的につながったノードをおおまかに囲む矩形です。構造のみで、分野的な意味ではありません。',
  'canvas.frame.suggestStale':
    'フレームを提案 — グラフが変わりました。クリックで提案グループを再計算',
  'canvas.frame.suggestRow': 'フレームを提案',
  'canvas.frame.suggestNote':
    '構造にもとづく提案グループです。作業の分け方と一致しないことがあります。',
  'canvas.frame.suggestNoteDismiss': 'この注記を閉じる',
  'canvas.frame.areaName': 'エリア {n}',
  'canvas.frame.dismiss': 'この提案フレームを閉じる',
  'canvas.frame.clearAll': 'すべてのフレームをクリア',
  'canvas.frame.clearSuggested': '提案フレームをクリア',
  'canvas.frame.clearSuggestedRow': '提案フレームをクリア',
  'canvas.frame.colorRow': 'フレームの色',
  'canvas.frame.color.neutral': 'ニュートラル',
  'canvas.frame.color.slate': 'スレート',
  'canvas.frame.color.sage': 'セージ',
  'canvas.frame.color.gold': 'ゴールド',
  'canvas.frame.color.violet': 'バイオレット',
  'canvas.frame.color.rose': 'ローズ',
  'canvas.activity.off': 'アクティビティ表示 オフ — クリックで最近動いた部分に色を付けます',
  'canvas.activity.on': 'アクティビティ表示 オン — クリックで色を消します',
  'canvas.activity.rowLabel': 'アクティビティ表示',
  'canvas.route.invalidFlag': '無効な経路 — 経路の点がノードの内側にあります',
  'canvas.edgeLabel.clamp': 'クランプ',
  'canvas.edgeLabel.clamp.title': 'ターゲットのプールでフェーズ 0 終了時に 1 回クランプされ取り除かれました',
  'canvas.edgeLabel.blocked': 'ブロック',
  'canvas.edgeLabel.blocked.title':
    '届きましたが、ターゲットが発火できませんでした（アクティベーション不一致、またはアクティベーターが閉じたまま）',
  'canvas.edgeLabel.breakdown.title': 'この接続でのこのステップの移動量',
  'node.unreadable.title': '読み取れない {kind}',
  'node.unreadable.sub': 'データを読み取れません — ファイルで修正してください',
  'node.invalidFlag': 'このノードは無効です',
  'node.evaluatedCue': 'このステップで評価されましたが、動作しませんでした',
  'node.default.pool': 'ストック',
  'node.default.source': '供給源',
  'node.default.drain': '排出口',
  'node.default.gate': 'ゲート',
  'node.default.converter': '変換器',
  'node.default.end': '終点',
  'node.default.parameter': 'パラメーター',
  'node.default.register': '計算値',
  'rf.controls.label': 'キャンバス操作',
  'rf.controls.zoomIn': '拡大',
  'rf.controls.zoomOut': '縮小',
  'rf.controls.fitView': '図を表示に合わせる',
  'rf.controls.interactive': 'キャンバス編集を切り替え',
  'rf.handle.label': '接続点',
  'rf.node.a11y':
    'Enter または Space でこのノードを選択します。Delete で削除、Escape で取り消します。',
  'rf.node.a11yKeyboard':
    'Enter または Space でこのノードを選択し、矢印キーで移動します。Delete で削除、Escape で取り消します。',
  'rf.edge.a11y':
    'Enter または Space でこの接続を選択します。Delete で削除、Escape で取り消します。',
} satisfies Record<CanvasKey, string>

export default canvas
