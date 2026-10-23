// docs/template-label-overlay.md §TLO2 — the `it` node-`label` overlay for
// bundled Templates. `label` only — never `resourceType`, which stays the
// canonical English advisory value in every locale.
// `check:template-labels` keeps every block in sync with its canonical graph
// (`examples/<id>.json`).
//
// Translated from the ENGLISH originals in those graphs, not from another
// locale's overlay.
//
// GLOSSARY, shared with the catalog (§L2.22): `Serbatoio` Pool ·
// `Ripartitore` Gate · `Convertitore` Converter · `Riquadro` frame ·
// `Modello` Template. `tpl-gate` reads `Ripartizione della produzione` so the
// gate-typed label and the kind name share the `ripart-` stem, the way the
// English "Production split" and "Gate" do not — Vietnamese shipped a Gate
// name that contradicted its own gate labels and that is not repeated here.
//
// KEPT IN ENGLISH, per the approved contract: `Pity`, `Hard pity`, `Pickup`,
// `Banner`, `Pull`. `SSR` / `SR` / `R` are rarity letters and `XP` is a unit
// abbreviation, so neither is translated anywhere.
//
// TWO ADDITIONS I made to that list, flagged for review rather than assumed:
//   • `Roll` — the gacha ACTION, a near-synonym of `Pull`. Translating it
//     while `Pull` stays English would make this Template contradict itself
//     inside one screen, which is exactly the defect the Vietnamese read-back
//     found. It stays English WITH `Pull`, not instead of it.
//   • `Drop` — a settled loanword in Italian games writing, used as the head
//     of the compounds (`Drop da equipaggiare`) rather than as a bare English
//     noun. `loot` IS translated, as `bottino`, because Italian has the word.
// Both are recorded as open in §L2.22 alongside the five.
//
// `Gold` IS translated (`Oro`) — the approved contract says so, and eleven of
// the other dictionaries do the same. It survives in English only in
// `inspector.resourceType.placeholder`, which lists canonical `resourceType`
// tokens rather than UI copy.
//
// `death_pool` reads `Coda delle morti`, not `decessi`: `decesso` is the
// clinical register a death certificate uses. Vietnamese shipped the clinical
// word here and it is an open review item there; Italian takes the plain one.
//
// Node ids, resource types and every graph field are untouched. Every string
// here is NFC.

import type { TemplateLabelDict, TemplateLabelMap } from './dicts'

