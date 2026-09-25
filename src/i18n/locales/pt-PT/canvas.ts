// docs/localization.md §L3.3 — Canvas surface slice of the `pt-PT` catalog.
// European Portuguese (§L2.16): `ficheiro` never `arquivo`, `guardar` never
// `salvar`, `ligação` never `conexão`, `eliminar` never `excluir`,
// `prima` never `pressione`, `controlo` never `controle`, sentence case,
// `“…”` for user-facing prose.
//
// `tela` STAYS — every occurrence renders English `canvas`, not `screen`, so
// `ecrã` would be a mistranslation rather than a regionalisation.
//
// GLOSSARY, one word per node kind — IDENTICAL to `pt-BR`, because none of
// these eight words is regional (the 8 x 3 contract in `ptPtCopy.test.ts`):
//   Pool `Reservatório` · Source `Fonte` · Drain `Sumidouro` ·
//   Gate `Distribuidor` · Converter `Conversor` · End `Fim` ·
//   Parameter `Parâmetro` · Register `Valor calculado`
//
// `Sumidouro` is the standard Portuguese term for a flow-network SINK, the
// sense this node has; `escoadouro` and `ralo` are plumbing. `Distribuidor`
// because this Gate splits by ratio or picks a branch by probability —
// `comporta` is a floodgate and `portão` a door. `Reservatório` rather than
// `depósito`, which in Brazil is also a bank deposit and would collide with
// the reward-split module's `Carteira` / `Poupança`.
//
// `Register` has ONE Portuguese surface, `Valor calculado` (plural
// `Valores calculados`), across all 10 keys that name it. `Registrador` is
// never used. `registro` stays free for its ordinary log / record senses.
//
// `tela` is the CANVAS (120 occurrences). The English catalog never says
// "screen", so the word is not overloaded here.
//
// `grafo` is the node-edge graph, never `gráfico` — that word belongs to
// charts.
//
// A group FRAME is `quadro`: the product defines it as "a labelled box that
// groups nodes on the canvas", which is what Miro's Brazilian UI calls a
// `quadro`. `moldura` is a picture frame in Portuguese and would describe the
// border rather than the grouping; `área` and `grupo` are already taken by
// this feature's own default labels (`Área {n}`, `Grupo {n}`).

