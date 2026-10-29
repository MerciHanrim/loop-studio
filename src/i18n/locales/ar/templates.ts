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
  'modules.extract': 'حفظ البنية المحددة…',
  'modules.error.title': 'تعذّر إدراج البنية',
  'modules.promote.title': 'تحويل هذا إلى نموذج مبني على المعاملات (v2)؟',
  'modules.promote.body': 'إدراج هذه البنية يحوّل المستند إلى نموذج v2 ويغيّر ملخّص دلالات النموذج. تراجُع واحد يعكس تغيير النموذج والإدراج معًا.',
  'modules.promote.confirm': 'الترقية والإدراج',
  'modules.frames.title': 'الإطارات المحفوظة غير مُضمَّنة',
  'modules.frames.insertBody': 'يحتوي هذا الملف على إطارات مجموعات محفوظة. إدراجه كبنية لا يجلب الإطارات إلى مخططك — ويُدرَج كل ما عداها كالمعتاد.',
  'modules.frames.extractBody': 'يحتوي مخططك على إطارات مجموعات محفوظة. لا تُكتب هذه الإطارات في ملف البنية — تُكتب العقد المحددة واتصالاتها الداخلية فقط.',
  'modules.frames.continue': 'متابعة',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'بانر gacha عام',
  'templates.gachaGeneral.blurb': 'بانر واحد، بلا pity. يُحسب معدّل الإصابة بالنسبة إلى عدد السحبات المستهدف؛ ويتوقف التشغيل عنده.',
  'templates.gachaStandard.name': 'بانر gacha قياسي',
  'templates.gachaStandard.blurb': 'بانر واحد بسقف pity صارم: عند السقف تكون السحبة التالية SSR مفروضًا.',
  'templates.gachaPickup.name': 'بانر gacha مع pickup',
  'templates.gachaPickup.blurb': 'نظام pity وضمان pickup: بعد SSR خارج pickup، يكون الـ SSR التالي هو الـ pickup.',
  'modules.insertSaved': 'إدراج بنية محفوظة…',
  'modules.insertSaved.blurb': 'يضيف ملف بنية حفظته إلى هذا المستند.',
  'modules.insertSaved.locked': 'غير متاح أثناء قفل التحرير',
  'modules.extract.blurb': 'يحفظ العقد المحددة والاتصالات بينها في ملف.',
} as const

export default templates
