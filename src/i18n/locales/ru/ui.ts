// docs/localization.md §L3.3 — UI chrome slice of the `ru` catalog.
//
// The node-kind glossary lives in `./canvas.ts`. `Register` is
// `Вычисляемое значение` everywhere; `Pool` is `Накопитель`. `Template` is
// `Шаблон` and the simulation model is `Модель` (see `./templates.ts`).
//
// Register: impersonal or infinitive by default, lowercase polite `вы` where a
// sentence has to address the reader. `ты` / `твой` are never introduced.
//
// `ё` is written where the standard spelling has it (`ёмкость`, `даёт`,
// `берёт`, `всё`, `идёт`) rather than flattened to `е`. This cannot be fully
// automated without a dictionary, so `ruCopy.test.ts` pins the EXPLICIT LIST
// of words that carry it, and the second vocabulary pass is what keeps the
// list honest (§L2.17).
//
// The six `error.EXPR_*` messages plus `import.parseError` are the CHARACTER
// -offset half of the §L2.11 contract, so they read `символ {column}` — the
// table-column half is `import.loc.*` in `./dataImport.ts` and reads
// `столбец {column}`. Their ICU quoting (a literal brace wrapped in single
// quotes) is reproduced byte-for-byte from `en`; `icuEscaping.test.ts`
// renders them to check it.
//
// `tour.help.feedback` and `…feedbackAria` name the linked form as English,
// the way every other non-English catalog does, and call a browser tab a
// `вкладка` (§L2.11a item 10, `localeSurfaceCopy.test.ts`).
//
// MEASURED: `Intl.NumberFormat('ru', {style:'percent'})` emits a NO-BREAK
// SPACE before the sign (`84 %`), so the two `{pct}` strings carry U+00A0 —
// the same contract `es-ES` needed and the opposite of `pt-BR` / `pt-PT`.
// The character is never written as an escape; `ruCopy.test.ts` asserts the
// code point before `%` is 160 and that exactly those two strings contain it.

