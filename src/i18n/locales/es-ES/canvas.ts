// docs/localization.md §L3.3 — Canvas surface slice of the `es-ES` catalog.//
// docs/localization.md §L2.15 — `es-ES` is a REGION AUDIT over the finished
// `es-419` catalog, not a re-translation. A string differs only where a Spain
// reader would find the Latin American one wrong or unnatural; everywhere else
// the two are deliberately identical, and that is not laziness.
//
// What actually differs, in the whole catalog: `ordenador` for the device
// (4 keys), `pulsar` for pressing a key or button (4), `escribir` for typing
// into a field (2), and a NO-BREAK SPACE before the percent sign (2) because
// `Intl.NumberFormat('es-ES')` emits one and `es-419` emits none.
//
// What deliberately does NOT differ: the `usted` register (Spain uses it for
// software too, and `vosotros` would be a tone change, not a correction),
// `archivo` (entirely natural in Spain — `fichero` is not required), the
// impersonal and infinitive command forms, and the whole node-kind glossary.
//
// Core glossary (§L2.13): `Depósito` Pool · `Fuente` Source · `Sumidero` Drain
// · `Distribuidor` Gate · `Convertidor` Converter · `Fin` End · `Parámetro`
// Parameter · `Valor calculado` Register.
//
// `Fuente` / `Sumidero` is the Spanish flow-theory pair, so the two read as a
// pair. `Distribuidor` says what a Gate does; `Compuerta` is the literal word
// but also means a logic gate (`compuerta lógica`). `Valor calculado` is
// spelled out rather than `Registro`, which in Spanish means a record or a
// log and would mislead — the same reasoning `fr` and `de` used.
//
// `paso` is the simulation timestep throughout this file; `etapa` is reserved
// for a stage of a production process (§L2.13).

