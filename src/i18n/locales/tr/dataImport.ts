// docs/data-import.md §DI16/§DI17 — the CSV/TSV import wizard slice of the
// `tr` catalog.
//
// `{column}` means two different things and they take different words.
// `import.parseError` reports a 1-based CHARACTER offset inside a row, so it
// reads `karakter`; `import.loc.*` reports a real TABLE column and reads
// `sütun` (§L2.11).
//
// Turkish does not pluralise a noun after a numeral — `3 satır`, not
// `3 satırlar` — so a bare `{n}` in front of a noun is grammatical as it
// stands, and the `one` and `other` arms of a plural carry the SAME noun
// form. That is correct, not a copy-paste slip.

const dataImport = {
  'import.button': 'Veri ▾',
  'import.title': 'Tablo verisi içe aktar',
  'import.tableName': 'Tablo adı',
  'import.removeTable': 'Tabloyu kaldır',
  'import.addTable': 'Başka bir tablo ekle',
  'import.pastePlaceholder': 'CSV ya da TSV metnini buraya yapıştırın',
  'import.pasteAria': 'CSV ya da TSV metni',
  'import.tableNameRequired': 'Devam etmek için bir tablo adı girin.',
  'import.pasteDataRequired': 'Devam etmek için CSV/TSV verisi yapıştırın ya da yükleyin.',
  'import.uploadFile': 'Dosya yükle…',
  'import.delimiter': 'Ayırıcı',
  'import.delimiterAuto': 'Kendiliğinden algıla',
  'import.delimiterComma': 'Virgül',
  'import.delimiterTab': 'Sekme',
  'import.headerRow': 'Başlık satırı',
  'import.ignoreLastRows': 'Son N satırı yok say',
  'import.parseError':
    'Bu metin geçerli bir CSV/TSV değil: {line}. satır, {column}. karakterde {kind}.',
  'import.parseErrorKind.unterminated-quote': 'kapatılmamış tırnak',
  'import.parseErrorKind.text-after-quote': 'kapanış tırnağından hemen sonra beklenmeyen metin',
  'import.parseErrorKind.quote-in-unquoted-field': 'tırnaksız alanın içinde tırnak',
  'import.role.ignored': 'Yok say',
  'import.role.key': 'Anahtar',
  'import.role.number': 'Sayı',
  'import.role.label': 'Ad',
  'import.role.foreignKey': 'Dış anahtar',
  'import.roleAria': '«{header}» sütununun rolü',
  'import.selectTable': 'Bir tablo seçin…',
  'import.selectColumn': 'Bir sütun seçin…',
  'import.selectFrame': 'Bir çerçeve seçin…',
  'import.groupBy': 'Çerçeveyi şuna göre grupla:',
  'import.warningsFound':
    '{n, plural, one {# satırda ad yerine ham anahtar gösterilecek.} other {# satırda ad yerine ham anahtar gösterilecek.}}',
  'import.parseErrorsBlockValidation': 'Devam etmeden önce yukarıdaki CSV/TSV hatalarını düzeltin.',
  'import.placement.none': 'Tuvale yerleştir, çerçeve yok',
  'import.placement.framePerTable': 'Her tablo için bir çerçeve',
  'import.placement.existingFrame': 'Var olan bir çerçeveye ekle',
  'import.summary':
    '{tables, plural, one {# tablo} other {# tablo}} içe aktarılmaya hazır, {parameters, plural, one {# Parametre} other {# Parametre}} oluşturulacak.',
  'import.next': 'İleri',
  'import.back': 'Geri',
  'import.commit': 'İçe aktar',
  'import.qs.title': 'Hızlı başlangıç',
  'import.qs.toggleAria': 'Hızlı başlangıç — göster ya da gizle',
  'import.qs.lead': 'Bir tablodaki sayıları ayarlanabilir Parametrelere dönüştürün.',
  'import.qs.body':
    'Her satırda benzersiz bir kimlik taşıyan bir sütun gerekir. Sayı olarak işaretlediğiniz her sütun, satır başına bir Parametre verir. Bunları modelinize bağlamak yine size kalır. Hiçbir şey gönderilmez ve tablonuz hiç değişmez.',
  'import.qs.exampleHeading': 'En küçük örnek',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 satır × 2 Sayı sütunu = 4 Parametre',
  'import.qs.useExample': 'Bu örneği kullan',
  'import.qs.tableLimit': '{max} tablo sınırına ulaşıldı — önce bir tablo kaldırın.',
  'import.qs.download': 'Örnek CSV indir',
  'import.qs.fullGuide': 'Tam kılavuz',
  'import.qs.fullGuideAria': 'Tam kılavuz — GitHub’da yeni sekmede açılır',
  'import.qs.sources.summary': 'Google Sheets ya da Excel’den veri çıkarma',
  'import.qs.sources.sheets':
    'Google Sheets: Dosya → İndir → Virgülle ayrılmış değerler (.csv) ya da bir aralık seçip kopyalayın.',
  'import.qs.sources.excel': 'Excel ya da Numbers: Farklı Kaydet / CSV’ye aktar ya da bir aralık kopyalayın.',
  'import.qs.sources.privacy':
    'Özel bir tabloda «Web’de yayınla» kullanmayın — bu, tabloyu bağlantıya sahip herkesin okumasına açar. İndirmek ya da kopyalamak onu özel tutar.',
  'import.qs.notImported.summary': 'İçe aktarılmayanlar',
  'import.qs.notImported.formulas':
    'Formüllerin kendisi içe aktarılmaz — bir CSV ya da yapıştırma yalnızca her hücrenin o anki hesaplanmış değerini taşır.',
  'import.qs.notImported.list':
    'Biçimlendirme, grafikler, birleştirilmiş ya da çok değerli hücreler, .xlsx dosyaları ve canlı eşitleme. Değerlerin nasıl etkileştiğini siz modellersiniz.',
  'import.qs.limits':
    'En çok {tables} tablo, tablo başına {columns} eşlenmiş sütun, tablo başına {rows} satır.',
  'import.roleHelp.title': 'Sütun rolleri',
  'import.roleHelp.key': 'Yenilemede bu satırı eşleştirmek için kullanılan benzersiz kimlik.',
  'import.roleHelp.label': 'Oluşturulan Parametrelerde görünen ad.',
  'import.roleHelp.number': 'Her satır için ayarlanabilir bir Parametre oluşturur.',
  'import.roleHelp.foreignKey': 'Bu değeri, içe aktarılmış başka bir tablodaki bir satıra bağlar.',
  'import.roleHelp.ignored': 'Bu sütunu Loop Studio dışında tut.',
  'import.linkTables.summary': 'Birden çok tabloyu bağla',
  'import.linkTables.body':
    'İkinci bir tablo ekleyin ve öteki tablonun Anahtarına başvurmak için bir sütunu Dış anahtar olarak işaretleyin. O tablonun Adı, oluşturulan adları zenginleştirir. İki Dış anahtarı olan bir tablonun, çerçeveleri hangisinin grupladığını seçmesi gerekir.',
  'import.status.key': 'Anahtar: {header}',
  'import.status.keyNone': 'Anahtar: henüz yok',
  'import.status.keyMany': 'Anahtar: {n} sütun — tam olarak birini seçin',
  'import.status.counts':
    '{cols, plural, one {# Sayı sütunu} other {# Sayı sütunu}} × {rows, plural, one {# satır} other {# satır}} → {n, plural, one {# Parametre} other {# Parametre}}',
  'import.placement.frameHelp': 'Çerçeve, tuvalde düğümleri gruplayan adlandırılmış bir kutudur.',
  'import.placement.noneResult':
    '{n, plural, one {# Parametre} other {# Parametre}} tuvalde, çerçevesiz',
  'import.placement.framePerTableResult':
    '{n, plural, one {# çerçeve} other {# çerçeve}} oluşturulacak',
  'import.placement.noFramesYet': 'Bu tuvalde henüz çerçeve yok',
  'import.review.col.table': 'Tablo',
  'import.review.col.rows': 'Satır',
  'import.review.col.numberColumns': 'Sayı sütunu',
  'import.review.col.parameters': 'Parametre',
  'import.review.col.frames': 'Çerçeve',
  'import.review.lookupOnly': '0 (yalnızca arama)',
  'import.review.total': 'Toplam',
  'import.review.labelsPreview': 'Adlar şöyle görünecek:',
  'import.review.more': '{n, plural, one {… ve # tane daha} other {… ve # tane daha}}',
  'import.issueSummary':
    '{m, plural, one {# tabloda} other {# tabloda}} {n, plural, one {# sorun} other {# sorun}} var. Aşağıda düzeltip yeniden İleri’ye basın.',
  'import.issueSummaryStale':
    'Son denetimden beri girdi değişti — yeniden denetlemek için İleri’ye basın.',
  'import.issueJump': 'Bu hücreye git',
  'import.loc.table': 'Tablo {table}',
  'import.loc.tableRow': 'Tablo {table}, satır {row}',
  'import.loc.tableRowColumn': 'Tablo {table}, satır {row}, sütun {column}',
  'import.loc.tableRowColumnHeader': 'Tablo {table}, satır {row}, sütun {column} ({header})',
  'import.loc.tableColumnHeader': 'Tablo {table}, sütun {column} ({header})',
  'import.issue.table-limit-exceeded': 'Fazla tablo var ({count}, en çok {max}).',
  'import.issue.column-limit-exceeded': 'Fazla eşlenmiş sütun var ({count}, en çok {max}).',
  'import.issue.row-limit-exceeded': 'Fazla satır var ({count}, en çok {max}).',
  'import.issue.invalid-header-row': 'Başlık satırı 1 ya da daha büyük bir tam sayı olmalı.',
  'import.issue.invalid-ignore-rows':
    '«Son N satırı yok say» değeri 0 ya da daha büyük bir tam sayı olmalı.',
  'import.issue.empty-table-name': 'Tablo adı boş.',
  'import.issue.label-too-long': 'Tablo adı fazla uzun (en çok {max} karakter).',
  'import.issue.empty-column-header': 'Bu sütunun başlığı boş.',
  'import.issue.header-too-long': 'Bu sütunun başlığı fazla uzun (en çok {max} karakter).',
  'import.issue.missing-source-column-id':
    'Bu sütunun iç kimliği yok — rolünü yeniden seçin.',
  'import.issue.duplicate-source-table-id':
    'Bu tablonun iç kimliği başka bir tablonunkiyle çakışıyor.',
  'import.issue.missing-key-column':
    'Hiçbir sütun Anahtar olarak işaretlenmemiş. Her satırı tanımlayan sütunda — örneğin bir kimlikte — Anahtar’ı seçin.',
  'import.issue.multiple-key-columns':
    'Birden fazla sütun Anahtar olarak işaretlenmiş — tam olarak bir tane bırakın.',
  'import.issue.empty-key': 'Anahtar boş. Her satırın bir Anahtar değeri olmalı.',
  'import.issue.key-too-long': 'Anahtar fazla uzun (en çok {max} bayt).',
  'import.issue.key-control-char': 'Anahtar bir denetim karakteri içeriyor.',
  'import.issue.duplicate-key':
    '«{value}» anahtarı başka bir satırda kullanılıyor. Her satıra benzersiz bir Anahtar verin.',
  'import.issue.ragged-row':
    'Bu satırda {actual} hücre var; {expected} bekleniyordu. Eksik virgül olup olmadığına bakın; özet satırları «Son N satırı yok say» ile dışarıda bırakılabilir.',
  'import.issue.empty-number': 'Bu hücre boş. Bir sayı girin ya da sütunu Yok say yapın.',
  'import.issue.invalid-number':
    '«{value}» bir sayı değil. Binlik ayırıcıları, para birimi simgelerini ve % işaretini kaldırın, örneğin 4900.',
  'import.issue.orphan-foreign-key': 'Hedef tablodaki hiçbir satırda «{value}» anahtarı yok.',
  'import.issue.missing-fk-target':
    'Bu Dış anahtar sütununun hedef tablosu yok. Sütun başlığının altından başvurduğu tabloyu seçin.',
  'import.issue.invalid-fk-target': 'Bu dış anahtarın hedef tablosu artık yok.',
  'import.issue.missing-group-by':
    'Bu tabloda iki ya da daha çok Dış anahtar sütunu var — çerçeveleri hangisinin grupladığını seçin (başlık satırının altındaki «Çerçeveyi şuna göre grupla»).',
  'import.issue.invalid-group-by':
    'Gruplama sütunu, bu tablonun dış anahtar sütunlarından biri olmalı.',
  'import.issue.round-trip-mismatch':
    'Bu veri güvenle saklanamadı — lütfen sadeleştirip yeniden deneyin.',
  'import.issue.label-fallback':
    'Bu başvuru için bir ad yok — onun yerine ham anahtar gösterilecek.',
  'import.commitError.source-table-id-collision':
    'Aynı iç kimliğe sahip bir tablo zaten var — lütfen içe aktarmayı yineleyin.',
  'import.commitError.parameter-id-collision':
    'Oluşturulan bir kimlik var olan biriyle çakıştı — lütfen içe aktarmayı yineleyin.',
  'import.commitError.frame-placement-failed':
    '«{table}» tablosunun çerçevesi için yer bulunamadı.',
  'import.commitError.frame-not-found': 'Seçilen çerçeve artık yok.',
  'import.commitError.frame-insufficient-space': '«{frame}» içinde yeterli boş yer yok.',
  'import.commitError.invalid-result-graph':
    'Ortaya çıkan grafik geçersiz — lütfen destekle iletişime geçin.',
  'import.menu.import': 'Tablo değerlerini Parametre olarak içe aktar…',
  'import.menu.manage': 'İçe aktarılmış tabloları yenile ya da yönet…',
  'import.menu.guide': 'Bir tablo nasıl hazırlanır…',
  'import.refresh.manageTitle': 'Tablo bağlarını yönet',
  'import.refresh.noBindings': 'Henüz bağlı tablo yok.',
  'import.refresh.rowCount': '{n, plural, one {# satır} other {# satır}}',
  'import.refresh.renameLabel': 'Tablo adı',
  'import.refresh.refreshButton': 'Yenile…',
  'import.refresh.exportCsv': 'Değişiklik önerisi CSV’si dışa aktar',
  'import.refresh.exportBlockedDuplicate':
    'Dışa aktarma engellendi: aynı satır/sütuna birden fazla etkin Parametre bağlı. Dışa aktarmadan önce yinelenen kaydı düzeltin.',
  'import.refresh.title': '«{table}» tablosunu yenile',
  'import.refresh.commit': 'Yenilemeyi uygula',
  'import.refresh.columnEvents.title': 'Sütun değişiklikleri',
  'import.refresh.columnEvents.none':
    'Sütun değişikliği yok — her sütun kendiliğinden eşleşti.',
  'import.refresh.columnEvents.missingHeader':
    '«{header}» sütunu ({role}) yeni veride artık yok.',
  'import.refresh.columnEvents.ambiguousMatch':
    '«{header}» sütunu, gelen birden fazla sütunla eşleşiyor.',
  'import.refresh.columnEvents.unresolved': '— birini seçin —',
  'import.refresh.columnEvents.removedOption': 'Sütun kaldırıldı',
  'import.refresh.columnEvents.mapMore': 'Daha fazla sütun eşle…',
  'import.refresh.columnEvents.unrecognized': '«{header}» sütunu eşlenmemiş.',
  'import.refresh.columnEvents.doNotMap': 'Eşlenmesin',
  'import.refresh.columnEvents.fkTarget': 'Şu tabloya başvurur…',
  'import.refresh.review.added': '{n, plural, one {# satır eklenecek} other {# satır eklenecek}}',
  'import.refresh.review.missing':
    '{n, plural, one {yeni veride # satır eksik} other {yeni veride # satır eksik}}',
  'import.refresh.review.changed':
    '{n, plural, one {# değer kendiliğinden güncellenecek} other {# değer kendiliğinden güncellenecek}}',
  'import.refresh.review.conflicts':
    '{n, plural, one {# değer çakışıyor ve bir seçim gerektiriyor} other {# değer çakışıyor ve bir seçim gerektiriyor}}',
  'import.refresh.review.locallyDeleted':
    '{n, plural, one {# değer yerelde kaldırılmıştı} other {# değer yerelde kaldırılmıştı}}',
  'import.refresh.review.fkRepoints':
    '{n, plural, one {# dış anahtar değişti} other {# dış anahtar değişti}}',
  'import.refresh.review.newColumnValues':
    '{n, plural, one {# yeni sütun değeri eklenecek} other {# yeni sütun değeri eklenecek}}',
  'import.refresh.review.confirmAdd': 'Bu satırı ekle',
  'import.refresh.review.missingChoiceNone': '— seçin —',
  'import.refresh.review.missingChoiceUnlink': 'Olduğu gibi tut, tablodan bağını kopar',
  'import.refresh.review.missingChoiceDelete': 'Sil',
  'import.refresh.review.missingBlocked':
    'Bu satıra hâlâ {table} başvuruyor — önce o tabloyu yenileyin.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Yeni değeri kullan ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Kendi değerimi tut ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Yeni değerle yeniden oluştur ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Vazgeç — bu hücreyi artık izleme',
  'import.refresh.review.fkChoiceAccept': 'Yeni başvuruyu kabul et ({value})',
  'import.refresh.review.fkChoiceReject': 'Eski başvuruyu tut ({value})',
  'import.refresh.duplicateTripleError':
    'Bu veri bozuk: aynı satır ve sütuna birden fazla Parametre bağlı. Bu düzeltilene kadar yenileme engellendi.',
  'import.refresh.commitError.referenced-node':
    'Bu satırın Parametresi silinemiyor — grafikte başka yerlerde hâlâ ona başvuruluyor.',
  'import.refresh.commitError.missing-row-dependency':
    'Bu satırın bağı koparılamıyor ya da silinemiyor — başka bir tablo hâlâ ona başvuruyor.',
  'import.refresh.commitError.placement-failed':
    'Yeni Parametreler için tuvalde yer bulunamadı — görünümü başka bir konuma alıp yeniden deneyin.',
  'import.refreshIssue.table-not-found': 'Bu tablo bağı artık yok.',
  'import.refreshIssue.unresolved-column-event':
    'Devam etmeden önce bu sütun değişikliği için bir seçim gerekiyor.',
  'import.refreshIssue.invalid-column-pairing':
    'Bu sütun seçimi, bekleyen hiçbir sütun değişikliğiyle örtüşmüyor.',
  'import.refreshIssue.key-column-cannot-be-removed':
    'Satır anahtarı sütunu kaldırılamaz — onun yerine gelen başka bir sütuna yeniden adlandırın.',
  'import.refreshIssue.duplicate-column-pairing': 'Bu sütun seçimi bir başkasıyla çakışıyor.',
  'import.refreshIssue.invalid-new-column-pairing':
    'Bu yeni sütunun dış anahtar hedefi geçersiz.',
  'import.refreshIssue.duplicate-source-column-id':
    'Bu sütunun iç kimliği var olan biriyle çakışıyor.',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
