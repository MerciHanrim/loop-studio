// docs/localization.md §L2.22 — Italian, the Canvas surface slice.
//
// NODE KINDS, fixed before this file was written:
//   Pool `Serbatoio` · Source `Sorgente` · Drain `Scarico` ·
//   Gate `Ripartitore` · Converter `Convertitore` · End `Fine` ·
//   Parameter `Parametro` · Register `Valore calcolato` ·
//   Activator `Attivatore`
//
// `Ripartitore` for Gate and NOT `Cancello`: `Cancello` is the literal gate,
// and a network port is `porta`. This product's Gate SPLITS flow — both
// gate-typed labels it ships say so in English ("Reward router",
// "Split production flow"), so the kind name follows its own labels.
//
// `Valore calcolato` for Register and NOT `Registro`: `Registro` is a ledger
// and implies storage, but `palette.register.description` says it "accumulates
// nothing, stores nothing and has no ports". Its LENGTH is a UI-width question,
// settled by the vertical-metrics and wrapping tests, not a wording one.
//
// `Fine` for End rather than `Terminale`, which reads as a console terminal.
//
// CANVAS is `area di disegno` (Microsoft's own Italian UI uses it), kept
// distinct from Workspace `spazio di lavoro` in `ui.ts`. FRAME is `riquadro`;
// the English compound "group frame" is `riquadro di gruppo`, and the default
// frame NAME stays `Gruppo {n}` because English names it `Group {n}`.
//
// STEP: `canvas.edgeLabel.breakdown.title` and `node.evaluatedCue` mean the
// SIMULATION TICK, so `passo`. The two `a11y` strings that say "Shift for a
// bigger step" mean a MOVEMENT INCREMENT and take no fixed noun at all — they
// are written per sentence (`spostamento maggiore`).
//
// STYLE: second-person singular imperative, no explicit `tu`, never `Lei` and
// never the manual-style infinitive (`Selezionare`). Descriptions are
// subjectless. Slot quoting follows the English source exactly.

import type { CanvasKey } from '../en/canvas'

