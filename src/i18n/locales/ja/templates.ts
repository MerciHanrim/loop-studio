// docs/localization.md §L3.3 — Templates & modules slice of the `ja` catalog.
// `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/templates`. Merged in `./index.ts`.
//
// Terminology per the confirmed JA table (2026-09). Style: noun-form for
// names / menu items; です・ます for blurbs and confirm bodies; JA punctuation.
// A native-JA sentence pass on the long blurbs is recommended before Production.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': 'テンプレート ▾',
  'templates.menuLabel': 'テンプレート',
  'templates.equilibrium.name': 'バランスの取れた生産ライン',
  'templates.equilibrium.blurb':
    '原料が流入し、生産が加工と廃棄に分かれ、完成品が出荷されます。実行すると、原料在庫と完成品在庫は数ステップで安定し、タイムラインは横ばいになります。',
  'templates.deadlock.name': '処理能力のデッドロック',
  'templates.deadlock.blurb':
    '同じラインで出荷ステップがないため、完成品の行き場がありません。実行すると、完成品在庫が上限まで埋まり、原料在庫が天井まで逆流し、供給がゼロまで絞られ、ライン全体が停止します。',
  'templates.mmoProgression.name': 'MMO の序盤進行（レベル 1〜15）',
  'templates.mmoProgression.blurb':
    'つながったプレイ経済です。3 つのゾーンレーン（1〜5 / 5〜10 / 10〜15）、勝利・失敗・死亡が確率で分かれる戦闘、分類される戦利品、修理と補給のコストがかかるゴールド経済、レベルごとに上がる XP カーブがあります。実行またはモンテカルロで、レベル 15 到達までの時間がどれだけばらつくかを確認できます。',
  'templates.coffeeRoastery.name': 'コーヒー焙煎所の運営フロー',
  'templates.coffeeRoastery.blurb':
    '焙煎・販売・在庫の関係を簡略化して見るための、運営フローのシミュレーションです。生豆が入荷し、一部は卸で出て、残りは焙煎してカフェ / オンライン / 小売で販売されます。1 日の運営値を 5 つ変更すると、在庫の推移と予測結果が動きます。簡略化したシミュレーション例であり、ERP やリアルタイム監視システムではありません。',
  'templates.replace.title': 'このテンプレートを読み込みますか？',
  'templates.replace.body': '現在の作業を置き換えます。テンプレート：{name}',
  'templates.replace.confirm': 'テンプレートを読み込む',
  'modules.button': 'モジュールを挿入 ▾',
  'modules.menuLabel': 'モジュールを挿入',
  'modules.fromFile': 'ファイルから…',
  'modules.extract': '選択範囲をモジュールとして書き出し…',
  'modules.bufferedStep.name': 'バッファ付き生産ステップ',
  'modules.bufferedStep.blurb':
    '受信プールへの供給、2→1 のコンバーターと廃棄ドレインに分ける取り込みゲート、そして出荷する送信プールで構成されます。処理中の数量と計画実行サイズを表示する計算値が付きます。',
  'modules.rewardSplit.name': '報酬分配ループ',
  'modules.rewardSplit.blurb':
    'アクティビティがウォレットに流れ込み、配分ゲートが 2:1 で消費と貯蓄に分けます。貯蓄は引き出しで減り、2 つの計算値が純資産と目標への進捗を追跡します。',
  'modules.error.title': 'モジュールを挿入できませんでした',
  'modules.promote.title': 'パラメーター駆動（v2）モデルにしますか？',
  'modules.promote.body':
    'このブロックを挿入すると、ドキュメントは v2 モデルになり、モデルセマンティクスのダイジェストが変わります。1 回の元に戻すで、モデルの変更と挿入をまとめて取り消せます。',
  'modules.promote.confirm': '昇格して挿入',
  'modules.frames.title': '保存済みフレームは含まれません',
  'modules.frames.insertBody':
    'このファイルには保存済みのグループフレームがあります。モジュールとして挿入してもフレームはグラフに取り込まれません。それ以外は通常どおり挿入されます。',
  'modules.frames.extractBody':
    'グラフに保存済みのグループフレームがあります。フレームはモジュールファイルには書き込まれず、選択したノードとその内部接続だけが対象になります。',
  'modules.frames.continue': '続ける',
} satisfies Record<TemplatesKey, string>

export default templates
