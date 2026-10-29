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
  'templates.button': 'Vorlagen',
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
  'modules.extract': 'Ausgewählte Struktur speichern…',
  // measured: the full sentence needed a third line in a two-line clamp at
  // 232 px (17 px cut). The colon keeps `Belohnungen` and the "adds a loop"
  // framing that the module's own name relies on — the menu was not widened
  // and the clamp was not raised (§L2.12).
  'modules.error.title': 'Die Struktur konnte nicht eingefügt werden',
  'modules.promote.title': 'In ein parametergesteuertes Modell (v2) umwandeln?',
  'modules.promote.body': 'Durch das Einfügen dieser Struktur wird das Dokument zu einem v2-Modell, und der Digest der Modellsemantik ändert sich. Ein einziges Rückgängig macht die Modelländerung und das Einfügen zusammen rückgängig.',
  'modules.promote.confirm': 'Umwandeln und einfügen',
  'modules.frames.title': 'Gespeicherte Gruppenrahmen sind nicht enthalten',
  'modules.frames.insertBody': 'Diese Datei enthält gespeicherte Gruppenrahmen. Beim Einfügen als Struktur werden keine Rahmen in Ihren Graphen übernommen – alles andere wird wie gewohnt eingefügt.',
  'modules.frames.extractBody': 'Ihr Graph hat gespeicherte Gruppenrahmen. Sie werden nicht in die Strukturdatei geschrieben – nur die ausgewählten Knoten und ihre internen Verbindungen.',
  'modules.frames.continue': 'Weiter',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Allgemeines Gacha',
  'templates.gachaGeneral.blurb': 'Ein Banner, kein Pity. Die Trefferrate zählt gegen die Zielziehungen; dort stoppt der Lauf.',
  'templates.gachaStandard.name': 'Standard-Gacha',
  'templates.gachaStandard.blurb': 'Ein Banner mit harter Pity-Grenze: An der Grenze ist die nächste Ziehung ein erzwungenes SSR.',
  'templates.gachaPickup.name': 'UP-Gacha',
  'templates.gachaPickup.blurb': 'Pity und UP-Garantie: Nach einem SSR außerhalb des UP ist das nächste SSR das UP.',
  'modules.insertSaved': 'Gespeicherte Struktur einfügen…',
  'modules.insertSaved.blurb': 'Fügt eine gespeicherte Strukturdatei in dieses Dokument ein.',
  'modules.insertSaved.locked': 'Nicht verfügbar, solange die Bearbeitung gesperrt ist',
  'modules.extract.blurb': 'Speichert die ausgewählten Knoten und die Verbindungen zwischen ihnen in einer Datei.',
} satisfies Record<TemplatesKey, string>

export default templates
