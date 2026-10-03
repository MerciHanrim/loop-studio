// docs/localization.md §L3.3 — Templates & modules slice of the `ar` catalog.
// Key-checked against `../en/templates` by `satisfies`; same `{name}` slots.
//
// GLOSSARY, shared with the other slices (§L2.24):
//   قالب Template · وحدة module · إطار frame · مَجمَع Pool · بوّابة Gate ·
//   مُحوِّل Converter · سِجِلّ Register · مُعامِل Parameter · عُقدة node ·
//   اتصال connection · مخطط diagram/graph · منطقة zone.
//
// KEPT IN LATIN SCRIPT, per the contract: `gacha`, `pity`, `pickup`, `MMO`,
// `v2`. Arabic games writing borrows these untranslated — `gacha` has no Arabic
// noun at all, and `pity` / `pickup` name specific mechanics the way `SSR` names
// a rarity. `بانر` IS written in Arabic script: it is an established loan with
// settled Arabic spelling, unlike the three above. Each kept token is pinned by
// key in `../../arCopy.test.ts`, so a later edit cannot quietly translate one.
//
// the disclosure mark is an icon beside the word since issue #298 (it was a KEEP arrow, §L9.3): it
// points at the menu it opens, which is below the button in either direction,
// so it is the same character here as in every other locale.

const templates = {
  'templates.button': 'القوالب',
  'templates.menuLabel': 'القوالب',
  'templates.equilibrium.name': 'خط إنتاج متوازن',
  'templates.equilibrium.blurb': 'مواد داخلة، ومعالجة وهدر، وبضائع تامة خارجة — خط يستقر خلال خطوات قليلة.',
  'templates.deadlock.name': 'جمود السعة',
  'templates.deadlock.blurb': 'الخط نفسه بلا خطوة شحن: يمتلئ المخزون حتى السعة ويتوقف كل شيء.',
  'templates.mmoProgression.name': 'التقدّم المبكر في لعبة MMO (المستويات 1–15)',
  'templates.mmoProgression.blurb': 'ثلاث مناطق من المهام والصيد والمكافآت — كم يستغرق الوصول إلى المستوى 15.',
  'templates.coffeeRoastery.name': 'سير عمليات محمصة القهوة',
  'templates.coffeeRoastery.blurb': 'كيف تتجاذب أعمال التحميص والمبيعات والمخزون على مدار يوم من البيع.',
  'templates.gachaBannerZones.name': 'مقارنة بانرات gacha في ثلاث مناطق',
  'templates.gachaBannerZones.blurb': 'ثلاثة بانرات بميزانية واحدة، لمعرفة ما يغيّره نظام pity وضمان pickup.',
  'templates.replace.title': 'تحميل هذا القالب؟',
  'templates.replace.body': 'سيُستبدل عملك الحالي بـ: {name}',
  'templates.replace.confirm': 'تحميل القالب',
  'modules.button': 'إدراج وحدة',
  'modules.menuLabel': 'إدراج وحدة',
  'modules.fromFile': 'من ملف…',
  'modules.extract': 'استخراج التحديد كوحدة…',
  'modules.bufferedStep.name': 'خطوة إنتاج بمخزن مؤقت',
  'modules.bufferedStep.blurb': 'يضيف خطوة إنتاج بمخزن مؤقت للإدخال وآخر للإخراج.',
  'modules.rewardSplit.name': 'حلقة تقسيم المكافآت',
  'modules.rewardSplit.blurb': 'يضيف حلقة تقسّم المكافآت الواردة إلى إنفاق وادّخار.',
  'modules.error.title': 'تعذّر إدراج الوحدة',
  'modules.promote.title': 'تحويل هذا إلى نموذج مبني على المعاملات (v2)؟',
  'modules.promote.body':
    'إدراج هذه الكتلة يحوّل المستند إلى نموذج v2 ويغيّر ملخّص دلالات النموذج. تراجُع واحد يعكس تغيير النموذج والإدراج معًا.',
  'modules.promote.confirm': 'الترقية والإدراج',
  'modules.frames.title': 'الإطارات المحفوظة غير مُضمَّنة',
  'modules.frames.insertBody':
    'يحتوي هذا الملف على إطارات مجموعات محفوظة. إدراجه كوحدة لا يجلب الإطارات إلى مخططك — ويُدرَج كل ما عداها كالمعتاد.',
  'modules.frames.extractBody':
    'يحتوي مخططك على إطارات مجموعات محفوظة. لا تُكتب هذه الإطارات في ملف الوحدة — تُكتب العقد المحددة واتصالاتها الداخلية فقط.',
  'modules.frames.continue': 'متابعة',
} as const

export default templates
