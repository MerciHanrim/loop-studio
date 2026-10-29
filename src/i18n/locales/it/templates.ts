// docs/localization.md §L2.22 — Italian, the Templates & modules slice.
//
// GLOSSARY, fixed before this file was written:
//   Template `Modello` · Module `Modulo` · Frame `Riquadro` ·
//   group frame `riquadro di gruppo` · Zone `Zona` · step (simulation) `passo` ·
//   step (a stage in a process) `fase`
//
// `Modello` for Template even though the product also talks about "the model":
// the ONE sentence where they collide (`tour.desktop.playback.body`) is
// translated contextually instead, so the product noun keeps its proper name.
//
// STEP is not one word here. `templates.deadlock.blurb` and both
// `modules.bufferedStep.*` keys mean a STAGE IN A PROCESS (`fase`), not the
// simulation tick (`passo`) — mixing them would say the production line is
// missing a simulation tick.
//
// `Pity` and `pickup` stay English in `templates.gachaBannerZones.blurb`; there
// is no authoritative Italian games source for either, and a majority across
// unrelated locales is not evidence about Italian (docs §L2.22, open item 4).

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': 'Modelli',
  'templates.menuLabel': 'Modelli',
  'templates.equilibrium.name': 'Linea di produzione bilanciata',
  // Deliberately shorter than a literal rendering of the English. The menu
  // blurb box fits TWO lines at 298 px and Italian runs long: the first draft
  // (115 characters) wrapped to three and
  // `descriptive-copy-wrapping.spec.ts` caught it. This keeps the sentence's
  // content and drops the padding, at 77 characters.
  'templates.equilibrium.blurb': 'Materiali in entrata, lavorazione e scarti, prodotti finiti in uscita: si assesta in pochi passi.',
  'templates.deadlock.name': 'Stallo da capacità',
  'templates.deadlock.blurb': 'La stessa linea senza la fase di spedizione: le scorte saturano la capacità e tutto si ferma.',
  'templates.mmoProgression.name': 'Progressione MMO iniziale (livelli 1–15)',
  'templates.mmoProgression.blurb': 'Tre zone di missioni, cacce e ricompense: quanto tempo serve per arrivare al livello 15.',
  'templates.coffeeRoastery.name': 'Flusso operativo di una torrefazione',
  'templates.coffeeRoastery.blurb': 'Come tostatura, vendite e scorte attingono alle stesse risorse in una giornata di lavoro.',
  'templates.gachaBannerZones.name': 'Confronto fra tre banner gacha',
  'templates.gachaBannerZones.blurb': 'Tre banner con lo stesso budget, per vedere che cosa cambiano il pity e una garanzia di pickup.',
  'templates.replace.title': 'Caricare questo modello?',
  'templates.replace.body': 'Il lavoro attuale verrà sostituito con: {name}',
  'templates.replace.confirm': 'Carica il modello',
  'modules.extract': 'Salva la struttura selezionata…',
  // 68 characters, in line with the other locales; the 79-character draft
  // wrapped to a third line.
  'modules.error.title': 'Impossibile inserire la struttura',
  'modules.promote.title': 'Trasformarlo in un modello guidato da parametri (v2)?',
  'modules.promote.body': 'Inserire questa struttura converte il documento in un modello v2 e il digest della semantica del modello cambia. Un solo annullamento riporta indietro sia la conversione sia l’inserimento.',
  'modules.promote.confirm': 'Converti e inserisci',
  'modules.frames.title': 'I riquadri salvati non sono inclusi',
  'modules.frames.insertBody': 'Questo file contiene riquadri di gruppo salvati. Inserirlo come struttura non porta i riquadri nel tuo grafo: tutto il resto viene inserito normalmente.',
  'modules.frames.extractBody': 'Il tuo grafo contiene riquadri di gruppo salvati. Non vengono scritti nel file della struttura: ci finiscono solo i nodi selezionati e le connessioni fra loro.',
  'modules.frames.continue': 'Continua',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Gacha generale',
  'templates.gachaGeneral.blurb': 'Un banner, senza pity. Il tasso di successo si calcola sui pull obiettivo; l’esecuzione si ferma lì.',
  'templates.gachaStandard.name': 'Gacha standard',
  'templates.gachaStandard.blurb': 'Un banner con una soglia di hard pity: alla soglia il pull successivo è un SSR forzato.',
  'templates.gachaPickup.name': 'Gacha con pickup',
  'templates.gachaPickup.blurb': 'Pity e garanzia di pickup: dopo un SSR fuori pickup, il prossimo SSR è il pickup.',
  'modules.insertSaved': 'Inserisci struttura salvata…',
  'modules.insertSaved.blurb': 'Aggiunge a questo documento un file di struttura che hai salvato.',
  'modules.insertSaved.locked': 'Non disponibile mentre le modifiche sono bloccate',
  'modules.extract.blurb': 'Salva in un file i nodi selezionati e le connessioni fra loro.',
} satisfies Record<TemplatesKey, string>

export default templates
