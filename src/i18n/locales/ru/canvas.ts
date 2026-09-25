// docs/localization.md §L3.3 — Canvas surface slice of the `ru` catalog.
//
// GLOSSARY, one word per node kind (the 8 x 3 contract in `ruCopy.test.ts`):
//   Pool `Накопитель` · Source `Источник` · Drain `Сток` ·
//   Gate `Распределитель` · Converter `Преобразователь` · End `Конец` ·
//   Parameter `Параметр` · Register `Вычисляемое значение`
//
// `Регистр` is NOT used for Register: in Russian technical writing it reads as
// a CPU register (and, in another sense, as letter case), neither of which is
// what this node does. `Вычисляемое значение` says what it is.
//
// Register: impersonal or infinitive by default; where a sentence needs to
// address the reader it uses lowercase polite `вы`. `ты` / `твой` are never
// introduced, and one screen never mixes the two (`ruCopy.test.ts`).
//
// Keyboard keys stay in LATIN — `Enter`, `Space`, `Delete`, `Backspace`,
// `Esc`, `Escape`, `Shift` — because that is what a Russian keyboard is
// printed with, the same call `ko` / `ja` / `zh` already make. They are
// keycap tokens, not prose, and are key-scoped in the Latin allowlist.
//
// PLURALS have four arms. `one` is NOT just 1: it also selects 21, 101 and
// 1 000 001, so an arm may never spell the numeral out (`одна строка` would
// render as "21 одна строка") — every arm keeps `#`. `other` is unreachable
// from a non-negative integer and is reached only by decimals, so it carries
// the decimal-agreeing form.

