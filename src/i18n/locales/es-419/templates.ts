// docs/localization.md §L3.3 — Templates & modules slice of the `es-419`
// catalog. Neutral Latin American Spanish (§L2.13): `ustedes` never
// `vosotros`, impersonal infinitives for commands, sentence case, `“…”` for
// user-facing prose, and `¿` / `¡` opening marks.
//
// `etapa` is the PROCESS sense of "step" (a stage of a production line);
// `paso` is reserved for the simulation timestep and its commands (§L2.13).

const templates = {
  'templates.button': 'Plantillas',
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
  'modules.extract': 'Guardar la estructura seleccionada…',
  'modules.error.title': 'No se pudo insertar la estructura',
  'modules.promote.title': '¿Convertir esto en un modelo con parámetros (v2)?',
  'modules.promote.body': 'Insertar esta estructura convierte el documento en un modelo v2 y cambia el resumen de semántica del modelo. Un solo deshacer revierte a la vez el cambio de modelo y la inserción.',
  'modules.promote.confirm': 'Convertir e insertar',
  'modules.frames.title': 'Los marcos guardados no se incluyen',
  'modules.frames.insertBody': 'Este archivo tiene marcos de grupo guardados. Insertarlo como estructura no trae los marcos a su grafo — todo lo demás se inserta de la forma habitual.',
  'modules.frames.extractBody': 'Su grafo tiene marcos de grupo guardados. No se escriben en el archivo de estructura — solo se guardan los nodos seleccionados y sus conexiones internas.',
  'modules.frames.continue': 'Continuar',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Gacha general',
  'templates.gachaGeneral.blurb': 'Un banner, sin pity. La tasa de aciertos se cuenta sobre las tiradas objetivo; la ejecución se detiene ahí.',
  'templates.gachaStandard.name': 'Gacha estándar',
  'templates.gachaStandard.blurb': 'Un banner con un límite de Hard Pity: en el límite, la siguiente tirada es un SSR forzado.',
  'templates.gachaPickup.name': 'Gacha con UP',
  'templates.gachaPickup.blurb': 'Pity y garantía de UP: tras un SSR fuera de UP, el siguiente SSR es el UP.',
  'modules.insertSaved': 'Insertar estructura guardada…',
  'modules.insertSaved.blurb': 'Agrega a este documento un archivo de estructura que usted guardó.',
  'modules.insertSaved.locked': 'No disponible mientras la edición está bloqueada',
  'modules.extract.blurb': 'Guarda en un archivo los nodos seleccionados y las conexiones entre ellos.',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
