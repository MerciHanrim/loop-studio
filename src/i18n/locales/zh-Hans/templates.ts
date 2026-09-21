// docs/localization.md §L3.3 — Templates & modules slice of the `zh-Hans`
// catalog. Mainland-China professional-tool register: Chinese punctuation in
// prose, ASCII kept for ids, extensions, key names, expression syntax, wire
// enums and the product name. Glossary: 模板 template · 模块 module · 参数
// parameter · 分组框 frame · 节点 node · 连线 edge.
//
// `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/templates`. Merged in `./index.ts`.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': '模板 ▾',
  'templates.menuLabel': '模板',
  'templates.equilibrium.name': '平衡的生产线',
  'templates.equilibrium.blurb': '原料进入，加工与废料，成品产出——几步之内就能稳定下来的产线。',
  'templates.deadlock.name': '产能死锁',
  'templates.deadlock.blurb': '同一条产线去掉出货环节：库存堆到容量上限，一切随之停摆。',
  'templates.mmoProgression.name': 'MMO 前期成长（1–15 级）',
  'templates.mmoProgression.blurb': '三个区域的任务、狩猎与奖励——看看升到 15 级要花多久。',
  'templates.coffeeRoastery.name': '咖啡烘焙坊运营流程',
  'templates.coffeeRoastery.blurb': '一天营业里，烘焙、销售与库存如何相互牵制。',
  'templates.gachaBannerZones.name': '三卡池抽卡对比',
  'templates.gachaBannerZones.blurb': '同一预算下的三个卡池，看看保底与 UP 必得带来什么差别。',
  'templates.replace.title': '加载此模板？',
  'templates.replace.body': '当前内容将被替换为：{name}',
  'templates.replace.confirm': '加载模板',
  'modules.button': '插入模块 ▾',
  'modules.menuLabel': '插入模块',
  'modules.fromFile': '从文件…',
  'modules.extract': '将所选提取为模块…',
  'modules.bufferedStep.name': '带缓冲的生产环节',
  'modules.bufferedStep.blurb': '添加一个带输入缓冲与输出缓冲的生产环节。',
  'modules.rewardSplit.name': '奖励分配循环',
  'modules.rewardSplit.blurb': '添加一个把收到的奖励分成支出与储蓄的循环。',
  'modules.error.title': '无法插入该模块',
  'modules.promote.title': '转换为参数驱动（v2）模型？',
  'modules.promote.body': '插入该模块会把文档变成 v2 模型，模型语义摘要也随之改变。一次撤销会同时回退模型变更与这次插入。',
  'modules.promote.confirm': '转换并插入',
  'modules.frames.title': '不包含已保存的分组框',
  'modules.frames.insertBody': '该文件保存了分组框。以模块方式插入时不会把分组框带进你的图——其余内容照常插入。',
  'modules.frames.extractBody': '你的图中保存了分组框。它们不会写入模块文件——只有所选节点及其内部连线会被写入。',
  'modules.frames.continue': '继续',
} satisfies Record<TemplatesKey, string>

export default templates
