// docs/localization.md §L3.3 — Templates & modules slice of the `ja` catalog.
// `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/templates`. Merged in `./index.ts`.
//
// Terminology per the confirmed JA table (2026-09). Style: noun-form for
// names / menu items; です・ます for blurbs and confirm bodies; JA punctuation.
// A native-JA sentence pass on the long blurbs is recommended before Production.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': 'テンプレート',
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
  'modules.extract': '選択した構造を保存…',
  'modules.error.title': '構造を挿入できませんでした',
  'modules.promote.title': 'パラメーター駆動（v2）モデルにしますか？',
  'modules.promote.body': 'この構造を挿入すると、ドキュメントは v2 モデルになり、モデルの意味のダイジェストが変わります。1 回の元に戻すで、モデルの変更と挿入をまとめて取り消せます。',
  'modules.promote.confirm': '昇格して挿入',
  'modules.frames.title': '保存済みフレームは含まれません',
  'modules.frames.insertBody': 'このファイルには保存されたグループフレームがあります。構造として挿入しても、フレームはグラフに取り込まれません。それ以外はいつもどおり挿入されます。',
  'modules.frames.extractBody': 'グラフに保存されたグループフレームがあります。構造ファイルには書き込まれず、選択したノードとその内部の接続だけが書き込まれます。',
  'modules.frames.continue': '続ける',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': '一般ガチャ',
  'templates.gachaGeneral.blurb': '天井のない 1 つのバナー。排出率は目標の回数に対して数え、そこで実行が止まります。',
  'templates.gachaStandard.name': '恒常ガチャ',
  'templates.gachaStandard.blurb': 'ハード天井のある 1 つのバナー。天井に達すると次の 1 回は天井確定 SSR です。',
  'templates.gachaPickup.name': 'ピックアップガチャ',
  'templates.gachaPickup.blurb': '天井とピックアップ保証。ピックアップ外の SSR のあと、次の SSR はピックアップです。',
  'modules.insertSaved': '保存した構造を挿入…',
  'modules.insertSaved.blurb': '保存した構造ファイルをこのドキュメントに追加します。',
  'modules.insertSaved.locked': '編集がロックされている間は使えません',
  'modules.extract.blurb': '選択したノードとその間の接続をファイルに保存します。',
} satisfies Record<TemplatesKey, string>

export default templates
