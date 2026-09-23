// docs/localization.md §L3.3 — Inspector slice of the `ru` catalog. The
// node-kind glossary is fixed in `./canvas.ts` (Накопитель · Источник · Сток ·
// Распределитель · Преобразователь · Конец · Параметр · Вычисляемое значение).
//
// `Register` is `Вычисляемое значение` here too — `inspector.register.noStore`,
// `panels.empty.summary`, `regExpr.pick.listLabel`, `regExpr.row.wrongKind`,
// `regExpr.insert.hint` and `regExpr.insert.wrongKind` are 6 of the keys that
// name the kind. `Регистр` is never used.
//
// `шаг` is the simulation timestep. `метка` is the label MODE and the `Label`
// field; a group frame's name is a `рамка` (see `./canvas.ts`).
//
// Wire tokens stay verbatim and are key-scoped in `ruCopy.test.ts`: `all`,
// `2D6`, `S`, the `{kind}` slot in `inspector.edge.kindLink` (it renders the
// raw `resource` / `state` token in EVERY locale), the sample resource names
// `Gold / Energy / XP / Player / Item`, and the `timing` / `when` field names
// in `inspector.labelTiming.unsupported`, which are wire field names printed
// as `timing = {timing}` and are shown untranslated by `ko`, `ja` and `zh`
// as well.

