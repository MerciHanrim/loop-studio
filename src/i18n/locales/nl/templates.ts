// docs/localization.md §L3.3 — Templates & modules slice of the `nl` catalog.
// Key-checked against `../en/templates` by `satisfies`; same `{name}` slots.
//
// `Sjabloon` Template · `Module` module · `kader` frame · `zone` zone.
// `pity` and `pickup` stay English — see `../../nlCopy.test.ts`, which pins
// each kept token by key so a later edit cannot quietly translate one.

const templates = {
  'templates.button': 'Sjablonen ▾',
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
  'modules.button': 'Module invoegen ▾',
  'modules.menuLabel': 'Module invoegen',
  'modules.fromFile': 'Uit bestand…',
  'modules.extract': 'Selectie als module uitnemen…',
  'modules.bufferedStep.name': 'Productiestap met buffers',
  'modules.bufferedStep.blurb': 'Voegt een productiestap toe met een invoer- en een uitvoerbuffer.',
  'modules.rewardSplit.name': 'Kringloop voor beloningsverdeling',
  'modules.rewardSplit.blurb': 'Voegt een kringloop toe die inkomende beloningen splitst in uitgaven en sparen.',
  'modules.error.title': 'De module kon niet worden ingevoegd',
  'modules.promote.title': 'Hier een parametergestuurd (v2) model van maken?',
  'modules.promote.body': 'Dit blok invoegen maakt van het document een v2-model en de modelsemantiek-digest verandert. Eén keer ongedaan maken draait de modelwijziging en het invoegen samen terug.',
  'modules.promote.confirm': 'Promoveren en invoegen',
  'modules.frames.title': 'Opgeslagen kaders worden niet meegenomen',
  'modules.frames.insertBody': 'Dit bestand bevat opgeslagen groepskaders. Het als module invoegen brengt die kaders niet in je diagram — al het andere wordt gewoon ingevoegd.',
  'modules.frames.extractBody': 'Je diagram bevat opgeslagen groepskaders. Die worden niet in het modulebestand geschreven — alleen de geselecteerde knooppunten en hun onderlinge verbindingen.',
  'modules.frames.continue': 'Doorgaan',
} as const

export default templates
