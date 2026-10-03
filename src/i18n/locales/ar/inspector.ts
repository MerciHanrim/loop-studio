// docs/localization.md §L3.3 — Inspector slice of the `ar` catalog.
// Key-checked against `../en/inspector` by `satisfies`; same `{name}` slots.
//
// GLOSSARY (§L2.24): مَجمَع Pool · مُعامِل Parameter · سِجِلّ Register ·
// بوّابة Gate · مُحوِّل Converter · مصرف Drain · نهاية End · عُقدة node ·
// اتصال connection · تعبير expression · مُفعِّل activator · وسم label-mode.
//
// FROZEN, byte-identical in all 18 catalogs because they are ENGINE SYNTAX
// rendered inside a `dir="ltr"` field, not prose (§L9.3):
//   inspector.edge.flowPlaceholder · inspector.edge.flowParam.resolved ·
//   inspector.expr.activatorPlaceholder · inspector.expr.labelPlaceholder ·
//   regExpr.row.generic
//
// ARROWS, per the meaning units in `scripts/arrow-units.json`:
//   `regExpr.row.divZero` / `regExpr.row.notFinite` carry `result-marker`,
//   which MIRRORS — an Arabic reader meets the marker first, so it is `←`.
//   `regExpr.row.cycle` carries `graph-relation`, which KEEPS `→` in both
//   directions because it names the direction the canvas draws, and the canvas
//   is pinned `ltr`. Both of its arrows stay `→`; this key renders the unit
//   TWICE, which is why the (unit,key) pair count and the glyph count differ.
//
// `inspector.delay.bad` states the comparison IN WORDS rather than with `≥`.
// `≥` is `Bidi_Mirrored`, so inside this Arabic sentence the renderer would
// paint it as `≤` and the message would say the opposite of what it means.
// The catalog may not carry bidi control characters (§L2.x bans LRM/RLM/ALM),
// and prose has no element to pin, so the repair belongs in the wording.
//
// OPEN, to be MEASURED in the browser before this ships: the bare operator run
// in `stateExpr.activator.hint.notAComparison`. Those characters are bidi
// NEUTRAL, so they take the paragraph direction and may reorder among
// themselves. Recorded here rather than guessed at.

