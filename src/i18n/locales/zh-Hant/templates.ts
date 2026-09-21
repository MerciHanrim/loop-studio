// docs/localization.md §L3.3 — the Templates & modules slice of the `zh-Hant`
// catalog. `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a
// missing or an extra key against `../en/templates`.
//
// Traditional Chinese to the TAIWAN convention: 範本 template · 模組 module ·
// 專案 project · 匯入／匯出 import/export · 資料 data · 群組框 frame.
// Translated from the English source; `zh-Hans` was consulted only to confirm
// which product concept a term refers to.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': '範本 ▾',
  'templates.menuLabel': '範本',
  'templates.equilibrium.name': '平衡的生產線',
  'templates.equilibrium.blurb': '原料進場，加工與廢料，成品出貨——幾步之內就會穩定下來的產線。',
  'templates.deadlock.name': '產能死鎖',
  'templates.deadlock.blurb': '同一條產線少了出貨環節：庫存堆到容量上限，一切隨之停擺。',
  'templates.mmoProgression.name': 'MMO 前期成長（1–15 級）',
  'templates.mmoProgression.blurb': '三個區域的任務、狩獵與獎勵——看看升到 15 級要花多久。',
  'templates.coffeeRoastery.name': '咖啡烘焙坊營運流程',
  'templates.coffeeRoastery.blurb': '一天營業裡，烘焙、銷售與庫存如何彼此牽制。',
  'templates.gachaBannerZones.name': '三卡池轉蛋對比',
  'templates.gachaBannerZones.blurb': '同一筆預算下的三個卡池，看看保底與 UP 必得會帶來什麼差別。',
  'templates.replace.title': '要載入這個範本嗎？',
  'templates.replace.body': '目前的內容將被取代為：{name}',
  'templates.replace.confirm': '載入範本',
  'modules.button': '插入模組 ▾',
  'modules.menuLabel': '插入模組',
  'modules.fromFile': '從檔案…',
  'modules.extract': '將選取範圍擷取為模組…',
  'modules.bufferedStep.name': '含緩衝的生產環節',
  'modules.bufferedStep.blurb': '加入一個帶有輸入緩衝與輸出緩衝的生產環節。',
  'modules.rewardSplit.name': '獎勵分配迴圈',
  'modules.rewardSplit.blurb': '加入一個把收到的獎勵分成支出與儲蓄的迴圈。',
  'modules.error.title': '無法插入這個模組',
  'modules.promote.title': '要轉換成參數驅動（v2）模型嗎？',
  'modules.promote.body':
    '插入這個模組會把文件變成 v2 模型，模型語意摘要也會隨之改變。一次復原會同時退回模型變更與這次插入。',
  'modules.promote.confirm': '轉換並插入',
  'modules.frames.title': '不包含已儲存的群組框',
  'modules.frames.insertBody':
    '這個檔案存有群組框。以模組方式插入時不會把群組框帶進你的圖——其餘內容照常插入。',
  'modules.frames.extractBody':
    '你的圖存有群組框。它們不會寫進模組檔案——只有選取的節點及其內部連線會寫入。',
  'modules.frames.continue': '繼續',
} satisfies Record<TemplatesKey, string>

export default templates