const canvas = {
  'palette.pool.name': 'Накопитель',
  'palette.pool.description':
    'Хранит ресурсы и показывает текущее количество. Когда ёмкость заполняется, входящий поток сдерживается.',
  'palette.source.name': 'Источник',
  'palette.source.description':
    'Создаёт новые ресурсы на каждом шаге и отправляет их узлам, которые от него питаются.',
  'palette.drain.name': 'Сток',
  'palette.drain.description':
    'Забирает ресурсы из узлов, к которым подключён, и выводит их из системы.',
  'palette.gate.name': 'Распределитель',
  'palette.gate.description':
    'Делит входящие ресурсы в заданной пропорции или направляет их в одну ветвь, выбранную по вероятности. Ничего не хранит.',
  'palette.converter.name': 'Преобразователь',
  'palette.converter.description':
    'Потребляет входные ресурсы и производит выходные в заданной пропорции. Ничего не хранит.',
  'palette.end.name': 'Конец',
  'palette.end.description': 'Останавливает выполнение, когда до него доходит ресурс.',
  'palette.parameter.name': 'Параметр',
  'palette.parameter.description':
    'Фиксированное число, которое задаётся вручную. У него нет портов, и выражение может ссылаться на него по id.',
  'palette.register.name': 'Вычисляемое значение',
  'palette.register.description':
    'Вычисляет выражение для текущего шага и показывает результат. Ничего не накапливает, ничего не хранит, портов нет.',
  'palette.addAction': 'Нажмите или перетащите на холст, чтобы добавить.',
  'canvas.minimap': 'Мини-карта графа',
  'canvas.minimap.hide': 'Скрыть мини-карту',
  'canvas.minimap.show': 'Показать мини-карту',
  'canvas.lock.lock': 'Заблокировать редактирование — выделение и чтение остаются',
  'canvas.lock.unlock': 'Разблокировать редактирование — перемещение, связи и значения',
  'canvas.focus.on': 'Фокус выключен — нажмите, чтобы сфокусироваться на выбранном узле',
  'canvas.focus.off': 'Фокус включён — нажмите, чтобы показать весь граф',
  'canvas.focus.hint': 'Выберите узел для фокуса',
  'canvas.focus.rowLabel': 'Фокус на выделении',
  'canvas.focus.stateOn': 'Вкл.',
  'canvas.focus.stateOff': 'Выкл.',
  'canvas.panMode.off':
    'Режим перемещения выключен — тяните пустой холст, чтобы сдвинуть вид',
  'canvas.panMode.on': 'Режим перемещения включён — тяните в любом месте, чтобы сдвинуть вид',
  'canvas.panMode.rowLabel': 'Режим перемещения',
  'canvas.filter.open': 'Фильтры — скрывают части графа во время изучения',
  'canvas.filter.close': 'Закрыть панель фильтров',
  'canvas.filter.title': 'Фильтры',
  'canvas.filter.rowLabel': 'Фильтры',
  'canvas.filter.groupEdgeClass': 'Тип связи',
  'canvas.filter.groupResourceType': 'Тип ресурса',
  'canvas.filter.groupNodeKind': 'Вид узла',
  'canvas.filter.edgeClass.resource': 'Ресурс',
  'canvas.filter.edgeClass.state': 'Состояние',
  'canvas.filter.edgeClass.hint': 'Подсказка зависимости',
  'canvas.filter.untyped': 'без типа',
  'canvas.filter.clear': 'Сбросить фильтры',
  // a plain slot, not a plural: the base key has no plural form, and
  // `check:i18n`'s argument-shape rule forbids turning one into the other
  'canvas.filter.hiddenCount': 'скрыто: {n}',
  'canvas.filter.none': 'Ничего не скрыто',
  'canvas.filter.checkboxHint': 'отмечено = скрыто',
  'canvas.nodeKind.source': 'Источник',
  'canvas.nodeKind.pool': 'Накопитель',
  'canvas.nodeKind.gate': 'Распределитель',
  'canvas.nodeKind.converter': 'Преобразователь',
  'canvas.nodeKind.drain': 'Сток',
  'canvas.nodeKind.end': 'Конец',
  'canvas.nodeKind.parameter': 'Параметр',
  'canvas.nodeKind.register': 'Вычисляемое значение',
  'canvas.resetView': 'Сбросить вид — вписать граф и снять фильтры и фокус',
  'canvas.regionSelect.off':
    'Выделить область — тяните по пустому холсту; Shift+перетаскивание тоже работает',
  'canvas.regionSelect.on':
    'Выделить область — идёт выделение; тяните по пустому холсту, Esc для отмены',
  'canvas.regionSelect.count':
    '{n, plural, one {Выбран # узел} few {Выбрано # узла} many {Выбрано # узлов} other {Выбрано # узла}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {Выбран # узел} few {Выбрано # узла} many {Выбрано # узлов} other {Выбрано # узла}} · разблокируйте редактирование, чтобы переместить их',
  'canvas.frame.draw': 'Рамка группы — тяните по пустому холсту, чтобы её нарисовать',
  'canvas.frame.drawing': 'Рамка группы — идёт рисование; тяните по пустому холсту, Esc для отмены',
  'canvas.frame.defaultName': 'Группа {n}',
  'canvas.frame.delete': 'Удалить эту рамку',
  'canvas.frame.suggest':
    'Предложить рамки — примерные прямоугольники вокруг структурно связанных узлов. Только структура, без предметного смысла.',
  'canvas.frame.suggestStale':
    'Предложить рамки — граф изменился; нажмите, чтобы пересчитать предложенные группы',
  'canvas.frame.suggestRow': 'Предложить рамки',
  'canvas.frame.suggestNote':
    'Предложенные структурные группы — они могут не совпадать с тем, как вы разделили бы работу.',
  'canvas.frame.suggestNoteDismiss': 'Скрыть это примечание',
  'canvas.frame.areaName': 'Область {n}',
  'canvas.frame.dismiss': 'Убрать эту предложенную рамку',
  'canvas.frame.clearAll': 'Убрать все рамки',
  'canvas.frame.clearSuggested': 'Убрать предложенные рамки',
  'canvas.frame.clearSuggestedRow': 'Убрать предложенные рамки',
  'canvas.frame.colorRow': 'Цвет рамки',
  'canvas.frame.color.neutral': 'Нейтральный',
  'canvas.frame.color.slate': 'Сланцевый',
  'canvas.frame.color.sage': 'Шалфейный',
  'canvas.frame.color.gold': 'Золотой',
  'canvas.frame.color.violet': 'Фиолетовый',
  'canvas.frame.color.rose': 'Розовый',
  'canvas.frame.props.title': 'Настройки рамки — {label}',
  'canvas.frame.props.name': 'Название',
  'canvas.activity.off':
    'Слой активности выключен — нажмите, чтобы подсветить недавно активные части',
  'canvas.activity.on': 'Слой активности включён — нажмите, чтобы убрать подсветку',
  'canvas.activity.rowLabel': 'Слой активности',
  'canvas.route.invalidFlag': 'некорректный маршрут — точка маршрута находится внутри узла',
  'canvas.edgeLabel.clamp': 'обрезано',
  'canvas.edgeLabel.clamp.title':
    'убрано единственным ограничением принимающего Накопителя в конце фазы 0',
  'canvas.edgeLabel.blocked': 'заблокировано',
  'canvas.edgeLabel.blocked.title':
    'доставлено, но получатель не сработал (неподходящая активация или активатор держал его закрытым)',
  'canvas.edgeLabel.breakdown.title': 'передачи этого шага по этой связи',
  'canvas.edgeLabel.refMissing': 'Ошибка ссылки на Параметр',
  'node.unreadable.title': 'нечитаемый {kind}',
  'node.unreadable.sub': 'данные не читаются — исправьте их в файле',
  'node.invalidFlag': 'Этот узел некорректен',
  'node.aria.invalid': 'некорректен',
  'node.aria.selected': 'выбран',
  'node.aria.focused': 'в фокусе',
  'node.evaluatedCue': 'Вычислен на этом шаге, но не сработал',
  'node.default.pool': 'Накопитель',
  'node.default.source': 'Источник',
  'node.default.drain': 'Сток',
  'node.default.gate': 'Распределитель',
  'node.default.converter': 'Преобразователь',
  'node.default.end': 'Конец',
  'node.default.parameter': 'Параметр',
  'node.default.register': 'Вычисляемое значение',
  'canvas.frame.a11y.roledescription': 'рамка группы',
  'canvas.frame.a11y.roledescriptionAuto': 'предложенная рамка группы',
  'canvas.frame.a11y.name':
    '{label}, {n, plural, one {# узел} few {# узла} many {# узлов} other {# узла}}',
  'canvas.frame.a11y.desc': 'Нажмите Enter или Space, чтобы выбрать эту рамку.',
  'canvas.frame.a11y.descSelected':
    'Выбрана. Стрелки перемещают рамку вместе с содержимым, Shift — более крупным шагом. Backspace или Delete удаляет её. Escape снимает выделение.',
  'canvas.frame.a11y.descReadonly':
    'Только чтение — эту рамку можно выбрать и прочитать, но не изменить.',
  'canvas.frame.a11y.resize':
    'Изменить размер рамки «{label}» — ширина {w}, высота {h}. Стрелки меняют размер, Shift — более крупным шагом.',
  'canvas.frame.a11y.moved': 'Рамка «{label}» перемещена в x {x}, y {y}',
  'canvas.frame.a11y.resized': 'Размер рамки «{label}» изменён: ширина {w}, высота {h}',
  'rf.node.moveCancelled': 'Перемещение отменено. Узел вернулся в x {x}, y {y}',
  'rf.node.moved': 'Выбранный узел перемещён {direction}. Новая позиция: x {x}, y {y}',
  'rf.dir.left': 'влево',
  'rf.dir.right': 'вправо',
  'rf.dir.up': 'вверх',
  'rf.dir.down': 'вниз',
  'rf.controls.label': 'Управление холстом',
  'rf.controls.zoomIn': 'Приблизить',
  'rf.controls.zoomOut': 'Отдалить',
  'rf.controls.fitView': 'Вписать диаграмму в область просмотра',
  'rf.controls.interactive': 'Переключить редактирование холста',
  'rf.handle.label': 'Точка соединения',
  'rf.node.a11y':
    'Нажмите Enter или Space, чтобы выбрать этот узел. Delete удаляет его, Escape отменяет.',
  'rf.node.a11yKeyboard':
    'Нажмите Enter или Space, чтобы выбрать этот узел, затем стрелки для перемещения. Delete удаляет его, Escape отменяет.',
  'rf.edge.a11y':
    'Нажмите Enter или Space, чтобы выбрать эту связь. Delete удаляет её, Escape отменяет.',
} as const

export type CanvasKey = keyof typeof canvas
export default canvas
