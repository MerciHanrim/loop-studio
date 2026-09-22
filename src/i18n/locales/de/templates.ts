// docs/localization.md §L3.3 — the Templates & modules slice of the `de`
// catalog. `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a
// missing or an extra key against `../en/templates`.
//
// Glossary: Vorlage template · Modul module · Projekt project · Gruppenrahmen
// group frame · importieren/exportieren · Speicher Pool · Schritt step.
//
// `Schritt` covers BOTH senses (§L2.12). A simulation timestep is
// `Schritt 12 von 30`; a stage of a procedure is `Arbeitsschritt` or
// `Produktionsschritt` where the context needs naming. German does not need
// the two-term split French does.
//
// Style: impersonal or infinitive where possible, formal `Sie` when a subject
// is unavoidable. German noun capitalisation only — never English Title Case.
// Quotation marks are „…“.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': 'Vorlagen ▾',
  'templates.menuLabel': 'Vorlagen',
  'templates.equilibrium.name': 'Ausgeglichene Produktionslinie',
  // shortened deliberately: this blurb has the tightest budget of all
  // sixteen (+6 % over English at 272 px, measured) — see §L2.12
  'templates.equilibrium.blurb':
    'Material rein, Verarbeitung und Ausschuss, Ware raus — stabil nach wenigen Schritten.',
  'templates.deadlock.name': 'Kapazitätsblockade',
  'templates.deadlock.blurb':
    'Dieselbe Linie ohne Versand: Der Bestand füllt die Kapazität und alles steht still.',
  'templates.mmoProgression.name': 'Früher MMO-Fortschritt (Stufen 1–15)',
  'templates.mmoProgression.blurb':
    'Drei Zonen mit Quests, Jagden und Belohnungen — wie lange Stufe 15 dauert.',
  'templates.coffeeRoastery.name': 'Betriebsablauf einer Kaffeerösterei',
  'templates.coffeeRoastery.blurb':
    'Wie Rösten, Verkauf und Bestand an einem Handelstag gegeneinander ziehen.',
  'templates.gachaBannerZones.name': 'Gacha-Banner-Vergleich mit 3 Zonen',
  'templates.gachaBannerZones.blurb':
    'Drei Banner mit einem Budget — was Pity und die UP-Garantie ändern.',
  'templates.replace.title': 'Diese Vorlage laden?',
  'templates.replace.body': 'Ihre aktuelle Arbeit wird ersetzt durch: {name}',
  'templates.replace.confirm': 'Vorlage laden',
  'modules.button': 'Modul einfügen ▾',
  'modules.menuLabel': 'Modul einfügen',
  'modules.fromFile': 'Aus Datei…',
  'modules.extract': 'Auswahl als Modul extrahieren…',
  'modules.bufferedStep.name': 'Gepufferter Produktionsschritt',
  'modules.bufferedStep.blurb':
    'Fügt einen Produktionsschritt mit Eingangs- und Ausgangspuffer hinzu.',
  'modules.rewardSplit.name': 'Schleife zur Belohnungsaufteilung',
  // measured: the full sentence needed a third line in a two-line clamp at
  // 232 px (17 px cut). The colon keeps `Belohnungen` and the "adds a loop"
  // framing that the module's own name relies on — the menu was not widened
  // and the clamp was not raised (§L2.12).
  'modules.rewardSplit.blurb': 'Fügt eine Schleife hinzu: Belohnungen in Ausgaben und Sparen.',
  'modules.error.title': 'Das Modul konnte nicht eingefügt werden',
  'modules.promote.title': 'In ein parametergesteuertes Modell (v2) umwandeln?',
  'modules.promote.body':
    'Das Einfügen dieses Blocks macht aus dem Dokument ein v2-Modell, und die Prüfsumme der Modellsemantik ändert sich. Ein einziges Rückgängig nimmt die Modelländerung und das Einfügen zusammen zurück.',
  'modules.promote.confirm': 'Umwandeln und einfügen',
  'modules.frames.title': 'Gespeicherte Gruppenrahmen sind nicht enthalten',
  'modules.frames.insertBody':
    'Diese Datei enthält gespeicherte Gruppenrahmen. Beim Einfügen als Modul kommen die Rahmen nicht in Ihren Graphen — alles andere wird wie gewohnt eingefügt.',
  'modules.frames.extractBody':
    'Ihr Graph enthält gespeicherte Gruppenrahmen. Sie werden nicht in die Moduldatei geschrieben — nur die ausgewählten Knoten und ihre internen Verbindungen.',
  'modules.frames.continue': 'Weiter',
} satisfies Record<TemplatesKey, string>

export default templates
