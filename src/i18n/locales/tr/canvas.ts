// docs/localization.md §L3.3 — Canvas surface slice of the `tr` catalog.
//
// NODE KINDS. `Havuz` · `Kaynak` · `Gider` · `Dağıtıcı` · `Dönüştürücü` ·
// `Bitiş` · `Parametre` · `Hesaplanan değer`.
//
// `Gider` for Drain is SETTLED (§L2.18, second review). TDK gives `gider`
// two senses — the channel a liquid flows away through, and an expense — the
// same pair English `Drain` carries, so it matches the register English chose
// when it picked `Drain` over `Sink`. `Yutak` is the engineering rendering of
// `Sink`; `Çıkış` was rejected by measurement, because it already means the
// output buffer (`Çıkış kuyruğu` in the module overlay). The cost is that
// `gider` is also an ordinary noun: the node kind is therefore ALWAYS the
// bare capitalised `Gider`, and an expense is always lowercase and modified
// (`Toplam gider`, `Su gideri`). `trCopy.test.ts` pins that distinction.
//
// `Hesaplanan değer` for Register, never `Kayıt`: the noun means a record or
// a registration, and this node's defining property is that it stores
// NOTHING — the description says so in the same breath. de / fr / es-ES / ru
// all made the same move to "calculated value".
//
// `Kaynak` (the node) and `kaynak` (a resource) are the same word in Turkish.
// That ambiguity is the language's own and is not worked around with an
// invented term. The one sentence that would have read "Kaynak … kaynaklar"
// is `palette.source.description`, and it drops the subject instead — exactly
// what `fr`, `de` and `ru` do there, since the palette already shows the name
// directly above the description.

