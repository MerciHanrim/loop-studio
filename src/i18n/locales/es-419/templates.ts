// docs/localization.md §L3.3 — Templates & modules slice of the `es-419`
// catalog. Neutral Latin American Spanish (§L2.13): `ustedes` never
// `vosotros`, impersonal infinitives for commands, sentence case, `“…”` for
// user-facing prose, and `¿` / `¡` opening marks.
//
// `etapa` is the PROCESS sense of "step" (a stage of a production line);
// `paso` is reserved for the simulation timestep and its commands (§L2.13).

const templates = {
  'templates.button': 'Plantillas ▾',
  'templates.menuLabel': 'Plantillas',
  'templates.equilibrium.name': 'Línea de producción equilibrada',
  // Measured in the real 272 px box (line-height 16.875, clamp 2): the literal
  // rendering of the English noun-phrase list needed a third line, and a first
  // shortening kept that list shape and read like a gloss. This is an action
  // sentence with the four beats intact — material in, finished goods out,
  // scrap discarded, the line settling — at 2 lines and 0 px of overflow,
  // without widening the menu or raising the clamp (§L2.13).
  'templates.equilibrium.blurb': 'Entra material, salen productos y se descarta la merma; la línea se estabiliza en pocos pasos.',
  'templates.deadlock.name': 'Bloqueo por capacidad',
  'templates.deadlock.blurb': 'La misma línea sin etapa de envío: el inventario llega al tope y todo se detiene.',
  'templates.mmoProgression.name': 'Progresión temprana de MMO (niveles 1–15)',
  'templates.mmoProgression.blurb': 'Tres zonas de misiones, cacerías y recompensas: cuánto toma llegar al nivel 15.',
  'templates.coffeeRoastery.name': 'Flujo de operaciones de un tostador de café',
  'templates.coffeeRoastery.blurb': 'Cómo el tostado, las ventas y el inventario tiran unos de otros durante un día de operación.',
  'templates.gachaBannerZones.name': 'Comparación de 3 zonas de banner gacha',
  'templates.gachaBannerZones.blurb': 'Tres banners con un mismo presupuesto, para ver qué cambian el pity y el UP garantizado.',
  'templates.replace.title': '¿Cargar esta plantilla?',
  'templates.replace.body': 'Su trabajo actual se reemplazará por: {name}',
  'templates.replace.confirm': 'Cargar plantilla',
  'modules.button': 'Insertar módulo ▾',
  'modules.menuLabel': 'Insertar módulo',
  'modules.fromFile': 'Desde un archivo…',
  'modules.extract': 'Extraer la selección como módulo…',
  'modules.bufferedStep.name': 'Etapa de producción con búferes',
  'modules.bufferedStep.blurb': 'Agrega una etapa de producción con un búfer de entrada y uno de salida.',
  'modules.rewardSplit.name': 'Ciclo de reparto de recompensas',
  'modules.rewardSplit.blurb': 'Agrega un ciclo que reparte las recompensas entre gastos y ahorros.',
  'modules.error.title': 'No se pudo insertar el módulo',
  'modules.promote.title': '¿Convertir esto en un modelo con parámetros (v2)?',
  'modules.promote.body': 'Insertar este bloque convierte el documento en un modelo v2 y cambia el resumen de semántica del modelo. Un solo deshacer revierte a la vez el cambio de modelo y la inserción.',
  'modules.promote.confirm': 'Convertir e insertar',
  'modules.frames.title': 'Los marcos guardados no se incluyen',
  'modules.frames.insertBody': 'Este archivo tiene marcos de grupo guardados. Insertarlo como módulo no trae los marcos a su grafo; todo lo demás se inserta de la forma habitual.',
  'modules.frames.extractBody': 'Su grafo tiene marcos de grupo guardados. No se escriben en el archivo del módulo: solo se guardan los nodos seleccionados y sus conexiones internas.',
  'modules.frames.continue': 'Continuar',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
