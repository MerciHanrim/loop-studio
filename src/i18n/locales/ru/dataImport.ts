// docs/data-import.md §DI16/§DI17 — the CSV/TSV import wizard, `ru`.
//
// docs/localization.md §L2.11 — `{column}` names TWO things and Russian splits
// them: `import.parseError` is a PARSER position, so it reads `символ`;
// `import.loc.*` is a real table column and reads `столбец`. The two never
// borrow each other's word (`parserLocation.test.ts`).
//
// Every plural writes FOUR arms. `Intl.PluralRules('ru')` has
// `one` / `few` / `many` / `other`, and the split is not by size: `one` takes
// 1, 21, 101 and 1 000 001; `few` takes 2–4, 22–24; `many` takes 0, 5–20 and
// 25–30. So an arm may never spell the numeral out — `one {одна строка}`
// would render "21 одна строка". Every arm keeps `#`.
//
// MEASURED: `other` is unreachable from any non-negative integer (0..3000 and
// 1e6 were swept; only `one`, `few` and `many` appear). It is kept because ICU
// requires it and because a decimal count reaches it — `1.5` selects `other` —
// so its wording is the decimal-agreeing form, not a copy of `few`.
//
// `Intl.NumberFormat('ru')` groups with U+00A0 and uses a comma for the
// decimal mark, so `#` renders `1 234 567`. The separator arrives from the
// FORMATTER, never from a string here.

