// docs/localization.md §L3.3 — Templates & modules slice of the `tr` catalog.
//
// **`Template` is `Şablon` and the simulation model is `Model`.** Turkish has
// both words and neither is taken, so the anglicism the Romance catalogs had
// to keep is not needed here — the same situation as Russian.
//
// `adım` is the simulation timestep. A production STAGE is `aşama`, which
// keeps the two senses of English "step" apart exactly as the Romance
// catalogs do with `etapa` / `passo`.
//
// A slot carrying user text cannot take a Turkish case suffix — its vowel
// harmony and buffer consonant depend on the last sound of the word, which is
// unknown here. Every such slot is therefore quoted or preceded by a
// classifier noun that takes the suffix instead (§L2.18).

const templates = {
  'templates.button': 'Şablonlar ▾',
  'templates.menuLabel': 'Şablonlar',
  'templates.equilibrium.name': 'Dengeli üretim hattı',
  'templates.equilibrium.blurb':
    'Giren malzeme, işleme ve fire, çıkan ürün — birkaç adımda dengeye oturan bir hat.',
  'templates.deadlock.name': 'Kapasite tıkanması',
  'templates.deadlock.blurb':
    'Sevkiyat aşaması olmayan aynı hat: stok kapasiteyi doldurur ve her şey durur.',
  'templates.mmoProgression.name': 'Erken MMO ilerleyişi (1–15. seviyeler)',
  'templates.mmoProgression.blurb':
    'Üç bölgede görev, av ve ödül — 15. seviyeye ulaşmak ne kadar sürüyor.',
  'templates.coffeeRoastery.name': 'Kahve kavurma işleyişi',
  'templates.coffeeRoastery.blurb':
    'Kavurma, satış ve stok bir günlük işleyişte birbirini nasıl çekiyor.',
  'templates.gachaBannerZones.name': '3 bölgeli gacha banner karşılaştırması',
  'templates.gachaBannerZones.blurb':
    'Tek bütçeyle üç banner — pity ve pickup garantisi neyi değiştiriyor.',
  'templates.replace.title': 'Bu şablon yüklensin mi?',
  'templates.replace.body': 'Şu anki çalışmanızın yerini şu alacak: {name}',
  'templates.replace.confirm': 'Şablonu yükle',
  'modules.button': 'Modül ekle ▾',
  'modules.menuLabel': 'Modül ekle',
  'modules.fromFile': 'Dosyadan…',
  'modules.extract': 'Seçimi modül olarak çıkar…',
  'modules.bufferedStep.name': 'Tamponlu üretim aşaması',
  'modules.bufferedStep.blurb': 'Giriş ve çıkış tamponu olan bir üretim aşaması ekler.',
  'modules.rewardSplit.name': 'Ödül paylaştırma döngüsü',
  'modules.rewardSplit.blurb': 'Gelen ödülleri harcama ve birikime ayıran bir döngü ekler.',
  'modules.error.title': 'Modül eklenemedi',
  'modules.promote.title': 'Bu belge parametre güdümlü (v2) modele dönüşsün mü?',
  'modules.promote.body':
    'Bu bloğu eklemek belgeyi v2 modele dönüştürür ve model anlam özeti değişir. Tek bir geri alma hem model değişikliğini hem eklemeyi birlikte geri alır.',
  'modules.promote.confirm': 'Yükselt ve ekle',
  'modules.frames.title': 'Kayıtlı çerçeveler dahil değil',
  'modules.frames.insertBody':
    'Bu dosyada kayıtlı grup çerçeveleri var. Dosyayı modül olarak eklemek çerçeveleri grafiğinize taşımaz — geri kalan her şey her zamanki gibi eklenir.',
  'modules.frames.extractBody':
    'Grafiğinizde kayıtlı grup çerçeveleri var. Bunlar modül dosyasına yazılmaz — yalnızca seçili düğümler ve aralarındaki bağlantılar yazılır.',
  'modules.frames.continue': 'Devam et',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
