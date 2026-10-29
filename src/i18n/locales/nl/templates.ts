// docs/localization.md §L3.3 — Templates & modules slice of the `nl` catalog.
// Key-checked against `../en/templates` by `satisfies`; same `{name}` slots.
//
// `Sjabloon` Template · `Module` module · `kader` frame · `zone` zone.
// `pity` and `pickup` stay English — see `../../nlCopy.test.ts`, which pins
// each kept token by key so a later edit cannot quietly translate one.

const templates = {
  'templates.button': 'Sjablonen',
  'templates.menuLabel': 'Sjablonen',
  'templates.equilibrium.name': 'Gebalanceerde productielijn',
  'templates.equilibrium.blurb': 'Materiaal in, bewerking en uitval, eindproduct uit — een lijn die na enkele stappen stabiliseert.',
  'templates.deadlock.name': 'Capaciteitsimpasse',
  'templates.deadlock.blurb': 'Dezelfde lijn zonder verzendstap: de voorraad loopt vol tot de capaciteit en alles stopt.',
  'templates.mmoProgression.name': 'Vroege MMO-progressie (level 1–15)',
  'templates.mmoProgression.blurb': 'Drie zones met quests, jachten en beloningen — hoe lang level 15 halen duurt.',
  'templates.coffeeRoastery.name': 'Operationele stroom van een koffiebranderij',
  'templates.coffeeRoastery.blurb': 'Hoe branden, verkoop en voorraad een handelsdag lang aan elkaar trekken.',
  'templates.gachaBannerZones.name': 'Gacha-bannervergelijking met 3 zones',
  'templates.gachaBannerZones.blurb': 'Drie banners op één budget, om te zien wat pity en een pickup-garantie veranderen.',
  'templates.replace.title': 'Dit sjabloon laden?',
  'templates.replace.body': 'Je huidige werk wordt vervangen door: {name}',
  'templates.replace.confirm': 'Sjabloon laden',
  'modules.extract': 'Geselecteerde structuur opslaan…',
  'modules.error.title': 'De structuur kon niet worden ingevoegd',
  'modules.promote.title': 'Hier een parametergestuurd (v2) model van maken?',
  'modules.promote.body': 'Deze structuur invoegen maakt van het document een v2-model en de modelsemantiek-digest verandert. Eén keer ongedaan maken draait de modelwijziging en het invoegen samen terug.',
  'modules.promote.confirm': 'Promoveren en invoegen',
  'modules.frames.title': 'Opgeslagen kaders worden niet meegenomen',
  'modules.frames.insertBody': 'Dit bestand bevat opgeslagen groepskaders. Het als structuur invoegen brengt die kaders niet in je diagram — al het andere wordt gewoon ingevoegd.',
  'modules.frames.extractBody': 'Je diagram bevat opgeslagen groepskaders. Die worden niet in het structuurbestand geschreven — alleen de geselecteerde knooppunten en hun onderlinge verbindingen.',
  'modules.frames.continue': 'Doorgaan',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Algemene gacha',
  'templates.gachaGeneral.blurb': 'Eén banner, geen pity. De trefkans wordt berekend over het doelaantal pulls; daar stopt de run.',
  'templates.gachaStandard.name': 'Standaardgacha',
  'templates.gachaStandard.blurb': 'Eén banner met een hard pity-plafond: bij het plafond is de volgende pull een geforceerde SSR.',
  'templates.gachaPickup.name': 'Pickup-gacha',
  'templates.gachaPickup.blurb': 'Pity en een pickup-garantie: na een niet-pickup-SSR is de volgende SSR de pickup.',
  'modules.insertSaved': 'Opgeslagen structuur invoegen…',
  'modules.insertSaved.blurb': 'Voegt een structuurbestand dat je hebt opgeslagen toe aan dit document.',
  'modules.insertSaved.locked': 'Niet beschikbaar zolang bewerken vergrendeld is',
  'modules.extract.blurb': 'Slaat de geselecteerde knooppunten en de verbindingen ertussen op in een bestand.',
} as const

export default templates