const dataImport = {
  'import.button': 'Данные ▾',
  'import.title': 'Импорт данных из таблицы',
  'import.tableName': 'Название таблицы',
  'import.removeTable': 'Удалить таблицу',
  'import.addTable': 'Добавить ещё таблицу',
  'import.pastePlaceholder': 'Вставьте сюда текст CSV или TSV',
  'import.pasteAria': 'Текст CSV или TSV',
  'import.tableNameRequired': 'Введите название таблицы, чтобы продолжить.',
  'import.pasteDataRequired': 'Вставьте или загрузите данные CSV/TSV, чтобы продолжить.',
  'import.uploadFile': 'Загрузить файл…',
  'import.delimiter': 'Разделитель',
  'import.delimiterAuto': 'Определить автоматически',
  'import.delimiterComma': 'Запятая',
  'import.delimiterTab': 'Табуляция',
  'import.headerRow': 'Строка заголовков',
  'import.ignoreLastRows': 'Игнорировать последние N строк',
  'import.parseError': 'Этот текст не является корректным CSV/TSV: {kind} в строке {line}, символе {column}.',
  'import.parseErrorKind.unterminated-quote': 'незакрытая кавычка',
  'import.parseErrorKind.text-after-quote': 'неожиданный текст сразу после закрывающей кавычки',
  'import.parseErrorKind.quote-in-unquoted-field': 'кавычка внутри поля без кавычек',
  'import.role.ignored': 'Игнорировать',
  'import.role.key': 'Ключ',
  'import.role.number': 'Число',
  'import.role.label': 'Название',
  'import.role.foreignKey': 'Внешний ключ',
  'import.roleAria': 'Роль столбца «{header}»',
  'import.selectTable': 'Выберите таблицу…',
  'import.selectColumn': 'Выберите столбец…',
  'import.selectFrame': 'Выберите рамку…',
  'import.groupBy': 'Группировать рамку по:',
  'import.warningsFound':
    '{n, plural, one {# строка будет использовать в названии сырой ключ вместо имени.} few {# строки будут использовать в названиях сырой ключ вместо имени.} many {# строк будут использовать в названиях сырой ключ вместо имени.} other {# строки будут использовать в названиях сырой ключ вместо имени.}}',
  'import.parseErrorsBlockValidation': 'Исправьте ошибки CSV/TSV выше, прежде чем продолжить.',
  'import.placement.none': 'Разместить на холсте, без рамок',
  'import.placement.framePerTable': 'По одной рамке на таблицу',
  'import.placement.existingFrame': 'Добавить в существующую рамку',
  'import.summary':
    'Готово к импорту: {tables, plural, one {# таблица} few {# таблицы} many {# таблиц} other {# таблицы}}, {parameters, plural, one {будет создан # Параметр} few {будет создано # Параметра} many {будет создано # Параметров} other {будет создано # Параметра}}.',
  'import.next': 'Далее',
  'import.back': 'Назад',
  'import.commit': 'Импортировать',

  'import.qs.title': 'Быстрый старт',
  'import.qs.toggleAria': 'Быстрый старт — показать или скрыть',
  'import.qs.lead': 'Превратите числа из таблицы в настраиваемые Параметры.',
  'import.qs.body':
    'В каждой строке нужен один столбец с уникальным ID. Каждый столбец, отмеченный как Число, даёт по одному Параметру на строку. Связать их с моделью — отдельный шаг после импорта. Ничего никуда не отправляется, и исходная таблица не меняется.',
  'import.qs.exampleHeading': 'Минимальный пример',
  'import.qs.mapping': 'item_id: {key} · item_name: {label} · price: {number} · drop_rate: {number}',
  'import.qs.result': '2 строки × 2 столбца Число = 4 Параметра',
  'import.qs.useExample': 'Использовать этот пример',
  'import.qs.tableLimit': 'Достигнут предел таблиц: {max} — сначала удалите одну.',
  'import.qs.download': 'Скачать пример CSV',
  'import.qs.fullGuide': 'Полное руководство',
  'import.qs.fullGuideAria': 'Полное руководство — откроется на GitHub в новой вкладке',
  'import.qs.sources.summary': 'Как выгрузить данные из Google Sheets или Excel',
  'import.qs.sources.sheets':
    'Google Sheets: Файл → Скачать → Значения, разделённые запятыми (.csv), либо выделите диапазон и скопируйте.',
  'import.qs.sources.excel': 'Excel или Numbers: Сохранить как / Экспорт в CSV, либо скопируйте диапазон.',
  'import.qs.sources.privacy':
    'Не используйте «Опубликовать в интернете» для приватной таблицы — это делает её доступной всем, у кого есть ссылка. Скачивание или копирование сохраняет приватность.',
  'import.qs.notImported.summary': 'Что не импортируется',
  'import.qs.notImported.formulas':
    'Сами формулы не импортируются — CSV или вставка переносят только текущее вычисленное значение каждой ячейки.',
  'import.qs.notImported.list':
    'Форматирование, диаграммы, объединённые ячейки и ячейки с несколькими значениями, файлы .xlsx и живая синхронизация. Как значения взаимодействуют — моделируете вы сами.',
  'import.qs.limits': 'До {tables} таблиц, {columns} сопоставленных столбцов на таблицу, {rows} строк на таблицу.',

  'import.roleHelp.title': 'Роли столбцов',
  'import.roleHelp.key': 'Уникальный ID, по которому строка сопоставляется при обновлении.',
  'import.roleHelp.label': 'Имя, которое показывается у созданных Параметров.',
  'import.roleHelp.number': 'Создаёт по одному настраиваемому Параметру на каждую строку.',
  'import.roleHelp.foreignKey': 'Связывает это значение со строкой другой импортированной таблицы.',
  'import.roleHelp.ignored': 'Не переносить этот столбец в Loop Studio.',
  'import.linkTables.summary': 'Связать несколько таблиц',
  'import.linkTables.body':
    'Добавьте вторую таблицу и отметьте столбец как Внешний ключ, чтобы сослаться на Ключ другой таблицы. Её Название тогда обогащает создаваемые имена. Таблица с двумя Внешними ключами должна указать, какой из них группирует рамки.',

  'import.status.key': 'Ключ: {header}',
  'import.status.keyNone': 'Ключ: пока не выбран',
  'import.status.keyMany': 'Ключ: отмечено больше одного столбца ({n}) — выберите ровно один',
  'import.status.counts':
    '{cols, plural, one {# столбец Число} few {# столбца Число} many {# столбцов Число} other {# столбца Число}} × {rows, plural, one {# строка} few {# строки} many {# строк} other {# строки}} → {n, plural, one {# Параметр} few {# Параметра} many {# Параметров} other {# Параметра}}',

  'import.placement.frameHelp': 'Рамка — это подписанная область, которая группирует узлы на холсте.',
  'import.placement.noneResult':
    '{n, plural, one {# Параметр} few {# Параметра} many {# Параметров} other {# Параметра}} на холсте, без рамок',
  'import.placement.framePerTableResult':
    '{n, plural, one {будет создана # рамка} few {будет создано # рамки} many {будет создано # рамок} other {будет создано # рамки}}',
  'import.placement.noFramesYet': 'На этом холсте пока нет рамок',

  'import.review.col.table': 'Таблица',
  'import.review.col.rows': 'Строки',
  'import.review.col.numberColumns': 'Столбцы Число',
  'import.review.col.parameters': 'Параметры',
  'import.review.col.frames': 'Рамки',
  'import.review.lookupOnly': '0 (только для связей)',
  'import.review.total': 'Итого',
  'import.review.labelsPreview': 'Названия будут выглядеть так:',
  'import.review.more':
    '{n, plural, one {… и ещё #} few {… и ещё #} many {… и ещё #} other {… и ещё #}}',

  'import.issueSummary':
    '{n, plural, one {# проблема} few {# проблемы} many {# проблем} other {# проблемы}} в {m, plural, one {# таблице} few {# таблицах} many {# таблицах} other {# таблицах}}. Исправьте их ниже и снова нажмите «Далее».',
  'import.issueSummaryStale': 'Входные данные изменились с последней проверки — нажмите «Далее», чтобы проверить снова.',
  'import.issueJump': 'Перейти к этой ячейке',

  'import.loc.table': 'Таблица {table}',
  'import.loc.tableRow': 'Таблица {table}, строка {row}',
  'import.loc.tableRowColumn': 'Таблица {table}, строка {row}, столбец {column}',
  'import.loc.tableRowColumnHeader': 'Таблица {table}, строка {row}, столбец {column} ({header})',
  'import.loc.tableColumnHeader': 'Таблица {table}, столбец {column} ({header})',

  'import.issue.table-limit-exceeded': 'Слишком много таблиц ({count}, максимум {max}).',
  'import.issue.column-limit-exceeded': 'Слишком много сопоставленных столбцов ({count}, максимум {max}).',
  'import.issue.row-limit-exceeded': 'Слишком много строк ({count}, максимум {max}).',
  'import.issue.invalid-header-row': 'Строка заголовков должна быть целым числом от 1.',
  'import.issue.invalid-ignore-rows': 'Значение «Игнорировать последние N строк» должно быть целым числом от 0.',
  'import.issue.empty-table-name': 'Название таблицы пустое.',
  'import.issue.label-too-long': 'Название таблицы слишком длинное (максимум {max} символов).',
  'import.issue.empty-column-header': 'Заголовок этого столбца пуст.',
  'import.issue.header-too-long': 'Заголовок этого столбца слишком длинный (максимум {max} символов).',
  'import.issue.missing-source-column-id': 'У этого столбца нет внутреннего id — выберите его роль заново.',
  'import.issue.duplicate-source-table-id': 'Внутренний id этой таблицы совпадает с id другой таблицы.',
  'import.issue.missing-key-column':
    'Ни один столбец не отмечен как Ключ. Отметьте Ключ у столбца, который определяет каждую строку, например ID.',
  'import.issue.multiple-key-columns': 'Как Ключ отмечено больше одного столбца — оставьте ровно один.',
  'import.issue.empty-key': 'Ключ пуст. У каждой строки должно быть значение Ключа.',
  'import.issue.key-too-long': 'Ключ слишком длинный (максимум {max} байт).',
  'import.issue.key-control-char': 'Ключ содержит управляющий символ.',
  'import.issue.duplicate-key': 'Ключ «{value}» уже используется другой строкой. Дайте каждой строке уникальный Ключ.',
  'import.issue.ragged-row':
    'В этой строке ячеек: {actual}, ожидалось: {expected}. Проверьте, не пропущена ли запятая; итоговые строки можно отбросить через «Игнорировать последние N строк».',
  'import.issue.empty-number': 'Эта ячейка пуста. Введите число или переключите столбец на Игнорировать.',
  'import.issue.invalid-number':
    '«{value}» не является числом. Уберите разделители тысяч, символы валют и %, например 4900.',
  'import.issue.orphan-foreign-key': 'Ни в одной строке целевой таблицы нет ключа «{value}».',
  'import.issue.missing-fk-target':
    'У этого столбца Внешний ключ нет целевой таблицы. Выберите таблицу, на которую он ссылается, под заголовком столбца.',
  'import.issue.invalid-fk-target': 'Целевая таблица для этого внешнего ключа больше не существует.',
  'import.issue.missing-group-by':
    'В этой таблице два или более столбца Внешний ключ — выберите, какой из них группирует рамки («Группировать рамку по» под строкой заголовков).',
  'import.issue.invalid-group-by': 'Столбец группировки должен быть одним из столбцов внешнего ключа этой таблицы.',
  'import.issue.round-trip-mismatch': 'Эти данные не удалось сохранить безопасно — упростите их и попробуйте снова.',
  'import.issue.label-fallback': 'Для этой ссылки нет имени — вместо него будет показан сырой ключ.',

  'import.commitError.source-table-id-collision':
    'Таблица с таким внутренним id уже существует — повторите импорт.',
  'import.commitError.parameter-id-collision':
    'Созданный id совпал с уже существующим — повторите импорт.',
  'import.commitError.frame-placement-failed': 'Не удалось найти место для рамки таблицы «{table}».',
  'import.commitError.frame-not-found': 'Выбранной рамки больше не существует.',
  'import.commitError.frame-insufficient-space': 'В «{frame}» недостаточно свободного места.',
  'import.commitError.invalid-result-graph': 'Получившийся граф некорректен — обратитесь в поддержку.',

  'import.menu.import': 'Импортировать значения из таблицы как Параметры…',
  'import.menu.manage': 'Обновить импортированные таблицы или управлять ими…',
  'import.menu.guide': 'Как подготовить таблицу…',
  'import.refresh.manageTitle': 'Управление связями с таблицами',
  'import.refresh.noBindings': 'Пока нет связанных таблиц.',
  'import.refresh.rowCount':
    '{n, plural, one {# строка} few {# строки} many {# строк} other {# строки}}',
  'import.refresh.renameLabel': 'Название таблицы',
  'import.refresh.refreshButton': 'Обновить…',
  'import.refresh.exportCsv': 'Экспортировать CSV с предлагаемыми изменениями',
  'import.refresh.exportBlockedDuplicate':
    'Экспорт заблокирован: на одну и ту же строку и столбец приходится больше одного активного Параметра. Исправьте дубликат перед экспортом.',
  'import.refresh.title': 'Обновление «{table}»',
  'import.refresh.commit': 'Применить обновление',

  'import.refresh.columnEvents.title': 'Изменения столбцов',
  'import.refresh.columnEvents.none': 'Изменений столбцов нет — все столбцы сопоставились автоматически.',
  'import.refresh.columnEvents.missingHeader': 'Столбца «{header}» ({role}) больше нет в новых данных.',
  'import.refresh.columnEvents.ambiguousMatch': 'Столбец «{header}» соответствует более чем одному новому столбцу.',
  'import.refresh.columnEvents.unresolved': '— выберите один —',
  'import.refresh.columnEvents.removedOption': 'Столбец удалён',
  'import.refresh.columnEvents.mapMore': 'Сопоставить ещё столбцы…',
  'import.refresh.columnEvents.unrecognized': 'Столбец «{header}» не сопоставлен.',
  'import.refresh.columnEvents.doNotMap': 'Не сопоставлять',
  'import.refresh.columnEvents.fkTarget': 'Ссылается на таблицу…',

  'import.refresh.review.added':
    '{n, plural, one {будет добавлена # строка} few {будет добавлено # строки} many {будет добавлено # строк} other {будет добавлено # строки}}',
  'import.refresh.review.missing':
    '{n, plural, one {в новых данных не хватает # строки} few {в новых данных не хватает # строк} many {в новых данных не хватает # строк} other {в новых данных не хватает # строки}}',
  'import.refresh.review.changed':
    '{n, plural, one {# значение обновится автоматически} few {# значения обновятся автоматически} many {# значений обновятся автоматически} other {# значения обновятся автоматически}}',
  'import.refresh.review.conflicts':
    '{n, plural, one {# значение конфликтует и требует выбора} few {# значения конфликтуют и требуют выбора} many {# значений конфликтуют и требуют выбора} other {# значения конфликтуют и требуют выбора}}',
  'import.refresh.review.locallyDeleted':
    '{n, plural, one {# значение было удалено локально} few {# значения были удалены локально} many {# значений были удалены локально} other {# значения были удалены локально}}',
  'import.refresh.review.fkRepoints':
    '{n, plural, one {# внешний ключ изменился} few {# внешних ключа изменились} many {# внешних ключей изменились} other {# внешних ключа изменились}}',
  'import.refresh.review.newColumnValues':
    '{n, plural, one {будет добавлено # новое значение столбца} few {будет добавлено # новых значения столбца} many {будет добавлено # новых значений столбца} other {будет добавлено # новых значения столбца}}',
  'import.refresh.review.confirmAdd': 'Добавить эту строку',
  'import.refresh.review.missingChoiceNone': '— выберите —',
  'import.refresh.review.missingChoiceUnlink': 'Оставить как есть, отвязать от таблицы',
  'import.refresh.review.missingChoiceDelete': 'Удалить',
  'import.refresh.review.missingBlocked': 'На неё всё ещё ссылается {table} — сначала обновите ту таблицу.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Взять новое значение ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Оставить моё значение ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate': 'Создать заново с новым значением ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard': 'Отбросить — больше не отслеживать эту ячейку',
  'import.refresh.review.fkChoiceAccept': 'Принять новую ссылку ({value})',
  'import.refresh.review.fkChoiceReject': 'Оставить прежнюю ссылку ({value})',

  'import.refresh.duplicateTripleError':
    'Эти данные повреждены: к одной и той же строке и столбцу привязано больше одного Параметра. Обновление заблокировано, пока это не исправлено.',
  'import.refresh.commitError.referenced-node':
    'Нельзя удалить Параметр этой строки — на него всё ещё есть ссылки в графе.',
  'import.refresh.commitError.missing-row-dependency':
    'Нельзя отвязать или удалить эту строку — на неё всё ещё ссылается другая таблица.',
  'import.refresh.commitError.placement-failed':
    'Не удалось найти место на холсте для новых Параметров — попробуйте снова из другой позиции просмотра.',

  'import.refreshIssue.table-not-found': 'Этой связи с таблицей больше не существует.',
  'import.refreshIssue.unresolved-column-event': 'Для этого изменения столбца нужно сделать выбор, прежде чем продолжить.',
  'import.refreshIssue.invalid-column-pairing': 'Этот выбор столбца не соответствует ни одному ожидающему изменению.',
  'import.refreshIssue.key-column-cannot-be-removed':
    'Столбец ключа строки нельзя удалить — переименуйте его в другой новый столбец.',
  'import.refreshIssue.duplicate-column-pairing': 'Этот выбор столбца конфликтует с другим.',
  'import.refreshIssue.invalid-new-column-pairing': 'У этого нового столбца некорректная цель внешнего ключа.',
  'import.refreshIssue.duplicate-source-column-id': 'Внутренний id этого столбца совпадает с существующим.',
} as const

export type DataImportKey = keyof typeof dataImport
export default dataImport
