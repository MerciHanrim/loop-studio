// docs/localization.md §L3.3 — Templates & modules slice of the `pt-PT`
// catalog. European Portuguese (§L2.16): `ficheiro` never `arquivo`,
// `guardar` never `salvar`, `existências` never `estoque`, sentence case,
// `“…”` for user-facing prose. `tela` stays — it renders `canvas`.
//
// `etapa` is the PROCESS sense of "step" (a stage of a production line);
// `passo` is reserved for the simulation timestep and its commands.
//
// **`Template` is deliberately NOT `Modelo`.** Kept from `pt-BR`, and for the
// same reason, which is not regional: `modelo` is already this product's word
// for the simulation MODEL — 10 keys and 14 occurrences say "the model", "a
// v2 model", "model versions", "run the model". Using one word for both would
// make `modules.promote.*` read as though loading a Template changed the
// model version. The anglicism is the clearer of the two in Portugal as well
// (native review pending). Sentence case is kept unchanged from `pt-BR`.
//
// CASE: it is an ordinary common noun, not a proper name. `Template` /
// `Templates` only where UI context capitalises the first word (a menu button,
// a menu label); `template` / `templates` everywhere inside a sentence.
// The English-residue guard allows the word ONLY on the keys that own the
// template concept, never catalog-wide.

const templates = {
  'templates.button': 'Templates',
  'templates.menuLabel': 'Templates',
  'templates.equilibrium.name': 'Linha de produção equilibrada',
  // Same shape the Spanish blurb was measured into: an action sentence with
  // the four beats intact (material in, goods out, scrap discarded, the line
  // settling) rather than the English noun-phrase list, which needs a third
  // line in the 272 px box. Re-measured in that box before this ships.
  'templates.equilibrium.blurb': 'Entra material, saem produtos e sai refugo; a linha se estabiliza em poucos passos.',
  'templates.deadlock.name': 'Bloqueio por capacidade',
  'templates.deadlock.blurb': 'A mesma linha sem a etapa de expedição: as existências enchem até ao limite e tudo para.',
  'templates.mmoProgression.name': 'Progressão inicial de MMO (níveis 1–15)',
  'templates.mmoProgression.blurb': 'Três zonas de missões, caçadas e recompensas: quanto tempo leva para chegar ao nível 15.',
  'templates.coffeeRoastery.name': 'Fluxo de operações de uma torrefação de café',
  'templates.coffeeRoastery.blurb': 'Como torra, vendas e existências se puxam ao longo de um dia de operação.',
  'templates.gachaBannerZones.name': 'Comparação de banners de gacha em 3 zonas',
  // `pity` and `UP` are what Brazilian gacha players say; translating them
  // would name nothing the reader recognises (template-scoped, guarded).
  'templates.gachaBannerZones.blurb': 'Três banners com um mesmo orçamento, para ver o que o pity e o UP garantido mudam.',
  'templates.replace.title': 'Carregar este template?',
  'templates.replace.body': 'O seu trabalho atual será substituído por: {name}',
  'templates.replace.confirm': 'Carregar template',
  'modules.extract': 'Guardar a estrutura selecionada…',
  'modules.error.title': 'Não foi possível inserir a estrutura',
  'modules.promote.title': 'Tornar isto um modelo orientado a parâmetros (v2)?',
  'modules.promote.body': 'Inserir esta estrutura converte o documento num modelo v2 e altera o resumo de semântica do modelo. Um único desfazer reverte de uma vez a mudança de modelo e a inserção.',
  'modules.promote.confirm': 'Converter e inserir',
  'modules.frames.title': 'Os quadros guardados não são incluídos',
  'modules.frames.insertBody': 'Este ficheiro tem quadros de grupo guardados. Inseri-lo como estrutura não traz os quadros para o seu grafo; todo o resto é inserido normalmente.',
  'modules.frames.extractBody': 'O seu grafo tem quadros de grupo guardados. Não são gravados no ficheiro da estrutura: somente os nós selecionados e as suas ligações internas são.',
  'modules.frames.continue': 'Continuar',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Gacha geral',
  'templates.gachaGeneral.blurb': 'Um banner, sem pity. A taxa de acerto é contada sobre a meta de invocações; a execução para ali.',
  'templates.gachaStandard.name': 'Gacha padrão',
  'templates.gachaStandard.blurb': 'Um banner com limite de Hard Pity: no limite, a próxima invocação é um SSR forçado.',
  'templates.gachaPickup.name': 'Gacha UP',
  'templates.gachaPickup.blurb': 'Pity e garantia de UP: depois de um SSR fora do UP, o próximo SSR é o UP.',
  'modules.insertSaved': 'Inserir estrutura guardada…',
  'modules.insertSaved.blurb': 'Adiciona a este documento um ficheiro de estrutura que guardou.',
  'modules.insertSaved.locked': 'Indisponível enquanto a edição está bloqueada',
  'modules.extract.blurb': 'Guarda num ficheiro os nós selecionados e as ligações entre eles.',
} as const

export type TemplatesKey = keyof typeof templates
export default templates