const canvas = {
  'palette.pool.name': 'Depósito',
  'palette.pool.description': 'Retiene recursos y muestra la cantidad actual. Cuando llega a su capacidad, ejerce contrapresión sobre el flujo entrante.',
  'palette.source.name': 'Fuente',
  'palette.source.description': 'Crea recursos nuevos en cada paso y los envía a los nodos que alimenta.',
  'palette.drain.name': 'Sumidero',
  'palette.drain.description': 'Toma recursos de los nodos de los que se abastece y los retira del sistema.',
  'palette.gate.name': 'Distribuidor',
  'palette.gate.description': 'Reparte los recursos entrantes en una proporción fija, o elige una rama por probabilidad y envía los recursos por ella. No retiene nada.',
  'palette.converter.name': 'Convertidor',
  'palette.converter.description': 'Consume recursos de entrada y produce recursos de salida en la proporción que usted defina. No retiene nada.',
  'palette.end.name': 'Fin',
  'palette.end.description': 'Detiene la ejecución cuando un recurso llega a él.',
  'palette.parameter.name': 'Parámetro',
  'palette.parameter.description': 'Un número fijo que usted define. No tiene puertos, y una expresión puede referenciarlo por su id.',
  'palette.register.name': 'Valor calculado',
  'palette.register.description': 'Evalúa una expresión para el paso actual y muestra el resultado. No acumula nada, no almacena nada y no tiene puertos.',
  'palette.addAction': 'Haga clic, o arrastre al lienzo, para añadir uno.',
  'canvas.minimap': 'Minimapa del grafo',
  'canvas.minimap.hide': 'Ocultar el minimapa',
  'canvas.minimap.show': 'Mostrar el minimapa',
  'canvas.lock.lock': 'Bloquear la edición: seleccionar y leer siguen activos',
  'canvas.lock.unlock': 'Desbloquear la edición: mover, conectar y cambiar valores',
  'canvas.focus.on': 'Enfoque desactivado: haga clic para enfocar el nodo seleccionado',
  'canvas.focus.off': 'Enfoque activado: haga clic para mostrar todo el grafo',
  'canvas.focus.hint': 'Seleccione un nodo para enfocarlo',
  'canvas.focus.rowLabel': 'Enfocar la selección',
  'canvas.focus.stateOn': 'Activado',
  'canvas.focus.stateOff': 'Desactivado',
  'canvas.panMode.off': 'Modo de desplazamiento desactivado: arrastre el lienzo vacío para desplazarse',
  'canvas.panMode.on': 'Modo de desplazamiento activado: arrastre en cualquier parte para desplazarse',
  'canvas.panMode.rowLabel': 'Modo de desplazamiento',
  'canvas.filter.open': 'Filtros: ocultar partes del grafo mientras explora',
  'canvas.filter.close': 'Cerrar el panel de filtros',
  'canvas.filter.title': 'Filtros',
  'canvas.filter.rowLabel': 'Filtros',
  'canvas.filter.groupEdgeClass': 'Tipo de conexión',
  'canvas.filter.groupResourceType': 'Tipo de recurso',
  'canvas.filter.groupNodeKind': 'Clase de nodo',
  'canvas.filter.edgeClass.resource': 'Recurso',
  'canvas.filter.edgeClass.state': 'Estado',
  'canvas.filter.edgeClass.hint': 'Indicio de dependencia',
  'canvas.filter.untyped': 'sin tipo',
  'canvas.filter.clear': 'Limpiar los filtros',
  // '{n} ocultos' renders '1 ocultos'; English '1 hidden' does not agree, so
  // it has no such gap. The base key is a plain slot and check:i18n rejects a
  // plural where the base has one, so the fix is an invariable phrase.
  'canvas.filter.hiddenCount': '{n} sin mostrar',
  'canvas.filter.none': 'Nada oculto',
  'canvas.filter.checkboxHint': 'marcado = oculto',
  'canvas.nodeKind.source': 'Fuente',
  'canvas.nodeKind.pool': 'Depósito',
  'canvas.nodeKind.gate': 'Distribuidor',
  'canvas.nodeKind.converter': 'Convertidor',
  'canvas.nodeKind.drain': 'Sumidero',
  'canvas.nodeKind.end': 'Fin',
  'canvas.nodeKind.parameter': 'Parámetro',
  'canvas.nodeKind.register': 'Valor calculado',
  'canvas.resetView': 'Restablecer la vista: ajustar el grafo y limpiar filtros y enfoque',
  'canvas.regionSelect.off': 'Seleccionar una región: arrastre sobre el lienzo vacío para seleccionar; Mayús+arrastrar también funciona',
  'canvas.regionSelect.on': 'Seleccionar una región: seleccionando; arrastre sobre el lienzo vacío, Esc para cancelar',
  'canvas.regionSelect.count': '{n, plural, one {# nodo seleccionado} many {# nodos seleccionados} other {# nodos seleccionados}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# nodo seleccionado} many {# nodos seleccionados} other {# nodos seleccionados}} · desbloquee la edición para moverlos',
  'canvas.frame.draw': 'Marco de grupo: arrastre sobre el lienzo vacío para dibujar uno',
  'canvas.frame.drawing': 'Marco de grupo: dibujando; arrastre sobre el lienzo vacío, Esc para cancelar',
  'canvas.frame.defaultName': 'Grupo {n}',
  'canvas.frame.delete': 'Eliminar este marco',
  'canvas.frame.suggest': 'Sugerir marcos: rectángulos de agrupación aproximados alrededor de nodos conectados estructuralmente. Solo estructura; no significado del dominio.',
  'canvas.frame.suggestStale': 'Sugerir marcos: el grafo cambió; haga clic para recalcular los grupos sugeridos',
  'canvas.frame.suggestRow': 'Sugerir marcos',
  'canvas.frame.suggestNote': 'Grupos estructurales sugeridos: puede que no coincidan con la forma en que usted dividiría el trabajo.',
  'canvas.frame.suggestNoteDismiss': 'Descartar esta nota',
  'canvas.frame.areaName': 'Área {n}',
  'canvas.frame.dismiss': 'Descartar este marco sugerido',
  'canvas.frame.clearAll': 'Eliminar todos los marcos',
  'canvas.frame.clearSuggested': 'Eliminar los marcos sugeridos',
  'canvas.frame.clearSuggestedRow': 'Eliminar los marcos sugeridos',
  'canvas.frame.colorRow': 'Color del marco',
  'canvas.frame.color.neutral': 'Neutro',
  'canvas.frame.color.slate': 'Pizarra',
  'canvas.frame.color.sage': 'Salvia',
  'canvas.frame.color.gold': 'Oro',
  'canvas.frame.color.violet': 'Violeta',
  'canvas.frame.color.rose': 'Rosa',
  'canvas.activity.off': 'Capa de actividad desactivada: haga clic para resaltar las partes activas recientemente',
  'canvas.activity.on': 'Capa de actividad activada: haga clic para ocultar el resaltado',
  'canvas.activity.rowLabel': 'Capa de actividad',
  'canvas.route.invalidFlag': 'trazado inválido: un punto del trazado queda dentro de un nodo',
  'canvas.edgeLabel.clamp': 'recorte',
  'canvas.edgeLabel.clamp.title': 'retirado por el único recorte del Depósito de destino al final de la Fase 0',
  'canvas.edgeLabel.blocked': 'bloqueado',
  'canvas.edgeLabel.blocked.title': 'entregado, pero el destino no pudo actuar (activación incorrecta, o un activador lo mantuvo cerrado)',
  'canvas.edgeLabel.breakdown.title': 'las transferencias de este paso a lo largo de esta conexión',
  'canvas.edgeLabel.refMissing': 'Error de referencia a un parámetro',
  'node.unreadable.title': '{kind} ilegible',
  'node.unreadable.sub': 'no se pueden leer los datos: corríjalos en el archivo',
  'node.invalidFlag': 'Este nodo es inválido',
  'node.aria.invalid': 'inválido',
  'node.aria.selected': 'seleccionado',
  'node.aria.focused': 'enfocado',
  'node.evaluatedCue': 'Se evaluó en este paso pero no actuó',
  'node.default.pool': 'Depósito',
  'node.default.source': 'Fuente',
  'node.default.drain': 'Sumidero',
  'node.default.gate': 'Distribuidor',
  'node.default.converter': 'Convertidor',
  'node.default.end': 'Fin',
  'node.default.parameter': 'Parámetro',
  'node.default.register': 'Valor calculado',
  'canvas.frame.a11y.roledescription': 'marco de grupo',
  'canvas.frame.a11y.roledescriptionAuto': 'marco de grupo sugerido',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# nodo} many {# nodos} other {# nodos}}',
  'canvas.frame.a11y.desc': 'Pulse Intro o Espacio para seleccionar este marco.',
  'canvas.frame.a11y.descSelected': 'Seleccionado. Las teclas de flecha mueven el marco y todo lo que contiene; Mayús para un paso mayor. Retroceso o Suprimir lo elimina. Escape lo deselecciona.',
  'canvas.frame.a11y.descReadonly': 'Solo lectura: este marco se puede seleccionar y leer, pero no editar.',
  'canvas.frame.a11y.resize': 'Redimensionar {label}: ancho {w}, alto {h}. Las teclas de flecha lo redimensionan; Mayús para un paso mayor.',
  'canvas.frame.a11y.moved': '{label} se movió a x {x}, y {y}',
  'canvas.frame.a11y.resized': '{label} se redimensionó a ancho {w}, alto {h}',
  'rf.node.moveCancelled': 'Movimiento cancelado. El nodo volvió a x {x}, y {y}',
  'rf.node.moved': 'Se movió el nodo seleccionado hacia {direction}. Nueva posición, x {x}, y {y}',
  'rf.dir.left': 'la izquierda',
  'rf.dir.right': 'la derecha',
  'rf.dir.up': 'arriba',
  'rf.dir.down': 'abajo',
  'rf.controls.label': 'Controles del lienzo',
  'rf.controls.zoomIn': 'Acercar',
  'rf.controls.zoomOut': 'Alejar',
  'rf.controls.fitView': 'Ajustar el diagrama a la vista',
  'rf.controls.interactive': 'Alternar la edición del lienzo',
  'rf.handle.label': 'Punto de conexión',
  'rf.node.a11y': 'Pulse Intro o Espacio para seleccionar este nodo. Pulse Suprimir para eliminarlo, Escape para cancelar.',
  'rf.node.a11yKeyboard': 'Pulse Intro o Espacio para seleccionar este nodo y luego las teclas de flecha para moverlo. Pulse Suprimir para eliminarlo, Escape para cancelar.',
  'rf.edge.a11y': 'Pulse Intro o Espacio para seleccionar esta conexión. Pulse Suprimir para eliminarla, Escape para cancelar.',
} as const

export type CanvasKey = keyof typeof canvas
export default canvas