const inspector = {
  'inspector.delete': 'حذف',
  'inspector.field.label': 'التسمية',
  'inspector.empty.title': 'حدّد عقدة أو اتصالًا لتحريره.',
  'inspector.empty.hint': 'اسحب عنصرًا من الشريط العلوي إلى اللوحة، ثم اسحب بين النقاط على كل جانب لتوصيلهما.',
  'inspector.unreadable.note':
    'تعذّرت قراءة بيانات هذه العقدة ({detail}). حُمّلت كما هي واستُبعدت من النموذج — أصلحها في الملف، أو احذف العقدة.',
  'inspector.unreadable.detailFallback': 'البيانات ليست كائنًا قابلًا للقراءة',
  'inspector.field.rawData': 'البيانات الخام',
  'enum.activation.passive': 'سلبي',
  'enum.activation.automatic': 'تلقائي',
  'enum.activation.onStart': 'عند البدء',
  'enum.activation.interactive': 'تفاعلي',
  'enum.flowMode.pullAny': 'السحب من أي مصدر',
  'enum.flowMode.pullAll': 'السحب من كل المصادر',
  'enum.flowMode.pushAny': 'الدفع إلى أي هدف',
  'enum.flowMode.pushAll': 'الدفع إلى كل الأهداف',
  'enum.distribution.deterministic': 'حتمي',
  'enum.distribution.probabilistic': 'احتمالي',
  'enum.format.int': 'عدد صحيح',
  'enum.format.float': 'عدد عشري',
  'enum.format.percent': 'نسبة مئوية',
  'enum.stateMode.trigger': 'مُحفِّز',
  'enum.stateMode.activator': 'مُفعِّل',
  'enum.stateMode.label': 'وسم',
  'inspector.field.activation': 'التفعيل',
  'inspector.node.endNote': 'توقف التشغيل لحظة وصول مورد إليها.',
  'inspector.field.startingAmount': 'الكمية الابتدائية',
  'inspector.field.capacity': 'السعة (فارغ = بلا حد)',
  'inspector.number.nonNegativeHint': 'أدخل رقمًا يساوي 0 أو أكبر.',
  'inspector.field.flowMode': 'وضع التدفّق',
  'inspector.field.distribution': 'التوزيع',
  'inspector.field.value': 'القيمة',
  'inspector.field.unit': 'الوحدة (استرشادي)',
  'inspector.field.min': 'الحد الأدنى (استرشادي)',
  'inspector.field.max': 'الحد الأقصى (استرشادي)',
  'inspector.field.step': 'الخطوة (استرشادي)',
  'inspector.field.expression': 'التعبير',
  'inspector.field.format': 'التنسيق (استرشادي)',
  'inspector.field.resourceType': 'نوع المورد (استرشادي)',
  // the five BUILTIN_RESOURCE_TYPES are BYTE-MATCHED model tokens, not prose:
  // a reader has to be able to type them, so every locale keeps them verbatim
  // and translates only the trailing clause.
  'inspector.resourceType.placeholder': 'Gold، Energy، XP، Player، Item، أو اسم مخصّص',
  'inspector.resourceType.tooLong': 'يتجاوز {max} بايت — سيُسقَط هذا الوسم عند التصدير.',
  'inspector.resourceType.normalised': 'طُبّع إلى “{value}”.',
  'inspector.resourceType.custom': 'نوع مخصّص — لون عام؛ لا لون مدمج له.',
  'inspector.resourceType.mismatch': 'عدم تطابق في النوع: {pairs}. استرشادي فقط — لا يغيّر أي كمية ولا يمنع أي تشغيل.',
  'inspector.resourceType.pair': '{edge} على الاتصال و{node} على العقدة',
  'inspector.parameter.outOfRange': 'القيمة خارج الحد الأدنى/الأقصى الاسترشادي — حُفظت كما هي دون تقييد.',
  'inspector.parameter.hintIncoherent': 'أحد التلميحات الاسترشادية غير متّسق وسيُسقَط عند التصدير.',
  'inspector.parameter.noPorts': 'المُعامِل بلا منافذ — أشِر إليه بمعرّفه من داخل تعبير.',
  'inspector.register.formatInvalid': 'تنسيق غير معروف — سيعود إلى العدد العشري عند التصدير.',
  'inspector.register.noStore': 'السِجِلّ لا يخزّن شيئًا وليس له منافذ.',
  'inspector.edge.kindLink': 'رابط {kind}',
  'inspector.field.type': 'النوع',
  'inspector.edge.type.resource': 'مورد — يحمل موارد',
  'inspector.edge.type.state': 'حالة — يقرأ قيمة ويعدّل الهدف',
  'inspector.field.flow': 'التدفّق',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.edge.flowParam.pickLabel': 'القيادة بمُعامِل',
  'inspector.edge.flowParam.literalOption': '— قيمة حرفية —',
  'inspector.edge.flowParam.resolved': '= {value}',
  'inspector.edge.flowParam.unknown': 'لا يوجد مُعامِل باسم “{id}” — مساهمة هذا الاتصال 0',
  'inspector.edge.flowParam.notParam': '“{id}” ليس مُعامِلًا — مساهمة هذا الاتصال 0',
  'inspector.edge.flowParam.malformed': 'ليس مرجع مُعامِل صالحًا — مساهمة هذا الاتصال 0',
  'inspector.edge.flowParam.hint':
    'يُحفظ مرجع المُعامِل بالمعرّف: إعادة تسمية المُعامِل لا تضرّ؛ أما حذفه فيترك المرجع معلّقًا (ولا تُعاد كتابته).',
  'inspector.field.route': 'المسار',
  'inspector.edge.route.curved': 'منحنٍ',
  'inspector.edge.route.orthogonal': 'متعامد',
  'inspector.edge.note':
    'تحرير اتصال يعيد بدء التشغيل من الخطوة 0 ويمسح أي مُحفِّزات معلّقة؛ وتُوسَم أي نتيجة مونت كارلو مكتملة بأنها قديمة.',
  'inspector.field.mode': 'الوضع',
  'inspector.edge.mode.trigger': 'مُحفِّز — نبضة تدفع الهدف للعمل',
  'inspector.edge.mode.activator': 'مُفعِّل — تمكين الهدف أو تعطيله',
  'inspector.edge.mode.label': 'وسم — إضافة إلى المَجمَع الهدف أو ضبطه',
  'inspector.field.delay': 'التأخير — عدد الخطوات قبل تسليم النبضة',
  'inspector.delay.ok': 'يُسلَّم عند (وقت العمل + التأخير + 1)؛ و0 تعني الخطوة التالية.',
  'inspector.delay.bad':
    'استخدم عددًا صحيحًا أكبر من أو يساوي 0 — يشغّل المحرك أي قيمة أخرى كأنها 0 ويترك ما كتبته دون تغيير.',
  'inspector.field.condition': 'الشرط — مقارنة مع المصدر',
  'inspector.field.modifier': 'المعدِّل — تغيير يُطبَّق كل خطوة',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect': '{hint} — إلى أن يُحلَّل، لا أثر لهذا الاتصال.',
  'inspector.activator.describe': 'الهدف مُمكَّن ما دام المصدر {op} {n}',
  'inspector.activator.paramPicker.pickLabel': 'القيادة بمُعامِل',
  'inspector.activator.paramPicker.literalOption': '— قيمة حرفية —',
  'inspector.activator.offsetLabel': 'الإزاحة',
  'inspector.activator.preview.resolved':
    'الهدف مُمكَّن ما دام المصدر {op} {threshold} (= {paramLabel}{offsetText}، وقيمته الحالية {paramValue})',
  'inspector.activator.preview.unknown': 'لا يوجد مُعامِل باسم “{id}” — هذا المُفعِّل يحجب هدفه حاليًا',
  'inspector.activator.preview.notParam': '“{id}” ليس مُعامِلًا (بل {kind}) — هذا المُفعِّل يحجب هدفه حاليًا',
  'inspector.activator.preview.nonFinite': 'المُعامِل “{id}” ليس عددًا منتهيًا — هذا المُفعِّل يحجب هدفه حاليًا',
  'inspector.activator.preview.overflow':
    'المُعامِل “{id}” يُحَل إلى عدد أكبر من أن يُقارَن — هذا المُفعِّل يحجب هدفه حاليًا',
  'inspector.label.describe.set': 'يضبط المَجمَع الهدف على {amount} كل خطوة',
  'inspector.label.describe.add': 'يضيف {amount} إلى المَجمَع الهدف كل خطوة',
  'inspector.label.describe.subtract': 'يطرح {amount} من المَجمَع الهدف كل خطوة',
  'inspector.label.amountSource': 'قيمة المَجمَع المصدر',
  'inspector.legacy.note':
    'اتصال غير مدعوم. الوضع {mode} لا يُنفَّذ — لا أثر لهذا الرابط على المحاكاة. لا يحوّله Loop Studio تلقائيًا أبدًا؛ اختر ما ينبغي أن يصير إليه ثم حوّله صراحةً.',
  'inspector.legacy.convertTo': 'التحويل إلى',
  'inspector.legacy.convertButton': 'التحويل إلى {mode}',
  'stateExpr.activator.hint.empty': 'أدخل مقارنة، مثل >= 5',
  'stateExpr.activator.hint.opOnly': 'أضف رقمًا، مثل >= 5',
  'stateExpr.activator.hint.notAComparison': 'استخدم أحد عوامل المقارنة >= <= > < == != ثم رقمًا',
  'stateExpr.activator.hint.nonFinite': 'يجب أن يكون العدد منتهيًا',
  'stateExpr.label.hint.empty': 'أدخل معدِّلًا، مثل +1 أو =S',
  'stateExpr.label.hint.notAnAssignment': 'استخدم + أو - أو = ثم رقمًا أو S',
  'stateExpr.label.hint.nonFinite': 'يجب أن يكون العدد منتهيًا',
  // docs/label-timing-authoring.md — the label-timing preset control (CSU8 slice 3)
  'inspector.field.labelTiming': 'متى يُطبَّق',
  'inspector.labelTiming.always': 'دائمًا — عند بداية كل خطوة',
  'inspector.labelTiming.afterPull': 'عندما يعمل المصدر — بعد نتائج هذه الخطوة',
  'inspector.labelTiming.previewAlways': 'يُطبَّق عند بداية كل خطوة.',
  'inspector.labelTiming.previewAfterPull': 'يُطبَّق متى عمل مصدر هذا الاتصال في هذه الخطوة، مباشرةً بعد حساب نتائجها.',
  'inspector.labelTiming.warnTargetNotPool': 'يجب أن يكون الهدف مَجمَعًا',
  'inspector.labelTiming.warnModifierInvalid': 'يجب أن يكون المعدِّل قيمة صالحة',
  'inspector.labelTiming.warnSourceNotPool': 'يحتاج إلى مصدر من نوع مَجمَع',
  'inspector.labelTiming.warnSourceNotRouter': 'يحتاج إلى مصدر من نوع بوّابة أو مُحوِّل أو مصرف أو نهاية',
  'inspector.labelTiming.warnSForm': 'يحتاج إلى رقم ثابت، لا S',
  'inspector.labelTiming.unsupported':
    'لهذا الاتصال تركيبة توقيت/شرط لا يدعمها Loop Studio (حاليًا: التوقيت = {timing}، والشرط = {when}) — ولا أثر له حاليًا. اختر أحد الخيارين أعلاه ليحلّ محلّه.',
  'panels.inputs.title': 'المدخلات',
  'panels.summary.title': 'الملخّص',
  'panels.inputs.collapse': 'طيّ لوحة المدخلات',
  'panels.inputs.expand': 'توسيع لوحة المدخلات',
  'panels.summary.collapse': 'طيّ لوحة الملخّص',
  'panels.summary.expand': 'توسيع لوحة الملخّص',
  'panels.inputs.paramValue': 'قيمة {label}',
  'panels.inputs.flowVia': 'التدفّق عبر {param}',
  'panels.summary.showCalc': 'إظهار الحساب',
  'panels.summary.hideCalc': 'إخفاء الحساب',
  'panels.summary.noValue': '— لا قيمة عند الخطوة {step}',
  'panels.empty.inputs': 'لا مُعامِلات في هذا المخطط.',
  'panels.empty.summary': 'لا سِجِلّات في هذا المخطط.',

  // docs/register-expression-authoring.md §RXA3 — the reference-aware Register
  // expression editor: the `@` picker, the two read-back lines, edge-case rows.
  'regExpr.pick.listLabel': 'أشِر إلى مَجمَع أو مُعامِل أو سِجِلّ',
  'regExpr.pick.optionAria': '{name}، {kind}، القيمة الحالية {value}',
  'regExpr.pick.noMatch': 'لا توجد عقدة مطابقة',
  'regExpr.pick.more': '+{n} أخرى — واصل الكتابة',
  'regExpr.block.self': 'لا يمكنه الإشارة إلى نفسه',
  'regExpr.block.cycle': 'سينشئ دورة مع {name}',
  'regExpr.empty': 'التعبير فارغ.',
  'regExpr.chip.deleted': '(محذوف)',
  'regExpr.chip.wrongKind': '(غير قابل للاستخدام)',
  'regExpr.row.unknownRef': '— المرجع "{id}" غير موجود',
  'regExpr.row.wrongKind': '— "{name}" ليس مَجمَعًا ولا مُعامِلًا ولا سِجِلًّا',
  'regExpr.row.invalidId': '— "{id}" ليس مرجعًا صالحًا',
  'regExpr.row.cycle': '— دورة: {name} → … → {name}',
  'regExpr.row.divZero': '← لا يمكن القسمة على 0',
  'regExpr.row.notFinite': '← ليس عددًا منتهيًا',
  'regExpr.row.dependsInvalid': '— يعتمد على مرجع غير صالح',
  'regExpr.row.generic': '— {code}',
  // docs/register-expression-authoring.md §RXA8 — arm-and-click canvas insert
  'regExpr.insert.title': 'إدراج مرجع',
  'regExpr.insert.armedLabel': 'جارٍ اختيار مرجع',
  'regExpr.insert.hint': 'انقر على مَجمَع أو مُعامِل أو سِجِلّ في اللوحة لإدراج مرجعه.',
  'regExpr.insert.armed': 'تهيّأ إدراج المرجع. انقر على عقدة في اللوحة، أو اضغط Escape للإلغاء.',
  'regExpr.insert.cancelled': 'أُلغي إدراج المرجع.',
  'regExpr.insert.done': 'أُدرج مرجع إلى {name}.',
  'regExpr.insert.wrongKind': 'يمكن إدراج مَجمَع أو مُعامِل أو سِجِلّ فقط.',
  // §RXA8b — the operator / parenthesis buttons under the expression input
  'regExpr.op.groupName': 'أزرار العوامل',
  'regExpr.op.add': 'جمع',
  'regExpr.op.sub': 'طرح',
  'regExpr.op.mul': 'ضرب',
  'regExpr.op.div': 'قسمة',
  'regExpr.op.group': 'أقواس',
  'regExpr.op.inserts': '{name} — يُدرج {sym} في الصيغة',
  'regExpr.op.groupTitle': 'أقواس — أحِط الجزء المحدد، أو أضف ( )',
  'regExpr.op.inserted': 'أُدرج {name}',
} as const

export default inspector
