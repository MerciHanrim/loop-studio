// docs/data-import.md §DI16 Phase 1B / §DI17 — data-import slice of the `ar`
// catalog. Key-checked against `../en/dataImport` by `satisfies`; same slots.
//
// GLOSSARY (§L2.24): مُعامِل Parameter · مَجمَع Pool · إطار frame · جدول table ·
// صف row · عمود column · مفتاح Key · مفتاح خارجي Foreign key · وسم Label ·
// تحديث refresh · ربط binding.
//
// ARROWS, per `scripts/arrow-units.json`:
//   `import.qs.sources.sheets` carries `menu-path` TWICE — a path read in the
//   reading direction, so both become `←`.
//   `import.status.counts` carries `derivation`, also a mirror unit: `←`.
//   `import.qs.sources.excel` has NO arrow. English has none; `ja` and `ko`
//   each added one as a locale-local choice. Nothing requires Arabic to, and
//   Hanrim decided it does not — so the conditional stays unexercised here, and
//   `scripts/check-arrow-direction.mjs` asserts that Arabic's count is zero rather
//   than merely observing it.
//   TWO TOTALS, and they are different units:
//     contract pairs     18 x 22 + 2 = 398   (locale, unit, key) triples checked
//     glyph occurrences  18 x 24 + 2 = 434   arrow characters in those values
//   24 and not 22 because `import.qs.sources.sheets` carries its `menu-path`
//   arrow TWICE (`ملف ← تنزيل ←`) and `regExpr.row.cycle` its `graph-relation`
//   arrow twice. Presence-checking passed a value whose SECOND arrow was wrong —
//   MEASURED on this tree — so the rule counts now.
//   `import.button` carries `disclosure-vertical`, a KEEP unit: `▾` unchanged.
//
// SETTLED (C3.5) — `import.qs.mapping` keeps the four column names verbatim, and
// that is a decision with evidence rather than a default. The held premise was
// "14 of 17 keep it and 3 translate"; re-read, EVERY locale keeps the names, and
// the three that looked different vary only in punctuation (`zh-Hans`/`zh-Hant`
// use the fullwidth `：`, `fr` spaces its ` : `).
//   `item_id`, `item_name`, `price`, `drop_rate` are the HEADER ROW of
//   `EXAMPLE_CSV` — the text the guide's "Use this example" button pastes and the
//   sample file the download button writes. Translating one would make this
//   sentence describe a column the example does not contain.
//   Pinned by `scripts/example-columns.test.ts`, which reads the header row out of
//   `DataImportWizard.tsx` with the parser so the list exists once.
//   ARROW accounting: zero arrows, so the arrow contract does not govern it. The
//   translation decision and the arrow accounting are different axes.
//
// PLURALS carry Arabic's six arms throughout. `import.status.counts` holds
// THREE independent plural blocks (`cols`, `rows`, `n`), each six-armed.