const canvas = {
  'palette.pool.name': 'Havuz',
  'palette.pool.description':
    'Kaynakları tutar ve o anki miktarı gösterir. Kapasitesi dolduğunda gelen akışı geri iter.',
  'palette.source.name': 'Kaynak',
  'palette.source.description':
    'Her adımda yeni kaynaklar üretir ve beslediği düğümlere gönderir.',
  'palette.drain.name': 'Gider',
  'palette.drain.description':
    'Bağlandığı düğümlerden kaynak çeker ve sistemden çıkarır.',
  'palette.gate.name': 'Dağıtıcı',
  'palette.gate.description':
    'Gelen kaynakları belirli bir oranda böler ya da olasılığa göre tek bir dalı seçip oraya yollar. Hiçbir şey tutmaz.',
  'palette.converter.name': 'Dönüştürücü',
  'palette.converter.description':
    'Giren kaynakları tüketir ve belirlediğiniz oranda çıkan kaynak üretir. Hiçbir şey tutmaz.',
  'palette.end.name': 'Bitiş',
  'palette.end.description': 'Bir kaynak ulaştığında çalıştırmayı durdurur.',
  'palette.parameter.name': 'Parametre',
  'palette.parameter.description':
    'Elle belirlenen sabit bir sayı. Bağlantı noktası yoktur; bir ifade ona id ile başvurabilir.',
  'palette.register.name': 'Hesaplanan değer',
  'palette.register.description':
    'O anki adım için bir ifadeyi hesaplar ve sonucu gösterir. Hiçbir şey biriktirmez, hiçbir şey saklamaz ve bağlantı noktası yoktur.',
  'palette.addAction': 'Eklemek için tıklayın ya da tuvale sürükleyin.',
  'canvas.minimap': 'Grafik mini haritası',
  'canvas.minimap.hide': 'Mini haritayı gizle',
  'canvas.minimap.show': 'Mini haritayı göster',
  'canvas.lock.lock': 'Düzenlemeyi kilitle — seçme ve okuma açık kalır',
  'canvas.lock.unlock': 'Düzenlemeyi aç — taşıma, bağlama ve değer değiştirme',
  'canvas.focus.on': 'Odak kapalı — seçili düğüme odaklanmak için tıklayın',
  'canvas.focus.off': 'Odak açık — grafiğin tamamını görmek için tıklayın',
  'canvas.focus.hint': 'Odaklanmak için bir düğüm seçin',
  'canvas.focus.rowLabel': 'Seçime odaklan',
  'canvas.focus.stateOn': 'Açık',
  'canvas.focus.stateOff': 'Kapalı',
  'canvas.panMode.off': 'Kaydırma kapalı — görünümü kaydırmak için boş tuvali sürükleyin',
  'canvas.panMode.on': 'Kaydırma açık — kaydırmak için herhangi bir yeri sürükleyin',
  'canvas.panMode.rowLabel': 'Kaydırma kipi',
  'canvas.filter.open': 'Süzgeçler — incelerken grafiğin bir bölümünü gizler',
  'canvas.filter.close': 'Süzgeç panelini kapat',
  'canvas.filter.title': 'Süzgeçler',
  'canvas.filter.rowLabel': 'Süzgeçler',
  'canvas.filter.groupEdgeClass': 'Bağlantı türü',
  'canvas.filter.groupResourceType': 'Kaynak türü',
  'canvas.filter.groupNodeKind': 'Düğüm çeşidi',
  'canvas.filter.edgeClass.resource': 'Kaynak',
  'canvas.filter.edgeClass.state': 'Durum',
  'canvas.filter.edgeClass.hint': 'Bağımlılık ipucu',
  'canvas.filter.untyped': 'türsüz',
  'canvas.filter.clear': 'Süzgeçleri temizle',
  'canvas.filter.hiddenCount': 'gizli: {n}',
  'canvas.filter.none': 'Hiçbir şey gizli değil',
  'canvas.filter.checkboxHint': 'işaretli = gizli',
  'canvas.nodeKind.source': 'Kaynak',
  'canvas.nodeKind.pool': 'Havuz',
  'canvas.nodeKind.gate': 'Dağıtıcı',
  'canvas.nodeKind.converter': 'Dönüştürücü',
  'canvas.nodeKind.drain': 'Gider',
  'canvas.nodeKind.end': 'Bitiş',
  'canvas.nodeKind.parameter': 'Parametre',
  'canvas.nodeKind.register': 'Hesaplanan değer',
  'canvas.resetView': 'Görünümü sıfırla — grafiği sığdırır, süzgeç ve odağı kaldırır',
  'canvas.regionSelect.off':
    'Bölge seç — seçmek için boş tuvali sürükleyin; Shift ile sürükleme de çalışır',
  'canvas.regionSelect.on':
    'Bölge seç — seçiliyor; boş tuvali sürükleyin, iptal için Esc',
  'canvas.regionSelect.count': '{n, plural, one {# düğüm seçildi} other {# düğüm seçildi}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# düğüm seçildi} other {# düğüm seçildi}} · taşımak için düzenlemeyi açın',
  'canvas.frame.draw': 'Grup çerçevesi — çizmek için boş tuvali sürükleyin',
  'canvas.frame.drawing': 'Grup çerçevesi — çiziliyor; boş tuvali sürükleyin, iptal için Esc',
  'canvas.frame.defaultName': '{n}. grup',
  'canvas.frame.delete': 'Bu çerçeveyi sil',
  'canvas.frame.suggest':
    'Çerçeve öner — yapısal olarak bağlı düğümlerin çevresine kabaca dikdörtgenler çizer. Yalnızca yapı; alan anlamı değil.',
  'canvas.frame.suggestStale':
    'Çerçeve öner — grafik değişti; önerilen grupları yeniden hesaplamak için tıklayın',
  'canvas.frame.suggestRow': 'Çerçeve öner',
  'canvas.frame.suggestNote':
    'Önerilen yapısal gruplar — işi sizin böleceğiniz biçimle örtüşmeyebilir.',
  'canvas.frame.suggestNoteDismiss': 'Bu notu gizle',
  'canvas.frame.areaName': '{n}. alan',
  'canvas.frame.dismiss': 'Bu önerilen çerçeveyi kaldır',
  'canvas.frame.clearAll': 'Tüm çerçeveleri kaldır',
  'canvas.frame.clearSuggested': 'Önerilen çerçeveleri kaldır',
  'canvas.frame.clearSuggestedRow': 'Önerilen çerçeveleri kaldır',
  'canvas.frame.colorRow': 'Çerçeve rengi',
  'canvas.frame.color.neutral': 'Nötr',
  'canvas.frame.color.slate': 'Arduvaz',
  'canvas.frame.color.sage': 'Adaçayı',
  'canvas.frame.color.gold': 'Altın',
  'canvas.frame.color.violet': 'Menekşe',
  'canvas.frame.color.rose': 'Gül',
  'canvas.frame.props.title': 'Çerçeve ayarları — {label}',
  'canvas.frame.props.name': 'Ad',
  'canvas.activity.off':
    'Etkinlik katmanı kapalı — son etkin bölümleri renklendirmek için tıklayın',
  'canvas.activity.on': 'Etkinlik katmanı açık — rengi kaldırmak için tıklayın',
  'canvas.activity.rowLabel': 'Etkinlik katmanı',
  'canvas.route.invalidFlag': 'geçersiz güzergâh — bir güzergâh noktası düğümün içinde',
  'canvas.edgeLabel.clamp': 'kırpıldı',
  'canvas.edgeLabel.clamp.title':
    'alıcı Havuzun Faz 0 sonundaki tek sınırlaması tarafından kaldırıldı',
  'canvas.edgeLabel.blocked': 'engellendi',
  'canvas.edgeLabel.blocked.title':
    'iletildi, ama alıcı çalışamadı (yanlış etkinleştirme ya da bir etkinleştirici onu kapalı tuttu)',
  'canvas.edgeLabel.breakdown.title': 'bu adımda bu bağlantı üzerindeki aktarımlar',
  'canvas.edgeLabel.refMissing': 'Parametre başvurusu hatası',
  'node.unreadable.title': 'okunamayan {kind}',
  'node.unreadable.sub': 'veri okunamıyor — dosyada düzeltin',
  'node.invalidFlag': 'Bu düğüm geçersiz',
  'node.aria.invalid': 'geçersiz',
  'node.aria.selected': 'seçili',
  'node.aria.focused': 'odakta',
  'node.evaluatedCue': 'Bu adımda hesaplandı ama işlem yapmadı',
  'node.default.pool': 'Havuz',
  'node.default.source': 'Kaynak',
  'node.default.drain': 'Gider',
  'node.default.gate': 'Dağıtıcı',
  'node.default.converter': 'Dönüştürücü',
  'node.default.end': 'Bitiş',
  'node.default.parameter': 'Parametre',
  'node.default.register': 'Hesaplanan değer',
  'canvas.frame.a11y.roledescription': 'grup çerçevesi',
  'canvas.frame.a11y.roledescriptionAuto': 'önerilen grup çerçevesi',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# düğüm} other {# düğüm}}',
  'canvas.frame.a11y.desc': 'Bu çerçeveyi seçmek için Enter ya da Space tuşuna basın.',
  'canvas.frame.a11y.descSelected':
    'Seçildi. Ok tuşları çerçeveyi ve içindeki her şeyi taşır, Shift daha büyük adım atar. Backspace ya da Delete onu siler. Escape seçimi kaldırır.',
  'canvas.frame.a11y.descReadonly':
    'Salt okunur — bu çerçeve seçilebilir ve okunabilir, ama düzenlenemez.',
  'canvas.frame.a11y.resize':
    '«{label}» çerçevesini yeniden boyutlandır — genişlik {w}, yükseklik {h}. Ok tuşları boyutu değiştirir, Shift daha büyük adım atar.',
  'canvas.frame.a11y.moved': '«{label}» çerçevesi x {x}, y {y} konumuna taşındı',
  'canvas.frame.a11y.resized':
    '«{label}» çerçevesinin boyutu değişti: genişlik {w}, yükseklik {h}',
  'rf.node.moveCancelled': 'Taşıma iptal edildi. Düğüm yeniden x {x}, y {y} konumunda',
  'rf.node.moved': 'Seçili düğüm {direction} taşındı. Yeni konum: x {x}, y {y}',
  'rf.dir.left': 'sola',
  'rf.dir.right': 'sağa',
  'rf.dir.up': 'yukarı',
  'rf.dir.down': 'aşağı',
  'rf.controls.label': 'Tuval denetimleri',
  'rf.controls.zoomIn': 'Yakınlaştır',
  'rf.controls.zoomOut': 'Uzaklaştır',
  'rf.controls.fitView': 'Diyagramı görünüme sığdır',
  'rf.controls.interactive': 'Tuval düzenlemesini aç/kapat',
  'rf.handle.label': 'Bağlantı noktası',
  'rf.node.a11y':
    'Bu düğümü seçmek için Enter ya da Space tuşuna basın. Silmek için Delete, iptal için Escape.',
  'rf.node.a11yKeyboard':
    'Bu düğümü seçmek için Enter ya da Space tuşuna, sonra taşımak için ok tuşlarına basın. Silmek için Delete, iptal için Escape.',
  'rf.edge.a11y':
    'Bu bağlantıyı seçmek için Enter ya da Space tuşuna basın. Silmek için Delete, iptal için Escape.',
} as const

export type CanvasKey = keyof typeof canvas
export default canvas
