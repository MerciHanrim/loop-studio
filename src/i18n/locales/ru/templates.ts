// docs/localization.md §L3.3 — Templates & modules slice of the `ru` catalog.
//
// **`Template` is `Шаблон`, and the simulation model is `Модель`.** Unlike
// Portuguese and Spanish, where the document-template word collided with this
// product's word for the simulation MODEL and the anglicism had to be kept,
// Russian has two separate words and neither is taken: `modules.promote.*`
// reads unambiguously as a change to the МОДЕЛЬ while `templates.*` stays
// ШАБЛОН.
//
// `этап` is the PROCESS sense of "step" (a stage of a production line); `шаг`
// is reserved for the simulation timestep and its commands, exactly the split
// the Romance catalogs make with `etapa` / `passo`.

const templates = {
  'templates.button': 'Шаблоны',
  'templates.menuLabel': 'Шаблоны',
  'templates.equilibrium.name': 'Сбалансированная производственная линия',
  'templates.equilibrium.blurb':
    'Материал, обработка, брак и готовый выпуск — баланс за несколько шагов.',
  'templates.deadlock.name': 'Затор по ёмкости',
  'templates.deadlock.blurb':
    'Та же линия без этапа отгрузки: запас заполняет ёмкость, и всё останавливается.',
  'templates.mmoProgression.name': 'Ранняя прокачка в MMO (уровни 1–15)',
  'templates.mmoProgression.blurb':
    'Три зоны заданий, охоты и наград — сколько занимает путь до 15-го уровня.',
  'templates.coffeeRoastery.name': 'Рабочий цикл кофейной обжарки',
  'templates.coffeeRoastery.blurb':
    'Как обжарка, продажи и запасы тянут друг друга в течение торгового дня.',
  'templates.gachaBannerZones.name': 'Сравнение трёх баннеров гачи',
  'templates.gachaBannerZones.blurb':
    'Три баннера на один бюджет — что меняют гарант и гарантированный пикап.',
  'templates.replace.title': 'Загрузить этот шаблон?',
  'templates.replace.body': 'Текущая работа будет заменена на: {name}',
  'templates.replace.confirm': 'Загрузить шаблон',
  'modules.extract': 'Сохранить выделенную структуру…',
  'modules.error.title': 'Не удалось вставить структуру',
  'modules.promote.title': 'Сделать модель управляемой параметрами (v2)?',
  'modules.promote.body': 'Вставка этой структуры превращает документ в модель v2, и дайджест семантики модели меняется. Одна отмена возвращает и смену модели, и вставку сразу.',
  'modules.promote.confirm': 'Повысить и вставить',
  'modules.frames.title': 'Сохранённые рамки не включаются',
  'modules.frames.insertBody': 'В этом файле есть сохранённые рамки групп. Вставка его как структуры не переносит рамки в ваш граф — всё остальное вставляется как обычно.',
  'modules.frames.extractBody': 'В вашем графе есть сохранённые рамки групп. Они не записываются в файл структуры — записываются только выбранные узлы и связи между ними.',
  'modules.frames.continue': 'Продолжить',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Общая гача',
  'templates.gachaGeneral.blurb': 'Один баннер без гаранта. Доля попаданий считается от целевого числа призывов; на нём выполнение останавливается.',
  'templates.gachaStandard.name': 'Стандартная гача',
  'templates.gachaStandard.blurb': 'Один баннер с жёстким потолком гаранта: на потолке следующий призыв — принудительный SSR.',
  'templates.gachaPickup.name': 'Гача с пикапом',
  'templates.gachaPickup.blurb': 'Гарант и гарантия пикапа: после SSR вне пикапа следующий SSR — пикап.',
  'modules.insertSaved': 'Вставить сохранённую структуру…',
  'modules.insertSaved.blurb': 'Добавляет в этот документ сохранённый вами файл структуры.',
  'modules.insertSaved.locked': 'Недоступно, пока редактирование заблокировано',
  'modules.extract.blurb': 'Сохраняет выбранные узлы и связи между ними в файл.',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