const canvas = {
  'palette.pool.name': 'Serbatoio',
  'palette.pool.description': 'Contiene risorse e mostra la quantità attuale. Quando la capacità si riempie, frena il flusso in arrivo.',
  'palette.source.name': 'Sorgente',
  'palette.source.description': 'Crea nuove risorse a ogni passo e le invia ai nodi che alimenta.',
  'palette.drain.name': 'Scarico',
  'palette.drain.description': 'Preleva risorse dai nodi da cui attinge e le rimuove dal sistema.',
  'palette.gate.name': 'Ripartitore',
  'palette.gate.description': 'Divide le risorse in arrivo secondo un rapporto fisso, oppure sceglie un ramo per probabilità e invia lì. Non contiene nulla.',
  'palette.converter.name': 'Convertitore',
  'palette.converter.description': 'Consuma risorse in ingresso e produce risorse in uscita nel rapporto che imposti. Non contiene nulla.',
  'palette.end.name': 'Fine',
  'palette.end.description': 'Ferma l’esecuzione quando una risorsa lo raggiunge.',
  'palette.parameter.name': 'Parametro',
  'palette.parameter.description': 'Un numero fisso che imposti. Non ha porte e un’espressione può richiamarlo tramite il suo id.',
  'palette.register.name': 'Valore calcolato',
  'palette.register.description': 'Valuta un’espressione per il passo corrente e ne mostra il risultato. Non accumula nulla, non memorizza nulla e non ha porte.',
  'palette.addAction': 'Fai clic, oppure trascina sull’area di disegno, per aggiungerne uno.',
  'canvas.minimap': 'Minimappa del grafo',
  'canvas.minimap.hide': 'Nascondi la minimappa',
  'canvas.minimap.show': 'Mostra la minimappa',
  'canvas.lock.lock': 'Blocca le modifiche — selezione e lettura restano attive',
  'canvas.lock.unlock': 'Sblocca le modifiche — sposta, collega e cambia i valori',
  'canvas.focus.on': 'Messa a fuoco disattivata — fai clic per mettere a fuoco il nodo selezionato',
  'canvas.focus.off': 'Messa a fuoco attiva — fai clic per mostrare tutto il grafo',
  'canvas.focus.hint': 'Seleziona un nodo da mettere a fuoco',
  'canvas.focus.rowLabel': 'Metti a fuoco la selezione',
  'canvas.focus.stateOn': 'Attiva',
  'canvas.focus.stateOff': 'Disattivata',
  'canvas.panMode.off': 'Modalità panoramica disattivata — trascina l’area di disegno vuota per spostare la vista',
  'canvas.panMode.on': 'Modalità panoramica attiva — trascina ovunque per spostare la vista',
  'canvas.panMode.rowLabel': 'Modalità panoramica',
  'canvas.filter.open': 'Filtri — nascondi parti del grafo mentre lo esplori',
  'canvas.filter.close': 'Chiudi il pannello dei filtri',
  'canvas.filter.title': 'Filtri',
  'canvas.filter.rowLabel': 'Filtri',
  'canvas.filter.groupEdgeClass': 'Tipo di connessione',
  'canvas.filter.groupResourceType': 'Tipo di risorsa',
  'canvas.filter.groupNodeKind': 'Tipo di nodo',
  'canvas.filter.edgeClass.resource': 'Risorsa',
  'canvas.filter.edgeClass.state': 'Stato',
  'canvas.filter.edgeClass.hint': 'Suggerimento di dipendenza',
  'canvas.filter.untyped': 'senza tipo',
  'canvas.filter.clear': 'Azzera i filtri',
  'canvas.filter.hiddenCount': '{n} nascosti',
  'canvas.filter.none': 'Niente di nascosto',
  'canvas.filter.checkboxHint': 'selezionato = nascosto',
  'canvas.nodeKind.source': 'Sorgente',
  'canvas.nodeKind.pool': 'Serbatoio',
  'canvas.nodeKind.gate': 'Ripartitore',
  'canvas.nodeKind.converter': 'Convertitore',
  'canvas.nodeKind.drain': 'Scarico',
  'canvas.nodeKind.end': 'Fine',
  'canvas.nodeKind.parameter': 'Parametro',
  'canvas.nodeKind.register': 'Valore calcolato',
  'canvas.resetView': 'Reimposta la vista — adatta il grafo e azzera filtri e messa a fuoco',
  'canvas.regionSelect.off': 'Seleziona una regione — trascina sull’area di disegno vuota per selezionare; funziona anche con Maiusc+trascinamento',
  'canvas.regionSelect.on': 'Seleziona una regione — selezione in corso; trascina sull’area di disegno vuota, Esc per annullare',
  'canvas.regionSelect.count': '{n, plural, one {# nodo selezionato} many {# nodi selezionati} other {# nodi selezionati}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# nodo selezionato} many {# nodi selezionati} other {# nodi selezionati}} · sblocca le modifiche per spostarli',
  'canvas.frame.draw': 'Riquadro di gruppo — trascina sull’area di disegno vuota per disegnarne uno',
  'canvas.frame.drawing': 'Riquadro di gruppo — disegno in corso; trascina sull’area di disegno vuota, Esc per annullare',
  'canvas.frame.defaultName': 'Gruppo {n}',
  'canvas.frame.delete': 'Elimina questo riquadro',
  'canvas.frame.suggest': 'Suggerisci riquadri — rettangoli di raggruppamento approssimativi attorno a nodi connessi fra loro. Solo struttura, non significato di dominio.',
  'canvas.frame.suggestStale': 'Suggerisci riquadri — il grafo è cambiato; fai clic per ricalcolare i gruppi suggeriti',
  'canvas.frame.suggestRow': 'Suggerisci riquadri',
  'canvas.frame.suggestNote': 'Gruppi strutturali suggeriti — potrebbero non coincidere con il modo in cui divideresti il lavoro.',
  'canvas.frame.suggestNoteDismiss': 'Ignora questa nota',
  'canvas.frame.areaName': 'Area {n}',
  'canvas.frame.dismiss': 'Ignora questo riquadro suggerito',
  'canvas.frame.clearAll': 'Elimina tutti i riquadri',
  'canvas.frame.clearSuggested': 'Elimina i riquadri suggeriti',
  'canvas.frame.clearSuggestedRow': 'Elimina i riquadri suggeriti',
  'canvas.frame.colorRow': 'Colore del riquadro',
  'canvas.frame.color.neutral': 'Neutro',
  'canvas.frame.color.slate': 'Ardesia',
  'canvas.frame.color.sage': 'Salvia',
  'canvas.frame.color.gold': 'Oro',
  'canvas.frame.color.violet': 'Viola',
  'canvas.frame.color.rose': 'Rosa',
  'canvas.frame.props.title': 'Impostazioni del riquadro — {label}',
  'canvas.frame.props.name': 'Nome',
  'canvas.activity.off': 'Sovrapposizione attività disattivata — fai clic per colorare le parti attive di recente',
  'canvas.activity.on': 'Sovrapposizione attività attiva — fai clic per nascondere il colore',
  'canvas.activity.rowLabel': 'Sovrapposizione attività',
  'canvas.route.invalidFlag': 'percorso non valido — un punto del percorso è dentro un nodo',
  'canvas.edgeLabel.clamp': 'limite',
  'canvas.edgeLabel.clamp.title': 'rimosso dall’unico limite di fine Fase 0 del Serbatoio di destinazione',
  'canvas.edgeLabel.blocked': 'bloccato',
  'canvas.edgeLabel.blocked.title': 'consegnato, ma la destinazione non è potuta scattare (attivazione sbagliata, oppure un attivatore la teneva chiusa)',
  'canvas.edgeLabel.breakdown.title': 'i trasferimenti di questo passo lungo questa connessione',
  'canvas.edgeLabel.refMissing': 'Errore di riferimento a un Parametro',
  'node.unreadable.title': '{kind} illeggibile',
  'node.unreadable.sub': 'i dati non sono leggibili — correggili nel file',
  'node.invalidFlag': 'Questo nodo non è valido',
  'node.aria.invalid': 'non valido',
  'node.aria.selected': 'selezionato',
  'node.aria.focused': 'a fuoco',
  'node.evaluatedCue': 'Valutato in questo passo ma non ha agito',
  'node.default.pool': 'Serbatoio',
  'node.default.source': 'Sorgente',
  'node.default.drain': 'Scarico',
  'node.default.gate': 'Ripartitore',
  'node.default.converter': 'Convertitore',
  'node.default.end': 'Fine',
  'node.default.parameter': 'Parametro',
  'node.default.register': 'Valore calcolato',
  'canvas.frame.a11y.roledescription': 'riquadro di gruppo',
  'canvas.frame.a11y.roledescriptionAuto': 'riquadro di gruppo suggerito',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# nodo} many {# nodi} other {# nodi}}',
  'canvas.frame.a11y.desc': 'Premi Invio o Spazio per selezionare questo riquadro.',
  'canvas.frame.a11y.descSelected': 'Selezionato. I tasti freccia spostano il riquadro e tutto ciò che contiene, con Maiusc lo spostamento è maggiore. Backspace o Canc lo rimuove. Esc annulla la selezione.',
  'canvas.frame.a11y.descReadonly': 'Sola lettura — questo riquadro si può selezionare e leggere, ma non modificare.',
  'canvas.frame.a11y.resize': 'Ridimensiona {label} — larghezza {w}, altezza {h}. I tasti freccia lo ridimensionano, con Maiusc la variazione è maggiore.',
  'canvas.frame.a11y.moved': '{label} spostato a x {x}, y {y}',
  'canvas.frame.a11y.resized': '{label} ridimensionato a larghezza {w}, altezza {h}',
  'rf.node.moveCancelled': 'Spostamento annullato. Il nodo è tornato a x {x}, y {y}',
  'rf.node.moved': 'Nodo selezionato spostato verso {direction}. Nuova posizione, x {x}, y {y}',
  'rf.dir.left': 'sinistra',
  'rf.dir.right': 'destra',
  'rf.dir.up': 'l’alto',
  'rf.dir.down': 'il basso',
  'rf.controls.label': 'Controlli dell’area di disegno',
  'rf.controls.zoomIn': 'Ingrandisci',
  'rf.controls.zoomOut': 'Riduci',
  'rf.controls.fitView': 'Adatta il diagramma alla vista',
  'rf.controls.interactive': 'Attiva o disattiva la modifica dell’area di disegno',
  'rf.handle.label': 'Punto di connessione',
  'rf.node.a11y': 'Premi Invio o Spazio per selezionare questo nodo. Premi Canc per rimuoverlo, Esc per annullare.',
  'rf.node.a11yKeyboard': 'Premi Invio o Spazio per selezionare questo nodo, poi usa i tasti freccia per spostarlo. Premi Canc per rimuoverlo, Esc per annullare.',
  'rf.edge.a11y': 'Premi Invio o Spazio per selezionare questa connessione. Premi Canc per rimuoverla, Esc per annullare.',
} satisfies Record<CanvasKey, string>

export default canvas