export const it: TemplateLabelDict = {
  'equilibrium': {
    'tpl-src': 'Fornitura di materiale',
    'tpl-vault': 'Magazzino materie prime',
    'tpl-gate': 'Ripartizione della produzione',
    'tpl-conv': 'Lavorazione',
    'tpl-prod': 'Prodotti finiti',
    'tpl-spill': 'Scarti',
    'tpl-consume': 'Spedizione',
  },
  'deadlock': {
    'tpl-src': 'Fornitura di materiale',
    'tpl-vault': 'Magazzino materie prime',
    'tpl-gate': 'Ripartizione della produzione',
    'tpl-conv': 'Lavorazione',
    'tpl-prod': 'Prodotti finiti',
    'tpl-spill': 'Scarti',
  },
  'coffee-roastery': {
    cafe_retail_demand_kg: 'Fabbisogno di caffè in grani per bar e dettaglio (kg/giorno)',
    daily_roast_kg: 'Quantità tostata al giorno (kg)',
    online_orders: 'Ordini online di caffè in grani (kg/giorno)',
    green_wholesale_kg: 'Ordini all’ingrosso di caffè verde (kg)',
    dessert_prep: 'Preparazione dolci giornaliera',
    green_delivery: 'Consegna di caffè verde',
    green_stock: 'Scorte di caffè verde',
    green_wholesale: 'Vendita all’ingrosso di caffè verde',
    roasting: 'Tostatura · resa 82%',
    roasted_stock: 'Scorte di caffè tostato',
    roast_loss: 'Calo di peso in tostatura',
    online_sales: 'Vendite online di caffè confezionato',
    cafe_retail: 'Caffè in grani usato in bar e al dettaglio',
    roasted_bleed: 'Personale, assaggi e campionature',
    dessert_prep_src: 'Preparazione dolci',
    dessert_stock: 'Scorte di dolci',
    dessert_sales: 'Vendita di dolci',
    dessert_wrapup: 'Rimanenze di fine giornata',
    projected_revenue: 'Ricavo giornaliero previsto',
    planned_cost: 'Costo giornaliero pianificato',
    projected_operating_margin: 'Margine operativo giornaliero previsto',
    roasted_supply_margin: 'Margine sulle scorte di caffè tostato',
    dessert_prep_margin: 'Margine sulla preparazione dolci',
  },
  'mmo-progression': {
    level: 'Livello',
    xp: 'XP',
    xp_earned: 'XP guadagnati',
    reward: 'Ricompensa',
    fail_pool: 'Battute d’arresto',
    death_pool: 'Coda delle morti',
    reward_router: 'Ripartitore delle ricompense',
    hunt_payout: 'Resa della caccia',
    quest_payout: 'Resa della missione',
    hunt_xp: 'XP da caccia',
    quest_xp: 'XP da missione',
    fail_conv: 'Costo della battuta d’arresto',
    death_conv: 'Costo della morte',
    combat_wins: 'Combattimenti vinti',
    combat_fails: 'Combattimenti persi',
    deaths: 'Morti (conteggio)',
    gold: 'Oro',
    gold_earned: 'Oro guadagnato',
    vendor_revenue: 'Ricavo dalla vendita ai mercanti',
    repair_spend: 'Spesa per riparazioni',
    resupply_spend: 'Spesa per rifornimenti',
    training_spend: 'Spesa per addestramento',
    water: 'Acqua (unità)',
    food: 'Cibo (unità)',
    water_bought: 'Acqua acquistata (unità)',
    food_bought: 'Cibo acquistato (unità)',
    water_consumed: 'Acqua consumata (unità)',
    food_consumed: 'Cibo consumato (unità)',
    water_upkeep: 'Mantenimento dell’acqua',
    food_upkeep: 'Mantenimento del cibo',
    resupply: 'Rifornimento',
    gear_score: 'Punteggio equipaggiamento',
    gear_wear: 'Usura dell’equipaggiamento',
    wear_cleared: 'Usura eliminata',
    repair_wear: 'Riparazione (usura)',
    repair_gold: 'Riparazione (spesa)',
    drop: 'Drop',
    loot_feed: 'Bottino da smistare',
    loot_dispatch: 'Smistamento del bottino',
    loot_category: 'Categoria del bottino',
    bucket_equip: 'Drop da equipaggiare',
    bucket_vendor: 'Drop da vendere',
    bucket_consumable: 'Drop di consumabili',
    bucket_rare: 'Drop rari',
    items_looted: 'Oggetti raccolti',
    items_equipped: 'Oggetti equipaggiati',
    items_sold: 'Oggetti venduti',
    items_consumed: 'Oggetti consumati',
    equip_conv: 'Equipaggia',
    vendor_conv: 'Vendi al mercante',
    consumable_conv: 'Usa il consumabile',
    rare_conv: 'Vendi il raro',
    elapsed: 'Passi trascorsi',
    clock: 'Orologio',
    completion: 'Completamento',
    completion_src: 'Impulso di completamento',
    end15: 'Livello 15 raggiunto',
    z1_enc_src: 'Incontri della Zona iniziale',
    z1_enc: 'Zona iniziale · Lv 1–5',
    z1_combat: 'Combattimento della Zona iniziale',
    z1_win: 'Vittoria della Zona iniziale',
    z1_winamp: 'Vittoria Zona iniziale',
    z1_lootroll: 'Tiro bottino Zona iniziale',
    z1_loot: 'Bottino della Zona iniziale',
    z1_xp_meter: 'Contatore XP Zona iniziale',
    z1_xp2lvl: 'Passaggio di livello Zona iniziale',
    z1_training: 'Addestramento della Zona iniziale',
    z2_enc_src: 'Incontri delle Colline',
    z2_enc: 'Colline · Lv 5–10',
    z2_combat: 'Combattimento delle Colline',
    z2_win: 'Vittoria delle Colline',
    z2_winamp: 'Vittoria Colline',
    z2_lootroll: 'Tiro bottino Colline',
    z2_loot: 'Bottino delle Colline',
    z2_xp_meter: 'Contatore XP Colline',
    z2_xp2lvl: 'Passaggio di livello Colline',
    z2_training: 'Addestramento delle Colline',
    z3_enc_src: 'Incontri degli Altopiani',
    z3_enc: 'Altopiani · Lv 10–15',
    z3_combat: 'Combattimento degli Altopiani',
    z3_win: 'Vittoria degli Altopiani',
    z3_winamp: 'Vittoria Altopiani',
    z3_lootroll: 'Tiro bottino Altopiani',
    z3_loot: 'Bottino degli Altopiani',
    z3_xp_meter: 'Contatore XP Altopiani',
    z3_xp2lvl: 'Passaggio di livello Altopiani',
    z3_training: 'Addestramento degli Altopiani',
    void: 'Nessun drop',
    char_creation: 'Creazione del personaggio',
    active_char: 'Personaggio attivo',
    r_income: 'Entrate totali',
    r_expense: 'Uscite totali',
    r_netgold: 'Verifica dell’oro netto',
    r_huntshare: 'Quota di XP da caccia',
    r_efflevel: 'Indice di ritmo degli XP',
    r_items_acct: 'Oggetti contabilizzati',
    r_burned: 'Consumabili usati',
  },
  'gacha-banner-zones': {
    pulls_per_zone: 'Pull per zona (numero intero)',
    cmp1_hit_rate_free: 'Tasso di successo — Generale / Gratuito',
    cmp2_hit_rate_standard: 'Tasso di successo — Premium Standard',
    cmp3_hit_rate_pickup: 'Tasso di successo — Premium Pickup',
    cmp4_pickup_rate_pickup: 'Tasso di Pickup — Premium Pickup',
    fund_free: 'Ricarica biglietti',
    ticket_free: 'Biglietti',
    pulls_made_free: 'Pull effettuati',
    zone1_free_w_ssr: 'Generale / Gratuito · peso SSR',
    zone1_free_w_sr: 'Generale / Gratuito · peso SR',
    zone1_free_w_r: 'Generale / Gratuito · peso R',
    sr_count_free: 'Conteggio SR',
    r_count_free: 'Conteggio R',
    ssr_count_free: 'SSR dal Gratuito',
    roll_gate_free: 'Roll',
    ssr_hit_free: 'SSR',
    sr_hit_free: 'SR',
    r_hit_free: 'R',
    fund_standard: 'Ricarica biglietti',
    ticket_standard: 'Biglietti',
    pulls_made_standard: 'Pull effettuati',
    zone2_standard_w_ssr: 'Premium Standard · peso SSR',
    zone2_standard_w_sr: 'Premium Standard · peso SR',
    zone2_standard_w_r: 'Premium Standard · peso R',
    sr_count_standard: 'Conteggio SR',
    r_count_standard: 'Conteggio R',
    ssr_count_standard: 'SSR dallo Standard',
    roll_gate_standard: 'Roll',
    ssr_hit_standard: 'SSR',
    sr_hit_standard: 'SR',
    r_hit_standard: 'R',
    pity_standard: 'Pity',
    zone2_standard_hard_pity: 'Premium Standard · soglia di Hard pity',
    forced_ssr_standard: 'SSR forzato',
    ceiling_hits_standard: 'Soglie raggiunte',
    fund_pickup: 'Ricarica biglietti',
    ticket_pickup: 'Biglietti',
    pulls_made_pickup: 'Pull effettuati',
    zone3_pickup_w_ssr: 'Premium Pickup · peso SSR',
    zone3_pickup_w_sr: 'Premium Pickup · peso SR',
    zone3_pickup_w_r: 'Premium Pickup · peso R',
    sr_count_pickup: 'Conteggio SR',
    r_count_pickup: 'Conteggio R',
    ssr_count_pickup: 'SSR dal Pickup',
    pity_pickup: 'Pity',
    zone3_pickup_hard_pity: 'Premium Pickup · soglia di Hard pity',
    ceiling_hits_pickup: 'Soglie raggiunte',
    missed_pickup_pickup: 'Pickup dovuto',
    zone3_pickup_w_pickup: 'Premium Pickup · peso Pickup',
    zone3_pickup_w_standard: 'Premium Pickup · peso Standard',
    roll_normal_open_pickup: 'Roll — normale, non dovuto',
    roll_normal_owed_pickup: 'Roll — normale, dovuto',
    roll_forced_open_pickup: 'Roll — forzato, non dovuto',
    roll_forced_owed_pickup: 'Roll — forzato, dovuto',
    ssr_split_open_pickup: 'Ripartizione SSR — non dovuto',
    pickup_hit_pickup: 'Pickup centrato',
    standard_hit_pickup: 'Standard centrato',
    sr_hit_pickup: 'SR',
    r_hit_pickup: 'R',
    pickup_count_pickup: 'Pickup ottenuti',
    standard_count_pickup: 'Conteggio Standard',
    termination_fuel: 'Segnale di completamento',
    all_zones_done: 'Tutte le zone completate',
  },
}

/** docs/localization.md §L4.5b — the saved-frame title overlay. Same shape and
 *  the same rule as the node dict above: `label` only, keyed by frame id. */
export const itFrames: TemplateLabelMap = {
  'coffee-roastery': {
    zone_supply: 'Fornitura e scorte',
    zone_roasting: 'Tostatura e vendite',
    zone_forecast: 'Metriche di previsione',
  },
  'gacha-banner-zones': {
    zone_comparison: 'Confronto',
    zone_free: 'Generale / Gratuito',
    zone_standard: 'Premium Standard',
    zone_pickup: 'Premium Pickup',
  },
}
