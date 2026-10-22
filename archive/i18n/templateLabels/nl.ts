// docs/template-label-overlay.md §TLO2 — the `nl` node-`label` overlay for
// bundled Templates. `label` only — never `resourceType`, which stays the
// canonical English advisory value in every locale.
// `check:template-labels` keeps every block in sync with its canonical graph
// (`examples/<id>.json`).
//
// Translated from the ENGLISH originals in those graphs, not from another
// locale's overlay.
//
// GLOSSARY, shared with the catalog (§L2.23): `Voorraad` Pool · `Verdeler`
// Gate · `Omzetter` Converter · `kader` frame · `Sjabloon` Template.
// `tpl-gate` reads `Productieverdeling`, so the gate-typed label and the kind
// name share the `verdel-` stem the way English "Production split" and "Gate"
// do not — the same repair Italian made, for the same reason.
//
// `Level`, NOT `Niveau`. Dutch players say "level" and the graph's own
// `Lv 1-5` abbreviations already assume it; `niveau` is the general-register
// word for a standard or a tier. This is a REGISTER decision taken on its own
// merits. It happens to remove the `fr` string collision flagged while
// surveying, but that was never a reason to choose it: `relabelNodesForLocale`
// keys on the node ID, so two locales sharing a string for the SAME id is a
// no-op either way.
//
// KEPT IN ENGLISH, per the approved contract: `Pity`, `Hard pity`, `Pickup`,
// `Banner`, `Pull`/`Pulls`, `Roll`. `SSR` / `SR` / `R` are rarity letters,
// `XP` is a unit abbreviation and `kg` is a unit, so none is translated
// anywhere. `quest`, `item` and `drop` are settled loans in Dutch games
// writing and are used as Dutch nouns (`Verbruiksdrops`, `Items verkocht`),
// not as bare English. `loot` IS translated, as `buit`, because Dutch has the
// word. All of these are declared in `../nlCopy.test.ts` and listed as open
// review items in §L2.23.
//
// `Gold` IS translated (`Goud`) — the approved contract says so.
//
// `death_pool` reads `Dodenwachtrij` and `death_conv` `Kosten van doodgaan`:
// `sterfgeval` and `overlijden` are the clinical register a death certificate
// uses, and this is a combat model. Flagged as open, the way Italian flagged
// the same decision.
//
// Node ids, resource types and every graph field are untouched. Every string
// here is a `label` and nothing else.

import type { TemplateLabelDict, TemplateLabelMap } from './dicts'