const dataImport = {
  'import.button': 'البيانات ▾',
  'import.title': 'استيراد بيانات جدول بيانات',
  'import.tableName': 'اسم الجدول',
  'import.removeTable': 'إزالة الجدول',
  'import.addTable': 'إضافة جدول آخر',
  'import.pastePlaceholder': 'ألصِق نص CSV أو TSV هنا',
  'import.pasteAria': 'نص CSV أو TSV',
  'import.tableNameRequired': 'أدخل اسم الجدول للمتابعة.',
  'import.pasteDataRequired': 'ألصِق بيانات CSV/TSV أو ارفعها للمتابعة.',
  'import.uploadFile': 'رفع ملف…',
  'import.delimiter': 'الفاصل',
  'import.delimiterAuto': 'كشف تلقائي',
  'import.delimiterComma': 'فاصلة',
  'import.delimiterTab': 'جدولة',
  'import.headerRow': 'صف الترويسة',
  'import.ignoreLastRows': 'تجاهل آخر N صفًا',
  'import.parseError': 'هذا النص ليس CSV/TSV صالحًا: {kind} في السطر {line}، الموضع {column}.',
  'import.parseErrorKind.unterminated-quote': 'علامة اقتباس غير مغلقة',
  'import.parseErrorKind.text-after-quote': 'نص غير متوقّع مباشرة بعد علامة اقتباس مغلقة',
  'import.parseErrorKind.quote-in-unquoted-field': 'علامة اقتباس داخل حقل غير مقتبس',
  'import.role.ignored': 'تجاهل',
  'import.role.key': 'مفتاح',
  'import.role.number': 'رقم',
  'import.role.label': 'تسمية',
  'import.role.foreignKey': 'مفتاح خارجي',
  'import.roleAria': 'دور العمود {header}',
  'import.selectTable': 'اختر جدولًا…',
  'import.selectColumn': 'اختر عمودًا…',
  'import.selectFrame': 'اختر إطارًا…',
  'import.groupBy': 'تجميع الإطار حسب:',
  'import.warningsFound':
    '{n, plural, zero {لن يستخدم أي صف مفتاحًا خامًا بدل الاسم في تسميته.} one {صف واحد سيستخدم مفتاحًا خامًا بدل الاسم في تسميته.} two {صفان سيستخدمان مفتاحًا خامًا بدل الاسم في تسميتهما.} few {# صفوف ستستخدم مفتاحًا خامًا بدل الاسم في تسمياتها.} many {# صفًا ستستخدم مفتاحًا خامًا بدل الاسم في تسمياتها.} other {# صف ستستخدم مفتاحًا خامًا بدل الاسم في تسمياتها.}}',
  'import.parseErrorsBlockValidation': 'أصلح أخطاء CSV/TSV أعلاه قبل المتابعة.',
  'import.placement.none': 'الوضع على اللوحة، بلا إطارات',
  'import.placement.framePerTable': 'إطار واحد لكل جدول',
  'import.placement.existingFrame': 'الإضافة إلى إطار موجود',
  'import.summary':
    'جاهز لاستيراد {tables, plural, zero {لا جداول} one {جدول واحد} two {جدولين} few {# جداول} many {# جدولًا} other {# جدول}}، وإنشاء {parameters, plural, zero {لا مُعامِلات} one {مُعامِل واحد} two {مُعامِلين} few {# مُعامِلات} many {# مُعامِلًا} other {# مُعامِل}}.',
  'import.next': 'التالي',
  'import.back': 'رجوع',
  'import.commit': 'استيراد',

  // §DI17 -- the quick start block
  'import.qs.title': 'بداية سريعة',
  'import.qs.toggleAria': 'بداية سريعة — إظهار أو إخفاء',
  'import.qs.lead': 'حوّل الأرقام في جدول بيانات إلى مُعامِلات قابلة للضبط.',
  'import.qs.body':
    'يحتاج كل صف إلى عمود واحد بمعرّف فريد. وكل عمود تضع دوره رقمًا يصير مُعامِلًا واحدًا لكل صف. أما ربطها بنموذجك فيبقى خطوتك أنت بعد ذلك. لا يُرفع شيء، ولا يُغيَّر جدول بياناتك أبدًا.',
  'import.qs.exampleHeading': 'مثال مختصر',
  // HELD — see the file header. English value, decision not taken.
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 صف × 2 عمود أرقام = 4 مُعامِلات',
  'import.qs.useExample': 'استخدام هذا المثال',
  'import.qs.tableLimit': 'بُلغ حد الجداول {max} — أزِل جدولًا أولًا.',
  'import.qs.download': 'تنزيل ملف CSV نموذجي',
  'import.qs.fullGuide': 'الدليل الكامل',
  'import.qs.fullGuideAria': 'الدليل الكامل — يفتح على GitHub في تبويب جديد',
  'import.qs.sources.summary': 'إخراج البيانات من Google Sheets أو Excel',
  'import.qs.sources.sheets': 'Google Sheets: ملف ← تنزيل ← قيم مفصولة بفواصل (.csv)، أو حدّد نطاقًا وانسخه.',
  'import.qs.sources.excel': 'Excel أو Numbers: حفظ باسم أو تصدير إلى CSV، أو انسخ نطاقًا.',
  'import.qs.sources.privacy':
    'لا تستخدم "النشر على الويب" على ورقة خاصة — فذلك يجعلها قابلة للقراءة لأي شخص يملك الرابط. أما التنزيل أو النسخ فيُبقيها خاصة.',
  'import.qs.notImported.summary': 'ما لا يُستورَد',
  'import.qs.notImported.formulas': 'الصيغ نفسها لا تُستورَد — ملف CSV أو اللصق يحمل القيمة المحسوبة الحالية لكل خلية فقط.',
  'import.qs.notImported.list':
    'التنسيق والرسوم البيانية والخلايا المدمجة أو متعددة القيم وملفات xlsx والمزامنة الحية. أما كيفية تفاعل القيم فتنمذجها أنت.',
  'import.qs.limits': 'حتى {tables} جدولًا، و{columns} عمودًا مرتبطًا لكل جدول، و{rows} صفًا لكل جدول.',

  // §DI17 -- the shared role help (rendered ONCE per dialog; each role
  // select points at its role's line via aria-describedby)
  'import.roleHelp.title': 'أدوار الأعمدة',
  'import.roleHelp.key': 'معرّف فريد يُستخدم لمطابقة هذا الصف عند التحديث.',
  'import.roleHelp.label': 'الاسم المعروض على المُعامِلات المولَّدة.',
  'import.roleHelp.number': 'ينشئ مُعامِلًا واحدًا قابلًا للضبط لكل صف.',
  'import.roleHelp.foreignKey': 'يربط هذه القيمة بصف في جدول مستورد آخر.',
  'import.roleHelp.ignored': 'أبقِ هذا العمود خارج Loop Studio.',
  'import.linkTables.summary': 'ربط عدة جداول',
  'import.linkTables.body':
    'أضِف جدولًا ثانيًا وضع دور أحد أعمدته مفتاحًا خارجيًا ليشير إلى مفتاح الجدول الآخر. عندها تُثري تسميته الأسماء المولَّدة. والجدول الذي له مفتاحان خارجيان عليه أن يختار أيّهما يجمّع الإطارات.',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': 'المفتاح: {header}',
  'import.status.keyNone': 'المفتاح: لا شيء بعد',
  'import.status.keyMany': 'المفتاح: {n} أعمدة — اختر عمودًا واحدًا بالضبط',
  'import.status.counts':
    '{cols, plural, zero {لا أعمدة أرقام} one {عمود أرقام واحد} two {عمودا أرقام} few {# أعمدة أرقام} many {# عمود أرقام} other {# عمود أرقام}} × {rows, plural, zero {لا صفوف} one {صف واحد} two {صفان} few {# صفوف} many {# صفًا} other {# صف}} ← {n, plural, zero {لا مُعامِلات} one {مُعامِل واحد} two {مُعامِلان} few {# مُعامِلات} many {# مُعامِلًا} other {# مُعامِل}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp': 'الإطار صندوق مُسمّى يجمّع العقد على اللوحة.',
  'import.placement.noneResult':
    '{n, plural, zero {لا مُعامِلات} one {مُعامِل واحد} two {مُعامِلان} few {# مُعامِلات} many {# مُعامِلًا} other {# مُعامِل}} على اللوحة، بلا إطارات',
  'import.placement.framePerTableResult':
    '{n, plural, zero {لن تُنشأ إطارات} one {سيُنشأ إطار واحد} two {سيُنشأ إطاران} few {ستُنشأ # إطارات} many {سيُنشأ # إطارًا} other {سيُنشأ # إطار}}',
  'import.placement.noFramesYet': 'لا إطارات على هذه اللوحة بعد',

  // §DI17 -- the review breakdown
  'import.review.col.table': 'الجدول',
  'import.review.col.rows': 'الصفوف',
  'import.review.col.numberColumns': 'أعمدة الأرقام',
  'import.review.col.parameters': 'المُعامِلات',
  'import.review.col.frames': 'الإطارات',
  'import.review.lookupOnly': '0 (للبحث فقط)',
  'import.review.total': 'الإجمالي',
  'import.review.labelsPreview': 'ستبدو التسميات هكذا:',
  'import.review.more':
    '{n, plural, zero {…ولا مزيد} one {…وواحد آخر} two {…واثنان آخران} few {…و# أخرى} many {…و# أخرى} other {…و# أخرى}}',

  // §DI17 -- inline validation errors (no separate step)
  'import.issueSummary':
    '{n, plural, zero {لا مشكلات} one {مشكلة واحدة} two {مشكلتان} few {# مشكلات} many {# مشكلة} other {# مشكلة}} في {m, plural, zero {لا جداول} one {جدول واحد} two {جدولين} few {# جداول} many {# جدولًا} other {# جدول}}. أصلحها أدناه ثم اضغط التالي مجددًا.',
  'import.issueSummaryStale': 'تغيّر الإدخال منذ آخر فحص — اضغط التالي للفحص مجددًا.',
  'import.issueJump': 'الانتقال إلى هذه الخلية',

  // location composers -- prefixed to an `import.issue.*` / `import.commitError.*`
  // description below, e.g. "Table Items, row 3: <description>".
  'import.loc.table': 'الجدول {table}',
  'import.loc.tableRow': 'الجدول {table}، الصف {row}',
  'import.loc.tableRowColumn': 'الجدول {table}، الصف {row}، العمود {column}',
  'import.loc.tableRowColumnHeader': 'الجدول {table}، الصف {row}، العمود {column} ({header})',
  'import.loc.tableColumnHeader': 'الجدول {table}، العمود {column} ({header})',

  // one description per `IssueCode` (dataImportValidate.ts) -- the location
  // (table/row/column) is composed separately via `import.loc.*` above, so
  // these never repeat it.
  'import.issue.table-limit-exceeded': 'جداول أكثر من اللازم ({count}، والحد الأقصى {max}).',
  'import.issue.column-limit-exceeded': 'أعمدة مرتبطة أكثر من اللازم ({count}، والحد الأقصى {max}).',
  'import.issue.row-limit-exceeded': 'صفوف أكثر من اللازم ({count}، والحد الأقصى {max}).',
  'import.issue.invalid-header-row': 'يجب أن يكون صف الترويسة عددًا صحيحًا قيمته 1 أو أكثر.',
  'import.issue.invalid-ignore-rows': 'يجب أن يكون عدد الصفوف الأخيرة المتجاهلة عددًا صحيحًا قيمته 0 أو أكثر.',
  'import.issue.empty-table-name': 'اسم الجدول فارغ.',
  'import.issue.label-too-long': 'اسم الجدول طويل جدًا (الحد الأقصى {max} حرفًا).',
  'import.issue.empty-column-header': 'ترويسة هذا العمود فارغة.',
  'import.issue.header-too-long': 'ترويسة هذا العمود طويلة جدًا (الحد الأقصى {max} حرفًا).',
  'import.issue.missing-source-column-id': 'ينقص هذا العمود معرّفه الداخلي — أعِد اختيار دوره.',
  'import.issue.duplicate-source-table-id': 'المعرّف الداخلي لهذا الجدول يتعارض مع معرّف جدول آخر.',
  'import.issue.missing-key-column': 'لا عمود مُعلَّم كمفتاح. اختر مفتاحًا على العمود الذي يعرّف كل صف، كالمعرّف.',
  'import.issue.multiple-key-columns': 'أكثر من عمود مُعلَّم كمفتاح — أبقِ عمودًا واحدًا بالضبط.',
  'import.issue.empty-key': 'المفتاح فارغ. كل صف يحتاج إلى قيمة مفتاح.',
  'import.issue.key-too-long': 'المفتاح طويل جدًا (الحد الأقصى {max} بايت).',
  'import.issue.key-control-char': 'يحتوي المفتاح على حرف تحكّم.',
  'import.issue.duplicate-key': 'المفتاح "{value}" مستخدم بالفعل في صف آخر. امنح كل صف مفتاحًا فريدًا.',
  'import.issue.ragged-row':
    'هذا الصف فيه {actual} خلية؛ والمتوقّع {expected}. تحقّق من فاصلة ناقصة؛ ويمكن إسقاط صفوف الإجماليات عبر "تجاهل آخر N صفًا".',
  'import.issue.empty-number': 'هذه الخلية فارغة. أدخل رقمًا، أو اضبط دور العمود على تجاهل.',
  'import.issue.invalid-number': '"{value}" ليس رقمًا. أزِل فواصل الآلاف ورموز العملة وعلامة النسبة، مثل 4900.',
  'import.issue.orphan-foreign-key': 'لا صف في الجدول الهدف يحمل المفتاح "{value}".',
  'import.issue.missing-fk-target': 'لا جدول هدف لعمود المفتاح الخارجي هذا. اختر الجدول الذي يشير إليه أسفل ترويسة العمود.',
  'import.issue.invalid-fk-target': 'الجدول الهدف لهذا المفتاح الخارجي لم يعد موجودًا.',
  'import.issue.missing-group-by':
    'لهذا الجدول عمودان أو أكثر من المفاتيح الخارجية — اختر أيّها يجمّع الإطارات ("تجميع الإطار حسب" أسفل صف الترويسة).',
  'import.issue.invalid-group-by': 'يجب أن يكون عمود التجميع أحد أعمدة المفاتيح الخارجية في هذا الجدول.',
  'import.issue.round-trip-mismatch': 'تعذّر تخزين هذه البيانات بأمان — بسّطها وحاول مجددًا.',
  'import.issue.label-fallback': 'لا اسم متاح لهذا المرجع — سيُعرض المفتاح الخام بدلًا منه.',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision': 'يوجد بالفعل جدول بمعرّف داخلي مطابق — أعِد محاولة الاستيراد.',
  'import.commitError.parameter-id-collision': 'تعارض معرّف مولَّد مع معرّف قائم — أعِد محاولة الاستيراد.',
  'import.commitError.frame-placement-failed': 'تعذّر إيجاد مساحة لإطار "{table}".',
  'import.commitError.frame-not-found': 'الإطار المحدد لم يعد موجودًا.',
  'import.commitError.frame-insufficient-space': 'لا مساحة حرة كافية في "{frame}".',
  'import.commitError.invalid-result-graph': 'المخطط الناتج غير صالح — يرجى التواصل مع الدعم.',

  // docs/data-import.md §DI16 Phase 2 -- the manage-bindings dialog + the
  // 4-step refresh wizard. §DI17 reworded the menu items and added the guide entry.
  'import.menu.import': 'استيراد قيم جدول بيانات كمُعامِلات…',
  'import.menu.manage': 'تحديث الجداول المستوردة أو إدارتها…',
  'import.menu.guide': 'كيفية تجهيز جدول بيانات…',
  'import.refresh.manageTitle': 'إدارة روابط جداول البيانات',
  'import.refresh.noBindings': 'لا جداول بيانات مربوطة بعد.',
  'import.refresh.rowCount':
    '{n, plural, zero {لا صفوف} one {صف واحد} two {صفان} few {# صفوف} many {# صفًا} other {# صف}}',
  'import.refresh.renameLabel': 'اسم الجدول',
  'import.refresh.refreshButton': 'تحديث…',
  'import.refresh.exportCsv': 'تصدير ملف CSV لاقتراح التغييرات',
  'import.refresh.exportBlockedDuplicate':
    'التصدير محجوب: للصف/العمود نفسه أكثر من مُعامِل نشط. أصلح التكرار قبل التصدير.',
  'import.refresh.title': 'تحديث "{table}"',
  'import.refresh.commit': 'تنفيذ التحديث',

  'import.refresh.columnEvents.title': 'تغييرات الأعمدة',
  'import.refresh.columnEvents.none': 'لا تغييرات في الأعمدة — طوبق كل عمود تلقائيًا.',
  'import.refresh.columnEvents.missingHeader': 'العمود "{header}" ({role}) لم يعد في البيانات الجديدة.',
  'import.refresh.columnEvents.ambiguousMatch': 'العمود "{header}" يطابق أكثر من عمود وارد.',
  'import.refresh.columnEvents.unresolved': '— اختر واحدًا —',
  'import.refresh.columnEvents.removedOption': 'أُزيل العمود',
  'import.refresh.columnEvents.mapMore': 'ربط أعمدة أخرى…',
  'import.refresh.columnEvents.unrecognized': 'العمود "{header}" غير مربوط.',
  'import.refresh.columnEvents.doNotMap': 'عدم الربط',
  'import.refresh.columnEvents.fkTarget': 'يشير إلى الجدول…',

  'import.refresh.review.added':
    '{n, plural, zero {لن تُضاف صفوف} one {سيُضاف صف واحد} two {سيُضاف صفان} few {ستُضاف # صفوف} many {سيُضاف # صفًا} other {سيُضاف # صف}}',
  'import.refresh.review.missing':
    '{n, plural, zero {لا صفوف ناقصة من البيانات الجديدة} one {صف واحد ناقص من البيانات الجديدة} two {صفان ناقصان من البيانات الجديدة} few {# صفوف ناقصة من البيانات الجديدة} many {# صفًا ناقصًا من البيانات الجديدة} other {# صف ناقص من البيانات الجديدة}}',
  'import.refresh.review.changed':
    '{n, plural, zero {لن تُحدَّث قيم تلقائيًا} one {ستُحدَّث قيمة واحدة تلقائيًا} two {ستُحدَّث قيمتان تلقائيًا} few {ستُحدَّث # قيم تلقائيًا} many {ستُحدَّث # قيمة تلقائيًا} other {ستُحدَّث # قيمة تلقائيًا}}',
  'import.refresh.review.conflicts':
    '{n, plural, zero {لا قيم متعارضة} one {قيمة واحدة متعارضة وتحتاج إلى اختيار} two {قيمتان متعارضتان وتحتاجان إلى اختيار} few {# قيم متعارضة وتحتاج إلى اختيار} many {# قيمة متعارضة وتحتاج إلى اختيار} other {# قيمة متعارضة وتحتاج إلى اختيار}}',
  'import.refresh.review.locallyDeleted':
    '{n, plural, zero {لم تُزل قيم محليًا} one {أُزيلت قيمة واحدة محليًا} two {أُزيلت قيمتان محليًا} few {أُزيلت # قيم محليًا} many {أُزيلت # قيمة محليًا} other {أُزيلت # قيمة محليًا}}',
  'import.refresh.review.fkRepoints':
    '{n, plural, zero {لم تتغيّر مفاتيح خارجية} one {تغيّر مفتاح خارجي واحد} two {تغيّر مفتاحان خارجيان} few {تغيّرت # مفاتيح خارجية} many {تغيّر # مفتاحًا خارجيًا} other {تغيّر # مفتاح خارجي}}',
  'import.refresh.review.newColumnValues':
    '{n, plural, zero {لن تُضاف قيم أعمدة جديدة} one {ستُضاف قيمة عمود جديدة واحدة} two {ستُضاف قيمتا عمود جديدتان} few {ستُضاف # قيم أعمدة جديدة} many {ستُضاف # قيمة عمود جديدة} other {ستُضاف # قيمة عمود جديدة}}',
  'import.refresh.review.confirmAdd': 'إضافة هذا الصف',
  'import.refresh.review.missingChoiceNone': '— اختر —',
  'import.refresh.review.missingChoiceUnlink': 'الإبقاء كما هو، وفكّ الربط بجدول البيانات',
  'import.refresh.review.missingChoiceDelete': 'حذف',
  'import.refresh.review.missingBlocked': 'لا يزال {table} يشير إليه — حدّث ذلك الجدول أولًا.',
  'import.refresh.review.cellChoiceApplyIncoming': 'استخدام القيمة الجديدة ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'الإبقاء على قيمتي ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'إعادة الإنشاء بالقيمة الجديدة ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'تجاهل — إيقاف تتبّع هذه الخلية',
  'import.refresh.review.fkChoiceAccept': 'قبول المرجع الجديد ({value})',
  'import.refresh.review.fkChoiceReject': 'الإبقاء على المرجع القديم ({value})',

  'import.refresh.duplicateTripleError':
    'هذه البيانات تالفة: أكثر من مُعامِل مرتبط بالصف والعمود نفسيهما. التحديث محجوب حتى يُصلَح هذا.',
  'import.refresh.commitError.referenced-node':
    'تعذّر حذف مُعامِل هذا الصف — لا يزال مشارًا إليه في مكان آخر من المخطط.',
  'import.refresh.commitError.missing-row-dependency': 'تعذّر فكّ ربط هذا الصف أو حذفه — لا يزال جدول آخر يشير إليه.',
  'import.refresh.commitError.placement-failed':
    'تعذّر إيجاد مساحة على اللوحة للمُعامِلات الجديدة — حاول مجددًا من موضع عرض مختلف.',

  // one description per REFRESH-ONLY `RefreshIssueCode` not already covered
  // by an `import.issue.*` entry above (the overlapping codes reuse those
  // verbatim -- same meaning, same wording).
  'import.refreshIssue.table-not-found': 'رابط هذا الجدول لم يعد موجودًا.',
  'import.refreshIssue.unresolved-column-event': 'تغيير العمود هذا يحتاج إلى اختيار قبل المتابعة.',
  'import.refreshIssue.invalid-column-pairing': 'اختيار العمود هذا لا يطابق أي تغيير عمود معلّق.',
  'import.refreshIssue.key-column-cannot-be-removed':
    'لا يمكن إزالة عمود مفتاح الصف — أعِد تسميته إلى عمود وارد مختلف بدلًا من ذلك.',
  'import.refreshIssue.duplicate-column-pairing': 'اختيار العمود هذا يتعارض مع اختيار آخر.',
  'import.refreshIssue.invalid-new-column-pairing': 'هدف المفتاح الخارجي لهذا العمود الجديد غير صالح.',
  'import.refreshIssue.duplicate-source-column-id': 'المعرّف الداخلي لهذا العمود يتعارض مع معرّف قائم.',
} as const

export default dataImport