const inspector = {
  'inspector.delete': 'Удалить',
  'inspector.field.label': 'Метка',
  'inspector.empty.title': 'Выберите узел или связь, чтобы изменить их.',
  'inspector.empty.hint':
    'Перетащите элемент с верхней панели на холст, затем протяните связь между точками по краям, чтобы соединить их.',
  'inspector.unreadable.note':
    'Данные этого узла не читаются ({detail}). Он загружен как есть и не участвует в модели — исправьте их в файле или удалите узел.',
  'inspector.unreadable.detailFallback': 'данные не являются читаемым объектом',
  'inspector.field.rawData': 'Исходные данные',
  'enum.activation.passive': 'пассивно',
  'enum.activation.automatic': 'автоматически',
  'enum.activation.onStart': 'при старте',
  'enum.activation.interactive': 'вручную',
  'enum.flowMode.pullAny': 'тянуть из любого',
  'enum.flowMode.pullAll': 'тянуть из всех',
  'enum.flowMode.pushAny': 'толкать в любой',
  'enum.flowMode.pushAll': 'толкать во все',
  'enum.distribution.deterministic': 'детерминированное',
  'enum.distribution.probabilistic': 'вероятностное',
  'enum.format.int': 'целое',
  'enum.format.float': 'дробное',
  'enum.format.percent': 'процент',
  'enum.stateMode.trigger': 'триггер',
  'enum.stateMode.activator': 'активатор',
  'enum.stateMode.label': 'метка',
  'inspector.field.activation': 'Активация',
  'inspector.node.endNote': 'Останавливает выполнение в тот момент, когда до него доходит ресурс.',
  'inspector.field.startingAmount': 'Начальное количество',
  'inspector.field.capacity': 'Ёмкость (пусто = без ограничения)',
  'inspector.number.nonNegativeHint': 'Введите число 0 или больше.',
  'inspector.field.flowMode': 'Режим потока',
  'inspector.field.distribution': 'Распределение',
  'inspector.field.value': 'Значение',
  'inspector.field.unit': 'Единица (справочно)',
  'inspector.field.min': 'Мин. (справочно)',
  'inspector.field.max': 'Макс. (справочно)',
  'inspector.field.step': 'Шаг (справочно)',
  'inspector.field.expression': 'Выражение',
  'inspector.field.format': 'Формат (справочно)',
  'inspector.field.resourceType': 'Тип ресурса (справочно)',
  'inspector.resourceType.placeholder': 'Gold, Energy, XP, Player, Item или своё название',
  'inspector.resourceType.tooLong': 'Больше {max} байт — эта метка будет отброшена при экспорте.',
  'inspector.resourceType.normalised': 'Приведено к «{value}».',
  'inspector.resourceType.custom': 'Свой тип — общий образец, встроенного цвета нет.',
  'inspector.resourceType.mismatch':
    'Несовпадение типов: {pairs}. Только справочно — количества не меняются и выполнение не блокируется.',
  'inspector.parameter.outOfRange':
    'Значение выходит за справочные мин./макс. — оставлено как есть, не обрезано.',
  'inspector.parameter.hintIncoherent':
    'Справочная подсказка противоречива и будет отброшена при экспорте.',
  'inspector.parameter.noPorts':
    'У Параметра нет портов — ссылайтесь на него по id из выражения.',
  'inspector.register.formatInvalid':
    'Формат не распознан — при экспорте будет использовано дробное.',
  'inspector.register.noStore': 'Вычисляемое значение ничего не хранит и не имеет портов.',
  'inspector.edge.kindLink': 'связь {kind}',
  'inspector.field.type': 'Тип',
  'inspector.edge.type.resource': 'resource — переносит ресурсы',
  'inspector.edge.type.state': 'state — читает значение, изменяет получателя',
  'inspector.field.flow': 'Поток',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.edge.flowParam.pickLabel': 'Управлять параметром',
  'inspector.edge.flowParam.literalOption': '— явное значение —',
  'inspector.edge.flowParam.resolved': '= {value}',
  'inspector.edge.flowParam.unknown': 'нет параметра «{id}» — эта связь даёт 0',
  'inspector.edge.flowParam.notParam': '«{id}» не является параметром — эта связь даёт 0',
  'inspector.edge.flowParam.malformed': 'некорректная ссылка на параметр — эта связь даёт 0',
  'inspector.edge.flowParam.hint':
    'Ссылка на параметр хранится по id: переименование параметра ничего не ломает; после удаления ссылка остаётся висящей (она не переписывается).',
  'inspector.field.route': 'Маршрут',
  'inspector.edge.route.curved': 'Кривая',
  'inspector.edge.route.orthogonal': 'Прямоугольный',
  'inspector.edge.note':
    'Изменение связи перезапускает выполнение с шага 0 и снимает отложенные триггеры; завершённый результат Monte Carlo помечается как устаревший.',
  'inspector.field.mode': 'Режим',
  'inspector.edge.mode.trigger': 'триггер — импульс, запускающий получателя',
  'inspector.edge.mode.activator': 'активатор — включает или выключает получателя',
  'inspector.edge.mode.label': 'метка — добавляет к принимающему Накопителю или задаёт его',
  'inspector.field.delay': 'Задержка — шаги до доставки импульса',
  'inspector.delay.ok': 'доставляется на (срабатывание + задержка + 1); 0 означает следующий шаг.',
  'inspector.delay.bad':
    'используйте целое число ≥ 0 — любое другое значение движок выполняет как 0 и не меняет введённое.',
  'inspector.field.condition': 'Условие — сравнение с источником',
  'inspector.field.modifier': 'Модификатор — изменение, применяемое каждый шаг',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect': '{hint} — пока выражение не разобрано, связь не действует.',
  'inspector.activator.describe': 'получатель включён, пока источник {op} {n}',
  'inspector.activator.paramPicker.pickLabel': 'Управлять параметром',
  'inspector.activator.paramPicker.literalOption': '— явное значение —',
  'inspector.activator.offsetLabel': 'Смещение',
  'inspector.activator.preview.resolved':
    'получатель включён, пока источник {op} {threshold} (= {paramLabel}{offsetText}, сейчас {paramValue})',
  'inspector.activator.preview.unknown':
    'нет параметра «{id}» — этот активатор сейчас блокирует получателя',
  'inspector.activator.preview.notParam':
    '«{id}» не является параметром (это {kind}) — этот активатор сейчас блокирует получателя',
  'inspector.activator.preview.nonFinite':
    'параметр «{id}» не является конечным числом — этот активатор сейчас блокирует получателя',
  'inspector.activator.preview.overflow':
    'параметр «{id}» даёт слишком большое число для сравнения — этот активатор сейчас блокирует получателя',
  'inspector.label.describe.set':
    'задаёт принимающему Накопителю значение {amount} на каждом шаге',
  'inspector.label.describe.add': 'добавляет {amount} принимающему Накопителю на каждом шаге',
  'inspector.label.describe.subtract': 'вычитает {amount} из принимающего Накопителя на каждом шаге',
  'inspector.label.amountSource': 'значение исходного Накопителя',
  'inspector.legacy.note':
    'Связь без поддержки. Режим {mode} не выполняется — эта связь не влияет на симуляцию. Loop Studio никогда не преобразует её автоматически; выберите, чем она должна стать, и преобразуйте явно.',
  'inspector.legacy.convertTo': 'Преобразовать в',
  'inspector.legacy.convertButton': 'Преобразовать в {mode}',
  'stateExpr.activator.hint.empty': 'введите сравнение, например >= 5',
  'stateExpr.activator.hint.opOnly': 'добавьте число, например >= 5',
  'stateExpr.activator.hint.notAComparison': 'используйте >= <= > < == != и затем число',
  'stateExpr.activator.hint.nonFinite': 'число должно быть конечным',
  'stateExpr.label.hint.empty': 'введите модификатор, например +1 или =S',
  'stateExpr.label.hint.notAnAssignment': 'используйте + - или = и затем число либо S',
  'stateExpr.label.hint.nonFinite': 'число должно быть конечным',
  'inspector.field.labelTiming': 'Когда применяется',
  'inspector.labelTiming.always': 'Всегда — в начале каждого шага',
  'inspector.labelTiming.afterPull': 'Когда срабатывает источник — после результатов этого шага',
  'inspector.labelTiming.previewAlways': 'Применяется в начале каждого шага.',
  'inspector.labelTiming.previewAfterPull':
    'Применяется, как только источник этой связи сработает на этом шаге, сразу после вычисления результатов шага.',
  'inspector.labelTiming.warnTargetNotPool': 'получателем должен быть Накопитель',
  'inspector.labelTiming.warnModifierInvalid': 'модификатор должен быть корректным значением',
  'inspector.labelTiming.warnSourceNotPool': 'нужен источник-Накопитель',
  'inspector.labelTiming.warnSourceNotRouter':
    'нужен источник: Распределитель, Преобразователь, Сток или Конец',
  'inspector.labelTiming.warnSForm': 'нужно фиксированное число, а не S',
  'inspector.labelTiming.unsupported':
    'У этой связи сочетание времени применения и условия, которое Loop Studio не поддерживает (сейчас: timing = {timing}, when = {when}) — она не действует. Выберите один из двух вариантов выше, чтобы заменить её.',
  'panels.inputs.title': 'Входные данные',
  'panels.summary.title': 'Сводка',
  'panels.inputs.collapse': 'Свернуть панель входных данных',
  'panels.inputs.expand': 'Развернуть панель входных данных',
  'panels.summary.collapse': 'Свернуть панель сводки',
  'panels.summary.expand': 'Развернуть панель сводки',
  'panels.inputs.paramValue': 'Значение «{label}»',
  'panels.inputs.flowVia': 'поток через «{param}»',
  'panels.summary.showCalc': 'Показать вычисление',
  'panels.summary.hideCalc': 'Скрыть вычисление',
  'panels.summary.noValue': '— нет значения на шаге {step}',
  'panels.empty.inputs': 'В этом графе нет Параметров.',
  'panels.empty.summary': 'В этом графе нет Вычисляемых значений.',

  'regExpr.pick.listLabel': 'Сослаться на Накопитель, Параметр или Вычисляемое значение',
  'regExpr.pick.optionAria': '{name}, {kind}, текущее значение {value}',
  'regExpr.pick.noMatch': 'Подходящих узлов нет',
  'regExpr.pick.more': '+{n} ещё — продолжайте вводить',
  'regExpr.block.self': 'нельзя сослаться на себя',
  'regExpr.block.cycle': 'создаст цикл с «{name}»',
  'regExpr.empty': 'Выражение пустое.',
  'regExpr.chip.deleted': '(удалено)',
  'regExpr.chip.wrongKind': '(нельзя использовать)',
  'regExpr.row.unknownRef': '— ссылка «{id}» не найдена',
  'regExpr.row.wrongKind': '— «{name}» не Накопитель, не Параметр и не Вычисляемое значение',
  'regExpr.row.invalidId': '— «{id}» не является корректной ссылкой',
  'regExpr.row.cycle': '— цикл: {name} → … → {name}',
  'regExpr.row.divZero': '→ нельзя делить на 0',
  'regExpr.row.notFinite': '→ не конечное число',
  'regExpr.row.dependsInvalid': '— зависит от некорректной ссылки',
  'regExpr.row.generic': '— {code}',
  'regExpr.insert.title': '＋ Вставить ссылку',
  'regExpr.insert.armedLabel': 'Выбор ссылки',
  'regExpr.insert.hint':
    'Нажмите на Накопитель, Параметр или Вычисляемое значение на холсте, чтобы вставить ссылку.',
  'regExpr.insert.armed':
    'Вставка ссылки готова. Нажмите на узел на холсте или Escape для отмены.',
  'regExpr.insert.cancelled': 'Вставка ссылки отменена.',
  'regExpr.insert.done': 'Вставлена ссылка на «{name}».',
  'regExpr.insert.wrongKind':
    'Вставить можно только Накопитель, Параметр или Вычисляемое значение.',
  'regExpr.op.groupName': 'Кнопки операторов',
  'regExpr.op.add': 'Сложить',
  'regExpr.op.sub': 'Вычесть',
  'regExpr.op.mul': 'Умножить',
  'regExpr.op.div': 'Разделить',
  'regExpr.op.group': 'Скобки',
  'regExpr.op.inserts': '{name} — вставляет {sym} в формулу',
  'regExpr.op.groupTitle': 'Скобки — обернуть выделенную часть или добавить ( )',
  'regExpr.op.inserted': 'Вставлено: {name}',
} as const

export type InspectorKey = keyof typeof inspector
export default inspector