const canvas = {
  'palette.pool.name': 'Reservatório',
  'palette.pool.description': 'Guarda recursos e mostra a quantidade atual. Quando a capacidade enche, ele freia o fluxo que chega.',
  'palette.source.name': 'Fonte',
  'palette.source.description': 'Cria recursos novos a cada passo e os envia aos nós que alimenta.',
  'palette.drain.name': 'Sumidouro',
  'palette.drain.description': 'Puxa recursos dos nós de onde extrai e os remove do sistema.',
  'palette.gate.name': 'Distribuidor',
  'palette.gate.description': 'Divide os recursos recebidos por uma proporção fixa, ou escolhe um ramo por probabilidade e envia por ele. Não guarda nada.',
  'palette.converter.name': 'Conversor',
  'palette.converter.description': 'Consome recursos de entrada e produz recursos de saída na proporção que se definir. Não guarda nada.',
  'palette.end.name': 'Fim',
  'palette.end.description': 'Encerra a execução quando um recurso chega até ele.',
  'palette.parameter.name': 'Parâmetro',
  'palette.parameter.description': 'Um número fixo que se define. Não tem portas, e uma expressão pode referenciá-lo pelo id.',
  'palette.register.name': 'Valor calculado',
  'palette.register.description': 'Avalia uma expressão para o passo atual e mostra o resultado. Não acumula nada, não armazena nada e não tem portas.',
  'palette.addAction': 'Clique, ou arraste para a tela, para adicionar um.',
  'canvas.minimap': 'Minimapa do grafo',
  'canvas.minimap.hide': 'Ocultar o minimapa',
  'canvas.minimap.show': 'Mostrar o minimapa',
  'canvas.lock.lock': 'Bloquear a edição — selecionar e ler continuam ativos',
  'canvas.lock.unlock': 'Desbloquear a edição — mover, conectar e alterar valores',
  'canvas.focus.on': 'Foco desativado — clique para focar o nó selecionado',
  'canvas.focus.off': 'Foco ativado — clique para mostrar o grafo inteiro',
  'canvas.focus.hint': 'Selecione um nó para focar',
  'canvas.focus.rowLabel': 'Focar a seleção',
  'canvas.focus.stateOn': 'Ativado',
  'canvas.focus.stateOff': 'Desativado',
  'canvas.panMode.off': 'Modo de deslocamento desativado — arraste a tela vazia para deslocar',
  'canvas.panMode.on': 'Modo de deslocamento ativado — arraste em qualquer lugar para deslocar',
  'canvas.panMode.rowLabel': 'Modo de deslocamento',
  'canvas.filter.open': 'Filtros — oculte partes do grafo enquanto explora',
  'canvas.filter.close': 'Fechar o painel de filtros',
  'canvas.filter.title': 'Filtros',
  'canvas.filter.rowLabel': 'Filtros',
  'canvas.filter.groupEdgeClass': 'Tipo de ligação',
  'canvas.filter.groupResourceType': 'Tipo de recurso',
  'canvas.filter.groupNodeKind': 'Tipo de nó',
  'canvas.filter.edgeClass.resource': 'Recurso',
  'canvas.filter.edgeClass.state': 'Estado',
  'canvas.filter.edgeClass.hint': 'Indício de dependência',
  'canvas.filter.untyped': 'sem tipo',
  'canvas.filter.clear': 'Limpar os filtros',
  // `check:i18n` requires the ICU argument shape to match `en`, and the base
  // key has a PLAIN `{n}` slot, so this cannot become a plural. The phrase is
  // therefore invariable: `oculto(s)` would disagree with `1`, so the noun
  // carries the number instead.
  'canvas.filter.hiddenCount': '{n} fora de exibição',
  'canvas.filter.none': 'Nada oculto',
  'canvas.filter.checkboxHint': 'marcado = oculto',
  'canvas.nodeKind.source': 'Fonte',
  'canvas.nodeKind.pool': 'Reservatório',
  'canvas.nodeKind.gate': 'Distribuidor',
  'canvas.nodeKind.converter': 'Conversor',
  'canvas.nodeKind.drain': 'Sumidouro',
  'canvas.nodeKind.end': 'Fim',
  'canvas.nodeKind.parameter': 'Parâmetro',
  'canvas.nodeKind.register': 'Valor calculado',
  'canvas.resetView': 'Redefinir a visualização — ajustar o grafo e limpar filtros / foco',
  'canvas.regionSelect.off': 'Selecionar uma região — arraste na tela vazia para selecionar; Shift+arrastar também funciona',
  'canvas.regionSelect.on': 'Selecionar uma região — a selecionar; arraste na tela vazia, Esc para cancelar',
  'canvas.regionSelect.count': '{n, plural, one {# nó selecionado} many {# de nós selecionados} other {# nós selecionados}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# nó selecionado} many {# de nós selecionados} other {# nós selecionados}} · desbloqueie a edição para movê-los',
  'canvas.frame.draw': 'Quadro de grupo — arraste na tela vazia para desenhar um',
  'canvas.frame.drawing': 'Quadro de grupo — a desenhar; arraste na tela vazia, Esc para cancelar',
  'canvas.frame.defaultName': 'Grupo {n}',
  'canvas.frame.delete': 'Eliminar este quadro',
  'canvas.frame.suggest': 'Sugerir quadros — retângulos de agrupamento aproximados em volta de nós conectados estruturalmente. Apenas estrutura; não o significado do domínio.',
  'canvas.frame.suggestStale': 'Sugerir quadros — o grafo mudou; clique para recalcular os grupos sugeridos',
  'canvas.frame.suggestRow': 'Sugerir quadros',
  'canvas.frame.suggestNote': 'Grupos estruturais sugeridos — podem não corresponder à forma como dividiria o trabalho.',
  'canvas.frame.suggestNoteDismiss': 'Dispensar este aviso',
  'canvas.frame.areaName': 'Área {n}',
  'canvas.frame.dismiss': 'Dispensar este quadro sugerido',
  'canvas.frame.clearAll': 'Limpar todos os quadros',
  'canvas.frame.clearSuggested': 'Limpar os quadros sugeridos',
  'canvas.frame.clearSuggestedRow': 'Limpar os quadros sugeridos',
  'canvas.frame.colorRow': 'Cor do quadro',
  'canvas.frame.color.neutral': 'Neutro',
  'canvas.frame.color.slate': 'Ardósia',
  'canvas.frame.color.sage': 'Sálvia',
  'canvas.frame.color.gold': 'Dourado',
  'canvas.frame.color.violet': 'Violeta',
  'canvas.frame.color.rose': 'Rosa',
  'canvas.frame.props.title': 'Configurações do quadro — {label}',
  'canvas.frame.props.name': 'Nome',
  'canvas.activity.off': 'Camada de atividade desativada — clique para realçar as partes ativas recentemente',
  'canvas.activity.on': 'Camada de atividade ativada — clique para ocultar o realce',
  'canvas.activity.rowLabel': 'Camada de atividade',
  'canvas.route.invalidFlag': 'rota inválida — um ponto da rota está dentro de um nó',
  'canvas.edgeLabel.clamp': 'limite',
  'canvas.edgeLabel.clamp.title': 'removido pelo único limite de fim da Fase 0 do Reservatório de destino',
  'canvas.edgeLabel.blocked': 'bloqueado',
  'canvas.edgeLabel.blocked.title': 'entregue, mas o destino não pôde disparar (ativação errada, ou um ativador o manteve fechado)',
  'canvas.edgeLabel.breakdown.title': 'as transferências deste passo por esta ligação',
  'canvas.edgeLabel.refMissing': 'Erro de referência de Parâmetro',
  'node.unreadable.title': '{kind} ilegível',
  'node.unreadable.sub': 'não é possível ler os dados — corrija no ficheiro',
  'node.invalidFlag': 'Este nó é inválido',
  'node.aria.invalid': 'inválido',
  'node.aria.selected': 'selecionado',
  'node.aria.focused': 'em foco',
  'node.evaluatedCue': 'Avaliado neste passo, mas não agiu',
  'node.default.pool': 'Reservatório',
  'node.default.source': 'Fonte',
  'node.default.drain': 'Sumidouro',
  'node.default.gate': 'Distribuidor',
  'node.default.converter': 'Conversor',
  'node.default.end': 'Fim',
  'node.default.parameter': 'Parâmetro',
  'node.default.register': 'Valor calculado',
  'canvas.frame.a11y.roledescription': 'quadro de grupo',
  'canvas.frame.a11y.roledescriptionAuto': 'quadro de grupo sugerido',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# nó} many {# de nós} other {# nós}}',
  'canvas.frame.a11y.desc': 'Prima Enter ou Espaço para selecionar este quadro.',
  'canvas.frame.a11y.descSelected': 'Selecionado. As teclas de seta movem o quadro e tudo o que está dentro dele, Shift para um passo maior. Backspace ou Delete o remove. Escape cancela a seleção.',
  'canvas.frame.a11y.descReadonly': 'Somente leitura — este quadro pode ser selecionado e lido, mas não editado.',
  'canvas.frame.a11y.resize': 'Redimensionar {label} — largura {w}, altura {h}. As teclas de seta redimensionam o quadro, Shift para um passo maior.',
  'canvas.frame.a11y.moved': '{label} — nova posição: x {x}, y {y}',
  'canvas.frame.a11y.resized': '{label} — novo tamanho: largura {w}, altura {h}',
  'rf.node.moveCancelled': 'Movimento cancelado. O nó voltou para x {x}, y {y}',
  'rf.node.moved': 'Nó selecionado movido para {direction}. Nova posição, x {x}, y {y}',
  'rf.dir.left': 'a esquerda',
  'rf.dir.right': 'a direita',
  'rf.dir.up': 'cima',
  'rf.dir.down': 'baixo',
  'rf.controls.label': 'Controlos da tela',
  'rf.controls.zoomIn': 'Aproximar',
  'rf.controls.zoomOut': 'Afastar',
  'rf.controls.fitView': 'Ajustar o diagrama à visualização',
  'rf.controls.interactive': 'Alternar a edição da tela',
  'rf.handle.label': 'Ponto de ligação',
  'rf.node.a11y': 'Prima Enter ou Espaço para selecionar este nó. Prima Delete para removê-lo, Escape para cancelar.',
  'rf.node.a11yKeyboard': 'Prima Enter ou Espaço para selecionar este nó e depois as teclas de seta para movê-lo. Prima Delete para removê-lo, Escape para cancelar.',
  'rf.edge.a11y': 'Prima Enter ou Espaço para selecionar esta ligação. Prima Delete para removê-la, Escape para cancelar.',
} as const

export type CanvasKey = keyof typeof canvas
export default canvas
