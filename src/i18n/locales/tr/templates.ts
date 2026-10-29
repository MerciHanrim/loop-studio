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
  'templates.button': 'Şablonlar',
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
  'modules.extract': 'Seçili yapıyı kaydet…',
  'modules.error.title': 'Yapı eklenemedi',
  'modules.promote.title': 'Bu belge parametre güdümlü (v2) modele dönüşsün mü?',
  'modules.promote.body': 'Bu yapıyı eklemek belgeyi v2 modele dönüştürür ve model anlam özeti değişir. Tek bir geri alma hem model değişikliğini hem eklemeyi birlikte geri alır.',
  'modules.promote.confirm': 'Yükselt ve ekle',
  'modules.frames.title': 'Kayıtlı çerçeveler dahil değil',
  'modules.frames.insertBody': 'Bu dosyada kayıtlı grup çerçeveleri var. Dosyayı yapı olarak eklemek çerçeveleri grafiğinize taşımaz — geri kalan her şey her zamanki gibi eklenir.',
  'modules.frames.extractBody': 'Grafiğinizde kayıtlı grup çerçeveleri var. Bunlar yapı dosyasına yazılmaz — yalnızca seçili düğümler ve aralarındaki bağlantılar yazılır.',
  'modules.frames.continue': 'Devam et',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Genel gacha',
  'templates.gachaGeneral.blurb': 'Tek banner, pity yok. İsabet oranı hedef çekilişlere göre sayılır; çalıştırma orada durur.',
  'templates.gachaStandard.name': 'Standart gacha',
  'templates.gachaStandard.blurb': 'Hard pity tavanı olan tek banner: tavanda bir sonraki çekiliş zorunlu bir SSR’dir.',
  'templates.gachaPickup.name': 'Pickup gacha',
  'templates.gachaPickup.blurb': 'Pity ve pickup garantisi: pickup dışı bir SSR’den sonra bir sonraki SSR pickup olur.',
  'modules.insertSaved': 'Kayıtlı yapıyı ekle…',
  'modules.insertSaved.blurb': 'Kaydettiğiniz bir yapı dosyasını bu belgeye ekler.',
  'modules.insertSaved.locked': 'Düzenleme kilitliyken kullanılamaz',
  'modules.extract.blurb': 'Seçili düğümleri ve aralarındaki bağlantıları bir dosyaya kaydeder.',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
