// docs/localization.md §L3.3 — the Templates & modules slice of the `fr`
// catalog. `satisfies Record<TemplatesKey, string>` makes `tsc` fail on a
// missing or an extra key against `../en/templates`.
//
// Glossary: modèle template · module module · projet project · cadre de
// groupe frame · importer/exporter · feuille de calcul (the document) vs
// tableur (the application). `étape` is a STAGE of a production line or a
// wizard; a simulation timestep is `pas` (§L2.7).
//
// French typography (§L2.8): U+202F before `; ? !` and inside « », U+00A0
// before `:` and between a number and its unit, apostrophe U+2019.

import type { TemplatesKey } from '../en/templates'

const templates = {
  'templates.button': 'Modèles',
  'templates.menuLabel': 'Modèles',
  'templates.equilibrium.name': 'Ligne de production équilibrée',
  'templates.equilibrium.blurb':
    'Matière en entrée, transformation et rebut, produits en sortie — stable en quelques pas.',
  'templates.deadlock.name': 'Blocage de capacité',
  'templates.deadlock.blurb':
    'La même ligne sans étape d’expédition : le stock atteint la capacité et tout s’arrête.',
  'templates.mmoProgression.name': 'Progression MMO du début de jeu (niveaux 1–15)',
  'templates.mmoProgression.blurb':
    'Trois zones de quêtes, chasses et récompenses — le temps qu’il faut pour atteindre le niveau 15.',
  'templates.coffeeRoastery.name': 'Flux d’exploitation d’une torréfaction',
  'templates.coffeeRoastery.blurb':
    'Comment la torréfaction, les ventes et le stock se disputent une journée de commerce.',
  'templates.gachaBannerZones.name': 'Comparaison de 3 bannières gacha',
  'templates.gachaBannerZones.blurb':
    'Trois bannières pour un même budget, pour voir ce que changent le pity et la garantie UP.',
  'templates.replace.title': 'Charger ce modèle ?',
  'templates.replace.body': 'Votre travail actuel sera remplacé par : {name}',
  'templates.replace.confirm': 'Charger le modèle',
  'modules.extract': 'Enregistrer la structure sélectionnée…',
  'modules.error.title': 'Impossible d’insérer la structure',
  'modules.promote.title': 'Passer à un modèle piloté par paramètres (v2) ?',
  'modules.promote.body': 'Insérer cette structure transforme le document en modèle v2 et l’empreinte de sémantique du modèle change. Une seule annulation revient à la fois sur le changement de modèle et sur l’insertion.',
  'modules.promote.confirm': 'Convertir et insérer',
  'modules.frames.title': 'Les cadres de groupe enregistrés ne sont pas inclus',
  'modules.frames.insertBody': 'Ce fichier contient des cadres de groupe enregistrés. L’insérer comme structure ne les apporte pas dans votre graphe — tout le reste est inséré normalement.',
  'modules.frames.extractBody': 'Votre graphe contient des cadres de groupe enregistrés. Ils ne sont pas écrits dans le fichier de structure — seuls les nœuds sélectionnés et leurs connexions internes le sont.',
  'modules.frames.continue': 'Continuer',

  // 2026-10 — the strings added since the archive (the workbench redesign)
  'templates.gachaGeneral.name': 'Gacha classique',
  'templates.gachaGeneral.blurb': 'Une bannière, sans pity. Le taux d’obtention est compté sur les tirages cibles ; l’exécution s’arrête là.',
  'templates.gachaStandard.name': 'Gacha standard',
  'templates.gachaStandard.blurb': 'Une bannière avec un plafond hard pity : au plafond, le tirage suivant est un SSR forcé.',
  'templates.gachaPickup.name': 'Gacha UP',
  'templates.gachaPickup.blurb': 'Pity et garantie UP : après un SSR hors UP, le SSR suivant est l’UP.',
  'modules.insertSaved': 'Insérer une structure enregistrée…',
  'modules.insertSaved.blurb': 'Ajoute à ce document un fichier de structure que vous avez enregistré.',
  'modules.insertSaved.locked': 'Indisponible tant que l’édition est verrouillée',
  'modules.extract.blurb': 'Enregistre dans un fichier les nœuds sélectionnés et les connexions entre eux.',
} satisfies Record<TemplatesKey, string>

export default templates