export const nl: TemplateLabelDict = {
  'equilibrium': {
    'tpl-src': 'Materiaalaanvoer',
    'tpl-vault': 'Grondstofvoorraad',
    'tpl-gate': 'Productieverdeling',
    'tpl-conv': 'Bewerking',
    'tpl-prod': 'Gereed product',
    'tpl-spill': 'Uitval',
    'tpl-consume': 'Verzending',
  },
  'deadlock': {
    'tpl-src': 'Materiaalaanvoer',
    'tpl-vault': 'Grondstofvoorraad',
    'tpl-gate': 'Productieverdeling',
    'tpl-conv': 'Bewerking',
    'tpl-prod': 'Gereed product',
    'tpl-spill': 'Uitval',
  },
  'coffee-roastery': {
    cafe_retail_demand_kg: 'Vraag naar bonen café & winkel (kg/dag)',
    daily_roast_kg: 'Dagelijkse brandhoeveelheid (kg)',
    online_orders: 'Online bonenbestellingen (kg/dag)',
    green_wholesale_kg: 'Groothandelsorders groene bonen (kg)',
    dessert_prep: 'Dagelijkse dessertbereiding',
    green_delivery: 'Levering groene bonen',
    green_stock: 'Voorraad groene bonen',
    green_wholesale: 'Groothandel groene bonen',
    roasting: 'Branden · 82% opbrengst',
    roasted_stock: 'Voorraad gebrande bonen',
    roast_loss: 'Gewichtsverlies bij het branden',
    online_sales: 'Online verkoop van verpakte bonen',
    cafe_retail: 'Bonengebruik café & winkel',
    roasted_bleed: 'Personeel, cupping & proeven',
    dessert_prep_src: 'Dessertbereiding',
    dessert_stock: 'Dessertvoorraad',
    dessert_sales: 'Dessertverkoop',
    dessert_wrapup: 'Restant aan het eind van de dag',
    projected_revenue: 'Verwachte dagomzet',
    planned_cost: 'Geplande dagkosten',
    projected_operating_margin: 'Verwachte dagelijkse bedrijfsmarge',
    roasted_supply_margin: 'Marge op gebrande voorraad',
    dessert_prep_margin: 'Marge op dessertbereiding',
  },
  'mmo-progression': {
    level: 'Level',
    xp: 'XP',
    xp_earned: 'XP verdiend',
    reward: 'Beloning',
    fail_pool: 'Tegenslagen',
    death_pool: 'Dodenwachtrij',
    reward_router: 'Beloningsverdeler',
    hunt_payout: 'Uitbetaling jacht',
    quest_payout: 'Uitbetaling quest',
    hunt_xp: 'Jacht-XP',
    quest_xp: 'Quest-XP',
    fail_conv: 'Kosten van tegenslagen',
    death_conv: 'Kosten van doodgaan',
    combat_wins: 'Gevechten gewonnen',
    combat_fails: 'Gevechten verloren',
    deaths: 'Doden (aantal)',
    gold: 'Goud',
    gold_earned: 'Goud verdiend',
    vendor_revenue: 'Opbrengst handelaar',
    repair_spend: 'Uitgaven reparatie',
    resupply_spend: 'Uitgaven bevoorrading',
    training_spend: 'Uitgaven training',
    water: 'Water (eenheden)',
    food: 'Voedsel (eenheden)',
    water_bought: 'Water gekocht (eenheden)',
    food_bought: 'Voedsel gekocht (eenheden)',
    water_consumed: 'Water verbruikt (eenheden)',
    food_consumed: 'Voedsel verbruikt (eenheden)',
    water_upkeep: 'Waterverbruik',
    food_upkeep: 'Voedselverbruik',
    resupply: 'Bevoorrading',
    gear_score: 'Uitrustingsscore',
    gear_wear: 'Uitrustingsslijtage',
    wear_cleared: 'Slijtage hersteld',
    repair_wear: 'Reparatie (slijtage)',
    repair_gold: 'Reparatie (rekening)',
    drop: 'Drops',
    loot_feed: 'Buit om te sorteren',
    loot_dispatch: 'Buitverdeling',
    loot_category: 'Buitcategorie',
    bucket_equip: 'Uitrustingsdrops',
    bucket_vendor: 'Verkoopdrops',
    bucket_consumable: 'Verbruiksdrops',
    bucket_rare: 'Zeldzame drops',
    items_looted: 'Items buitgemaakt',
    items_equipped: 'Items uitgerust',
    items_sold: 'Items verkocht',
    items_consumed: 'Items verbruikt',
    equip_conv: 'Uitrusten',
    vendor_conv: 'Verkopen aan de handelaar',
    consumable_conv: 'Verbruiksitem gebruiken',
    rare_conv: 'Zeldzaam item verkopen',
    elapsed: 'Verstreken stappen',
    clock: 'Klok',
    completion: 'Voltooiing',
    completion_src: 'Voltooiingspuls',
    end15: 'Level 15 bereikt',
    z1_enc_src: 'Startgebied-ontmoetingen',
    z1_enc: 'Startgebied · Lv 1–5',
    z1_combat: 'Startgebied-gevechten',
    z1_win: 'Startgebied-overwinning',
    z1_winamp: 'Startgebied-zege',
    z1_lootroll: 'Startgebied-buitworp',
    z1_loot: 'Startgebied-buit',
    z1_xp_meter: 'Startgebied-XP-meter',
    z1_xp2lvl: 'Startgebied-levelstijging',
    z1_training: 'Startgebied-training',
    z2_enc_src: 'Heuvelland-ontmoetingen',
    z2_enc: 'Heuvelland · Lv 5–10',
    z2_combat: 'Heuvelland-gevechten',
    z2_win: 'Heuvelland-overwinning',
    z2_winamp: 'Heuvelland-zege',
    z2_lootroll: 'Heuvelland-buitworp',
    z2_loot: 'Heuvelland-buit',
    z2_xp_meter: 'Heuvelland-XP-meter',
    z2_xp2lvl: 'Heuvelland-levelstijging',
    z2_training: 'Heuvelland-training',
    z3_enc_src: 'Hoogland-ontmoetingen',
    z3_enc: 'Hoogland · Lv 10–15',
    z3_combat: 'Hoogland-gevechten',
    z3_win: 'Hoogland-overwinning',
    z3_winamp: 'Hoogland-zege',
    z3_lootroll: 'Hoogland-buitworp',
    z3_loot: 'Hoogland-buit',
    z3_xp_meter: 'Hoogland-XP-meter',
    z3_xp2lvl: 'Hoogland-levelstijging',
    z3_training: 'Hoogland-training',
    void: 'Geen drop',
    char_creation: 'Personage aanmaken',
    active_char: 'Actief personage',
    r_income: 'Totale inkomsten',
    r_expense: 'Totale uitgaven',
    r_netgold: 'Controle netto goud',
    r_huntshare: 'Aandeel jacht-XP',
    r_efflevel: 'XP-tempo-index',
    r_items_acct: 'Items verantwoord',
    r_burned: 'Verbruiksitems opgebruikt',
  },
  'gacha-banner-zones': {
    pulls_per_zone: 'Pulls per zone (geheel getal)',
    cmp1_hit_rate_free: 'Trefkans — Algemeen / Gratis',
    cmp2_hit_rate_standard: 'Trefkans — Premium Standaard',
    cmp3_hit_rate_pickup: 'Trefkans — Premium Pickup',
    cmp4_pickup_rate_pickup: 'Pickup-kans — Premium Pickup',
    fund_free: 'Tickets financieren',
    ticket_free: 'Tickets',
    pulls_made_free: 'Uitgevoerde pulls',
    zone1_free_w_ssr: 'Algemeen / Gratis · SSR-gewicht',
    zone1_free_w_sr: 'Algemeen / Gratis · SR-gewicht',
    zone1_free_w_r: 'Algemeen / Gratis · R-gewicht',
    sr_count_free: 'Aantal SR',
    r_count_free: 'Aantal R',
    ssr_count_free: 'Gratis SSR',
    roll_gate_free: 'Roll',
    ssr_hit_free: 'SSR',
    sr_hit_free: 'SR',
    r_hit_free: 'R',
    fund_standard: 'Tickets financieren',
    ticket_standard: 'Tickets',
    pulls_made_standard: 'Uitgevoerde pulls',
    zone2_standard_w_ssr: 'Premium Standaard · SSR-gewicht',
    zone2_standard_w_sr: 'Premium Standaard · SR-gewicht',
    zone2_standard_w_r: 'Premium Standaard · R-gewicht',
    sr_count_standard: 'Aantal SR',
    r_count_standard: 'Aantal R',
    ssr_count_standard: 'Standaard SSR',
    roll_gate_standard: 'Roll',
    ssr_hit_standard: 'SSR',
    sr_hit_standard: 'SR',
    r_hit_standard: 'R',
    pity_standard: 'Pity',
    zone2_standard_hard_pity: 'Premium Standaard · Hard pity-plafond',
    forced_ssr_standard: 'Geforceerde SSR',
    ceiling_hits_standard: 'Plafondtreffers',
    fund_pickup: 'Tickets financieren',
    ticket_pickup: 'Tickets',
    pulls_made_pickup: 'Uitgevoerde pulls',
    zone3_pickup_w_ssr: 'Premium Pickup · SSR-gewicht',
    zone3_pickup_w_sr: 'Premium Pickup · SR-gewicht',
    zone3_pickup_w_r: 'Premium Pickup · R-gewicht',
    sr_count_pickup: 'Aantal SR',
    r_count_pickup: 'Aantal R',
    ssr_count_pickup: 'Pickup-SSR',
    pity_pickup: 'Pity',
    zone3_pickup_hard_pity: 'Premium Pickup · Hard pity-plafond',
    ceiling_hits_pickup: 'Plafondtreffers',
    missed_pickup_pickup: 'Pickup verschuldigd',
    zone3_pickup_w_pickup: 'Premium Pickup · Pickup-gewicht',
    zone3_pickup_w_standard: 'Premium Pickup · Standaard-gewicht',
    roll_normal_open_pickup: 'Roll — normaal, niet verschuldigd',
    roll_normal_owed_pickup: 'Roll — normaal, verschuldigd',
    roll_forced_open_pickup: 'Roll — geforceerd, niet verschuldigd',
    roll_forced_owed_pickup: 'Roll — geforceerd, verschuldigd',
    ssr_split_open_pickup: 'SSR-splitsing — niet verschuldigd',
    pickup_hit_pickup: 'Pickup-treffer',
    standard_hit_pickup: 'Standaard-treffer',
    sr_hit_pickup: 'SR',
    r_hit_pickup: 'R',
    pickup_count_pickup: 'Pickup-winsten',
    standard_count_pickup: 'Aantal standaardtreffers',
    termination_fuel: 'Voltooiingssignaal',
    all_zones_done: 'Alle zones voltooid',
  },
}

export const nlFrames: TemplateLabelMap = {
  'coffee-roastery': {
    zone_supply: 'Aanvoer & voorraad',
    zone_roasting: 'Branden & verkoop',
    zone_forecast: 'Prognosecijfers',
  },
  'gacha-banner-zones': {
    zone_comparison: 'Vergelijking',
    zone_free: 'Algemeen / Gratis',
    zone_standard: 'Premium Standaard',
    zone_pickup: 'Premium Pickup',
  },
}
