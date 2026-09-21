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
    '原料の投入から加工、廃棄、出荷まで。数ステップで安定します。',
  'templates.deadlock.name': '処理能力のデッドロック',
  'templates.deadlock.blurb':
    '出荷ステップがなく、在庫が上限まで埋まってライン全体が止まります。',
  'templates.mmoProgression.name': 'MMO の序盤進行（レベル 1〜15）',
  'templates.mmoProgression.blurb':
    '3 つのゾーンのクエスト、狩り、報酬。レベル 15 までの時間を見ます。',
  'templates.coffeeRoastery.name': 'コーヒー焙煎所の運営フロー',
  'templates.coffeeRoastery.blurb':
    '焙煎した豆の販売、在庫、コストがどう噛み合うかを見ます。',
  'templates.gachaBannerZones.name': '3ゾーン ガチャバナー比較',
  'templates.gachaBannerZones.blurb':
    '同じ予算で、天井と確定保証が違う 3 つのバナーを比べます。',
  'templates.replace.title': 'このテンプレートを読み込みますか？',
  'templates.replace.body': '現在の作業を置き換えます。テンプレート：{name}',
  'templates.replace.confirm': 'テンプレートを読み込む',
  'modules.button': 'モジュールを挿入 ▾',
  'modules.menuLabel': 'モジュールを挿入',
  'modules.fromFile': 'ファイルから…',
  'modules.extract': '選択範囲をモジュールとして書き出し…',
  'modules.bufferedStep.name': 'バッファ付き生産ステップ',
  'modules.bufferedStep.blurb':
    '入力と出力のバッファを備えた生産ステップを追加します。',
  'modules.rewardSplit.name': '報酬分配ループ',
  'modules.rewardSplit.blurb':
    '入ってきた報酬を消費と貯蓄に分ける循環を追加します。',
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