const ui = {
  'i18n.messageError': 'текст недоступен ({key})',
  'i18n.loadFailed': 'Не удалось загрузить {language}. Показывается {current}.',
  'toolbar.preview': 'предпросмотр',
  'toolbar.buildTitle': 'Loop Studio v{version} · сборка {sha}',
  'toolbar.undo.title': 'Отменить (Ctrl/Cmd+Z)',
  'toolbar.redo.title': 'Повторить (Ctrl/Cmd+Shift+Z)',
  'toolbar.new': 'Создать',
  'toolbar.import': 'Импорт',
  'toolbar.more': 'Ещё действия',
  'toolbar.newGraph.title': 'Начать новый граф?',
  'toolbar.newGraph.body': 'Текущий граф будет заменён.',
  'toolbar.newGraph.confirm': 'Новый граф',
  'toolbar.file.button': 'Файл ▾',
  'toolbar.file.menuLabel': 'Файл',
  'toolbar.settings.button': 'Настройки ▾',
  'toolbar.settings.menuLabel': 'Настройки',
  'theme.rowLabel': 'Тема',
  'theme.title': 'Тема: системная / светлая / тёмная',
  'theme.auto': '◐ Авто',
  'theme.light': '☀ Светлая',
  'theme.dark': '☾ Тёмная',
  'theme.option.system': 'Авто',
  'theme.option.light': 'Светлая',
  'theme.option.dark': 'Тёмная',
  'theme.menuLabel': 'Тема',
  'lang.rowLabel': 'Язык',
  'lang.title': 'Язык',
  'lang.menuLabel': 'Выберите язык',
  'lang.loading': 'загрузка…',
  'lang.search': 'Поиск языков',
  'lang.noResults': 'Подходящих языков нет',
  'language.english': 'Английский',
  'language.korean': 'Корейский',
  'language.japanese': 'Японский',
  'language.chineseSimplified': 'Китайский (упрощённый)',
  'language.chineseTraditional': 'Китайский (традиционный)',
  'language.french': 'Французский',
  'language.german': 'Немецкий',
  'language.spanishLatinAmerica': 'Испанский (Латинская Америка)',
  'language.portugueseBrazil': 'Португальский (Бразилия)',
  'language.spanishSpain': 'Испанский (Испания)',
  'language.portuguesePortugal': 'Португальский (Португалия)',
  'language.russian': 'Русский',
  'playbar.reset.title': 'Сбросить на шаг 0',
  'playbar.step.title': 'Сделать один шаг',
  'playbar.play': '▶ Запустить',
  'playbar.pause': '⏸ Пауза',
  'playbar.replay': '⟳ Повторить',
  'playbar.step': 'шаг {n}',
  'playbar.stepEnded': 'шаг {n} · завершено',
  'playbar.speed': 'скорость',
  'playbar.seed': 'зерно',
  'playbar.seed.title':
    'Случайное зерно — одно и то же зерно воспроизводит выполнение; при его изменении оно начинается заново',
  'playbar.mc': 'Monte Carlo',
  'playbar.mc.withNote': 'Monte Carlo · {note}',
  'playbar.mc.cancelled': 'Отменено',
  'playbar.mc.failed': 'Выполнение не удалось',
  'playbar.initError': 'Нельзя выполнить: {detail}',
  'playbar.mc.title': 'Выполнить диаграмму много раз и посмотреть распределение',
  // MEASURED: `Intl.NumberFormat('ru', {style:'percent'})` puts a NO-BREAK
  // SPACE before the sign, so this string carries U+00A0 — never an escape
  'playbar.mc.progress': 'Monte Carlo {pct} %',
  'playbar.mc.progress.title': 'Идёт выполнение Monte Carlo',
  'playbar.cancel': 'Отмена',
  'playbar.steady': 'Устойчивое состояние — потоки продолжаются',
  'playbar.timeline.show': 'Показать шкалу времени',
  'playbar.timeline.hide': 'Скрыть шкалу времени',
  'runbar.ariaLabel': 'Управление выполнением',
  'runbar.mc.cancel': 'MC {pct} % · Отмена',
  'runbar.timeline': 'Шкала времени',
  'mobile.topbar.caption': 'просмотр и запуск — редактирование на компьютере',
  'mobile.more': 'Ещё',
  'a11y.playback.started': 'Воспроизведение началось',
  'a11y.playback.endedAtStep': 'Завершено на шаге {n}',
  'a11y.playback.resetToZero': 'Сброшено на шаг 0',
  'a11y.playback.stepN': 'Шаг {n}',
  'a11y.playback.pausedAtStep': 'Пауза на шаге {n}',
  'timeline.title': 'шкала времени',
  'timeline.view.live': 'ВЖИВУЮ',
  'timeline.view.distribution': 'РАСПРЕДЕЛЕНИЕ',
  'timeline.legend.hide': 'Скрыть «{label}»',
  'timeline.legend.show': 'Показать «{label}»',
  'timeline.legend.more': '+{n} ещё',
  'timeline.legend.fewer': 'Показать меньше',
  'timeline.csv': 'CSV',
  'timeline.csvTitle': 'Скачать выполнение в CSV',
  'timeline.axis.step': 'шаг {n}',
  'timeline.sheetTitle': 'Шкала времени',
  'mobile.inspector.title': 'Инспектор — только чтение',
  'mobile.inspector.roNote': 'Редактирование доступно на компьютере. Это режим только для чтения.',
  'error.unknownCode': 'выражение некорректно',
  'error.EXPR_EMPTY.message': 'выражение пустое',
  'error.EXPR_SYNTAX.message': 'синтаксическая ошибка в символе {column}',
  'error.EXPR_UNCLOSED_PAREN.message': '“(” в символе {column} так и не закрыта',
  'error.EXPR_UNCLOSED_REF.message': '“@\'{\'” в символе {column} так и не закрыта',
  'error.EXPR_BAD_ESCAPE.message': '“\\” в символе {column} должен сопровождаться “\'}\'” или “\\”',
  'error.EXPR_NUMBER_RANGE.message': 'число в символе {column} слишком велико',
  'error.EXPR_BAD_TOKEN.message': 'посторонний знак в символе {column}',
  'dialog.cancel': 'Отмена',
  'dialog.close': 'Закрыть',
  'share.button': 'Поделиться',
  'share.button.title': 'Скопировать ссылку, которая открывает эту диаграмму',
  'share.disclosure.title': 'Создать ссылку для доступа?',
  'share.disclosure.body':
    'Ссылка содержит всю эту диаграмму, включая все подписи, — любой, у кого она есть, может открыть и изменить диаграмму. На сервер она не загружается, но передаётся внутри ссылки, поэтому остаётся в истории браузера и видна всем, кому её отправляют.',
  'share.disclosure.confirm': 'Создать ссылку',
  'share.tooLarge':
    'Эта диаграмма слишком велика для ссылки ({size}; предел — {cap}). Используйте Файл ▾ → Graph JSON и поделитесь файлом.',
  'share.replacePrompt':
    'Открыть диаграмму по ссылке? Текущая диаграмма будет заменена. Экспортируйте её заранее, если хотите сохранить.',
  'share.noBase':
    'Для ссылок не настроен публичный адрес, поэтому создать ссылку нельзя. Пожалуйста, сообщите об этом.',
  'share.panel.label': 'Ссылка для доступа',
  'share.panel.copied': 'Ссылка скопирована в буфер обмена.',
  'share.panel.copyThis': 'Скопируйте эту ссылку:',
  'share.panel.copyAgain': 'Скопировать снова',
  'share.panel.copy': 'Копировать',
  'share.panel.close': 'Закрыть',
  'pwa.text':
    'Готова новая версия Loop Studio. Её применение перезагружает приложение и сбрасывает текущее выполнение и несохранённые результаты. Диаграмма сохраняется.',
  'pwa.update': 'Обновить',
  'pwa.dismiss': 'Скрыть',
  'pwa.running.title': 'Идёт выполнение',
  'pwa.running.body':
    'Применение обновления перезагрузит страницу и прервёт текущее выполнение. Всё равно применить?',
  'pwa.running.confirm': 'Применить и перезагрузить',
  'bootNotice.dismiss': 'Скрыть',
  'autosave.failed.quota':
    'Автосохранение остановлено: хранилище этого браузера заполнено, поэтому последние изменения не сохраняются на этом устройстве. Экспортируйте файл, чтобы их сохранить.',
  'autosave.failed.unavailable':
    'Автосохранение недоступно: этот браузер блокирует хранилище, поэтому изменения не сохраняются на этом устройстве. Экспортируйте файл, чтобы их сохранить.',
  'autosave.exportButton': 'Экспортировать Graph JSON',
  'bootNotice.proposalReboot':
    'В этой сессии редактировалось предложение. Основа, из которой оно сделано, не сохранена на этом устройстве, поэтому документ открыт как обычный граф — правки сохранены. Импортируйте файл предложения заново, чтобы просмотреть или переэкспортировать его.',
  'revChip.proposal': 'предложение',
  'revChip.rev': 'ред. {id}',
  'revChip.title': 'Проект {project} · {role} {revision}',
  'revChip.titleDirty':
    'Проект {project} · {role} {revision} · есть несохранённые изменения с этой ревизии',
  'revChip.unsaved': 'несохранённые изменения',
  'import.replace.title': 'Заменить текущую диаграмму?',
  'import.replace.body': 'Импортированный файл заменит то, что сейчас на холсте.',
  'import.replace.confirm': 'Заменить',
  'import.readError': 'Не удалось прочитать этот файл.',
  'import.error.invalidJson': 'Этот файл не является корректным JSON.',
  'import.error.unexpected': 'Неожиданное содержимое файла.',
  'import.error.notLoopStudio': 'Это не похоже на файл графа Loop Studio.',
  'import.error.missingNodesEdges': 'В файле графа отсутствуют узлы или связи.',
  'import.structuralWarning':
    'В этом графе есть структурные проблемы, и эти связи игнорируются:\n{detail}',
  'import.modelLayerUnreadable':
    'Содержимое слоя модели в этом файле не читается ({detail}); его проектные данные проигнорированы.',
  'mobile.more.import': 'Импортировать файл',
  'mobile.more.importSub': 'Graph или Workspace JSON',
  'export.button': 'Экспорт ▾',
  'export.menuLabel': 'Экспорт',
  'export.graphJson.name': 'Graph JSON',
  'export.graphJson.blurb': 'диаграмма + рекомендованные настройки выполнения',
  'export.workspaceJson.name': 'Workspace JSON',
  'export.workspaceJson.blurb': 'граф + распределение + вид + текущее выполнение',
  'export.projectRevision.name': 'Ревизия проекта',
  'export.projectRevision.blurb':
    'диаграмма плюс id проекта и происхождение — для офлайн-работы',
  'export.proposal.name': 'Создать предложение',
  'export.proposal.blurb': 'копия для правок, которую отправляют на просмотр',
  'export.proposal.needRevision': 'Сначала экспортируйте Ревизию проекта',
  'revision.export.noSecureRandom':
    'В этом браузере нет надёжного источника случайности, поэтому нельзя создать идентификатор ревизии. Ничего не экспортировано.',
  'revision.export.tooLarge':
    'Эта диаграмма слишком велика для экспорта как Ревизия проекта ({size}; предел {cap}). Используйте Файл ▾ → Graph JSON.',
  'proposal.needProject':
    'Для создания предложения нужен открытый проект. Сначала создайте его через Файл ▾ → Ревизия проекта.',
  'proposal.dirtyOrigin':
    'Документ изменился с этой ревизии. Зафиксируйте изменения через Файл ▾ → Ревизия проекта, затем создайте предложение.',
  'proposal.tooLarge':
    'Это предложение слишком велико, чтобы отправить одним файлом ({size}; предел {cap}). Обычный Graph JSON по-прежнему работает.',
  'export.author.name': 'Указать автора для экспорта…',
  'export.author.blurb': 'локальная для устройства подпись, прикрепляемая к файлу без проверки',
  'export.projectRevision.disclosure.title': 'Экспортировать Ревизию проекта?',
  'export.projectRevision.disclosure.body':
    'Файл — это обычный Graph JSON, который дополнительно несёт идентичность проекта и происхождение этой ревизии, чтобы коллега мог сравнить и применить ваши изменения полностью офлайн. Ни аккаунта, ни сервера — всё передаётся в файле.',
  'export.projectRevision.disclosure.confirm': 'Экспортировать ревизию',
  'export.workspace.title': 'Сохранить это рабочее пространство?',
  'export.workspace.included': 'Включено: {items}.',
  'export.workspace.excluded': 'Не включено: история отмен, выделение, тема.',
  'export.workspace.confirm': 'Сохранить рабочее пространство',
  'export.workspace.item.runConfig': 'настройки выполнения',
  'export.workspace.item.distribution': 'распределение по {runs} прогонам',
  'export.workspace.item.timeline': 'вид шкалы времени',
  'export.workspace.item.canvas': 'положение холста',
  'export.workspace.item.liveRun': 'текущее выполнение на шаге {step}',
  'export.workspace.omit.body':
    'С распределением получается {full} — больше предела {limit}. Сохранить без распределения ({lean})?',
  'export.workspace.omit.confirm': 'Сохранить без него',
  'export.workspace.reject':
    'Это рабочее пространство занимает {size} — больше предела {limit} даже без распределения. Сократите граф или используйте Graph JSON.',
  'author.title': 'Автор для экспорта',
  'author.name': 'Имя',
  'author.namePlaceholder': 'например, Alex',
  'author.note': 'Примечание (необязательно)',
  'author.notePlaceholder': 'короткое сообщение, которое передаётся вместе с файлом',
  'author.disclosure':
    'Это имя хранится только на этом устройстве. Оно прикрепляется — без проверки — к каждой экспортируемой Ревизии проекта и предложению и передаётся внутри отправляемого файла. Изменить его может кто угодно; считайте его подписью, а не удостоверением.',
  'author.save': 'Сохранить',
  'mc.title': 'Monte Carlo',
  'mc.close': 'Закрыть',
  'mc.closeKeepRunning': 'Закрыть (продолжить выполнение)',
  'mc.field.runs': 'прогоны',
  'mc.field.steps': 'шаги',
  'mc.field.baseSeed': 'базовое зерно',
  'mc.pools.head': 'отслеживаемые накопители',
  'mc.pools.headAll': 'отслеживаются · все накопители',
  'mc.pools.headSome': 'отслеживаются · {n} из {total}',
  'mc.pools.selectAll': 'Выбрать все',
  'mc.pools.none': 'В графе нет Накопителей — добавьте хотя бы один, чтобы запустить выполнение.',
  'mc.pools.group': 'Отслеживаемые Накопители',
  'mc.pools.keepOne': 'Хотя бы один Накопитель должен остаться отслеживаемым.',
  'mc.cost.estimating': 'оценка…',
  'mc.cost.measured': 'Измерено (последний прогон)',
  'mc.cost.benchmark': 'Локальный замер',
  'mc.cost.execution': 'Выполнение',
  'mc.cost.parallel': 'Параллельно, потоков: {workers}',
  'mc.cost.localPause': 'Локально · возможна короткая пауза',
  'mc.cost.local': 'Локально',
  'mc.cost.memory': 'Память',
  'mc.cost.overLimit': ' — сверх предела, уменьшите число прогонов или шагов',
  'mc.run': 'Выполнить прогонов: {runs}',
  'mc.cancel': 'Отмена',
  'review.title': 'Просмотр предложения',
  'review.close': 'Закрыть',
  'review.byPrefix': 'Автор предложения',
  'review.byAnon': 'Предложение',
  'review.unverified': '· без проверки',
  'review.fileSays': 'в файле указано: {stamp}',
  'review.differentProject': 'Идентификатор проекта отличается от открытого.',
  'review.diff.none': 'Изменений графа нет.',
  'review.diff.nodes': 'Узлы',
  'review.diff.edges': 'Связи',
  'review.diff.runConfig': 'настройки выполнения',
  'review.diff.frames': 'рамки',
  'review.gate.wrongProject':
    'Это предложение относится к другому проекту. Его всё ещё можно открыть как документ.',
  'review.gate.noTarget': 'Нет открытого проекта. Откройте это предложение как документ или отмените.',
  'review.gate.targetIsProposal':
    'Сейчас открыто предложение. Экспортируйте его как Ревизию проекта, прежде чем применять поверх другое предложение.',
  'review.gate.versionMismatch':
    'У этого предложения и открытого документа разные версии модели (v1 / v2). Применить его здесь нельзя. Его всё ещё можно открыть как документ.',
  'review.class.exact': 'Открытая ревизия — ровно та основа, из которой сделано это предложение.',
  'review.class.divergent':
    'В открытой ревизии есть изменения, пересекающиеся с этим предложением. Применение всего предложения их отбросит.',
  'review.class.unknown':
    'В открытой ревизии есть изменения, и по файлам нельзя установить, как они связаны. Конфликтов по полям не найдено.',
  'review.confirm.default':
    'Это предложение сделано из более ранней ревизии. Применение всего предложения заменит граф его версией — изменения, сделанные с тех пор, будут потеряны. Отмена возвращает всё назад.',
  'review.confirm.unknown':
    'Это предложение сделано из более ранней ревизии, и по файлам нельзя установить их связь. Применение всего предложения заменит граф его версией — изменения, сделанные с тех пор, будут потеряны. Отмена возвращает всё назад.',
  'review.err.targetMoved':
    'Документ изменился после подтверждения — просмотрите изменение и примените снова.',
  'review.err.targetMovedList':
    'Документ изменился во время выбора — список ниже обновлён. Просмотрите и примените снова.',
  'review.err.noEffect': 'Этот выбор ничего не меняет — применять нечего.',
  'review.err.generic': 'Не удалось применить ({reason}).',
  'review.fail.wrongProject': 'Это предложение относится к другому проекту.',
  'review.fail.noTarget': 'Нет открытого проекта, к которому можно применить.',
  'review.fail.targetIsProposal': 'Сначала экспортируйте открытое предложение как Ревизию проекта.',
  'review.fail.versionMismatch':
    'У этого предложения и открытого документа разные версии модели (v1 / v2), поэтому применить его здесь нельзя.',
  'review.fail.payloadInvalid':
    'Файл предложения не прошёл проверку целостности — импортируйте его заново.',
  'review.fail.invalidSelection':
    'Этот выбор применить нельзя — принятой связи нужен узел, который не включён. Измените выбор и попробуйте снова.',
  'review.hunks.none': 'Применять нечего — цель уже совпадает.',
  'review.hunk.add': 'Добавить',
  'review.hunk.remove': 'Убрать',
  'review.hunk.change': 'Изменить',
  'review.hunk.bothChanged': ' · это изменили обе стороны',
  'review.hunk.youDeleted': ' · это удалено вами',
  'review.hunk.alsoRemove': 'также убрать или перенаправить связь',
  'review.hunk.cantRemove': 'нельзя убрать — ваша сторона добавила связь',
  'review.hunk.toThisNode': 'к этому узлу',
  'review.hunk.framesTitle': 'Сохранённые рамки',
  'review.hunk.framesTake': 'Взять рамки из предложения ({yours} → {theirs})',
  'review.hunk.framesClear': 'Взять рамки из предложения (убрать все {yours})',
  'review.field.base': 'основа',
  'review.field.yours': 'ваше',
  'review.field.theirs': 'их',
  'review.field.takeTheirs': 'взять их',
  'review.field.keepMine': 'оставить моё',
  'review.action.applyAnyway': 'Всё равно применить',
  'review.action.applyProposal': 'Применить предложение',
  'review.action.applySelected': 'Применить выбранное: {count}',
  'review.action.chooseChanges': 'Выбрать изменения',
  'review.action.wholeProposal': 'Всё предложение',
  'review.action.openAsDoc': 'Открыть как документ',
  'review.action.cancel': 'Отмена',
  'review.foot.hunks':
    'Применение цели вместе с выбранными изменениями создаёт новую локальную ревизию (родитель {parent}); одна отмена возвращает всё назад. В файл ничего не записывается.',
  'review.foot.whole':
    'Применение создаёт новую локальную ревизию (родитель {parent}); одна отмена возвращает всё назад. В файл ничего не записывается.',
  'dist.runs': 'прогоны',
  'dist.steps': 'шаги',
  'dist.seed': 'зерно',
  'dist.ended': 'Завершено',
  'dist.stale': 'устарело — граф изменился; выполните заново для обновления',
  'dist.export.staleTitle': 'Результат устарел — выполните заново для экспорта',
  'dist.export.title': 'Экспортировать это выполнение',
  'dist.export.seriesCsv': 'CSV рядов',
  'dist.export.seriesCsv.blurb': 'по шагам: p10/p50/p90/среднее/мин/макс',
  'dist.export.runsCsv': 'CSV прогонов',
  'dist.export.runsCsv.blurb': 'итоговое значение по прогонам · прогон, зерно, накопители',
  'dist.export.summaryCsv': 'CSV сводки',
  'dist.export.summaryCsv.blurb': 'сводка итоговых значений по накопителям',
  'dist.export.json.blurb': 'полный MonteCarloResult',
  'term.title': 'завершение',
  'term.ended': 'завершено',
  'term.noRuns': 'Ни один прогон не завершился',
  'band.pool': 'Накопитель',
  'band.mean': 'среднее',
  'openhint.title': 'Без синхронизации аккаунта',
  'openhint.body': 'Откройте сохранённый файл или ссылку, чтобы посмотреть диаграмму здесь.',
  'openhint.button': 'Открыть файл',
  'openhint.sub':
    'Экспортируйте Graph JSON или Workspace JSON на компьютере либо откройте ссылку с #g1=.',
  'tour.welcome.title': 'Добро пожаловать в Loop Studio',
  'tour.welcome.body': 'Короткий двухминутный тур по шести частям рабочего пространства?',
  'tour.welcome.start': 'Начать тур',
  'tour.welcome.skip': 'Пропустить',
  'tour.nav.back': 'Назад',
  'tour.nav.next': 'Далее',
  'tour.nav.done': 'Готово',
  'tour.nav.position': '{n} / {total}',
  'tour.nav.close': 'Закрыть тур',
  'tour.desktop.pieces.title': 'Элементы',
  'tour.desktop.pieces.body':
    'Строительные блоки — Накопитель, Источник, Сток, Распределитель и остальные. Нажмите на любой из них или перетащите его на холст, чтобы добавить.',
  'tour.desktop.canvas.title': 'Холст',
  'tour.desktop.canvas.body':
    'Размещайте элементы здесь, соединяйте их от точки к точке, двигайте и масштабируйте вид.',
  'tour.desktop.inspector.title': 'Инспектор',
  'tour.desktop.inspector.body': 'Выберите любой элемент или связь, чтобы изменить настройки здесь.',
  'tour.desktop.playback.title': 'Воспроизведение',
  'tour.desktop.playback.body':
    'Выполняйте модель пошагово или непрерывно. Фиксированное Зерно делает случайный прогон повторяемым.',
  'tour.desktop.timeline.title': 'Шкала времени',
  'tour.desktop.timeline.body':
    'Смотрите, как значения накопителей и результаты прогонов меняются со временем.',
  'tour.desktop.files.title': 'Файлы и обмен',
  'tour.desktop.files.body':
    'Начните с шаблона, импортируйте файл, скопируйте ссылку или экспортируйте граф либо рабочее пространство.',
  'tour.mobile.open.title': 'Открыть граф',
  'tour.mobile.open.body':
    'Откройте общий граф — по ссылке с #g1= или импортировав файл из меню «Ещё».',
  'tour.mobile.canvas.title': 'Перемещение',
  'tour.mobile.canvas.body': 'Тяните, чтобы двигать вид, щипок для масштаба. «Вписать» центрирует диаграмму.',
  'tour.mobile.inspect.title': 'Просмотр',
  'tour.mobile.inspect.body':
    'Коснитесь узла или связи, чтобы прочитать их настройки. Редактирование доступно только на компьютере.',
  'tour.mobile.run.title': 'Запуск',
  'tour.mobile.run.body': 'Проходите модель по шагам или нажмите «Запустить», чтобы выполнить её.',
  'tour.mobile.timeline.title': 'Шкала времени',
  'tour.mobile.timeline.body': 'Откройте панель шкалы времени, чтобы увидеть значения во времени.',
  'tour.mobile.more.title': 'Ещё',
  'tour.mobile.more.body': 'Обмен, экспорт и переключение языка находятся в этом меню.',
  'tour.help.menuLabel': 'Справка',
  'tour.help.takeTour': 'Пройти тур',
  'tour.help.about': 'О Loop Studio',
  'tour.help.feedback': 'Отправить отзыв (форма на английском)',
  'tour.help.feedbackAria': 'Отправить отзыв (форма на английском): откроется в новой вкладке',
  'about.createdBy': 'Автор',
  'about.repo': 'Репозиторий на GitHub',
  'about.repoAria': 'Репозиторий Loop Studio на GitHub',
  'about.notAffiliated':
    'Loop Studio — независимый проект, не связанный с Machinations.io и не одобренный ею.',
  'hint.close': 'Скрыть это примечание',
  'hint.emptyCanvas.body': 'Начните с Шаблона или перетащите типы узлов с левой панели.',
  'hint.mc.body':
    'Monte Carlo выполняет модель много раз и показывает разброс исходов, а не одно предсказание.',
  'hint.review.body':
    'Просмотр предложения никогда не меняет открытый проект — ничего не происходит, пока вы его не примените.',
  'hint.importFirstCommit.body':
    '{n, plural, one {Добавлен # Параметр} few {Добавлено # Параметра} many {Добавлено # Параметров} other {Добавлено # Параметра}} из {tables}. Их значения находятся на панели входных данных. Чтобы использовать один из них в Вычисляемом значении, введите @ в его выражении и выберите имя; поле потока связи и Активатор предлагают такой же выбор.',
  'help.contextual.hint.import.name': 'Импорт таблицы',
  'help.contextual.hint.import.desc':
    'Показывается один раз, сразу после первого импорта таблицы на холст.',
  'hint.frameMove.body':
    'Тяните край рамки, чтобы переместить её вместе со всем содержимым. Удерживайте Alt при перетаскивании, чтобы переместить только рамку.',
  'help.contextual.hint.frameMove.name': 'Перемещение рамки',
  'help.contextual.hint.frameMove.desc':
    'Показывается один раз, при первом выделении рамки группы на редактируемом холсте.',
  'hint.focusFilter.body':
    'Граф становится перегруженным? Фокус приглушает всё, кроме окрестности одного узла; Фильтр скрывает типы узлов или связей.',
  'help.contextual.menuLabel': 'Контекстная справка',
  'help.contextual.title': 'Контекстная справка',
  'help.contextual.intro':
    'Loop Studio показывает несколько коротких заметок при первом появлении каждой ситуации. Включите заметку заново, чтобы увидеть её в следующий раз.',
  'help.contextual.rearm': 'Показать снова в следующий раз',
  'help.contextual.rearmWaiting': 'Ожидает показа в следующий раз',
  'help.contextual.rearmWaitingHint':
    'Она появится сама в следующий подходящий момент.',
  'help.contextual.hint.emptyCanvas.name': 'Пустой холст',
  'help.contextual.hint.emptyCanvas.desc':
    'Показывается на пустом холсте, пока нет ни одного узла.',
  'help.contextual.hint.mc.name': 'Monte Carlo',
  'help.contextual.hint.mc.desc': 'Показывается при первом открытии диалога Monte Carlo.',
  'help.contextual.hint.review.name': 'Просмотр',
  'help.contextual.hint.review.desc':
    'Показывается при первом открытии присланного предложения для просмотра.',
  'help.contextual.hint.focusFilter.name': 'Фокус / Фильтр',
  'help.contextual.hint.focusFilter.desc':
    'Показывается, когда граф становится достаточно большим, чтобы Фокус и Фильтр начали помогать.',
} as const

export type UiKey = keyof typeof ui
export default ui
