// docs/localization.md §L3.3 — the Inspector slice of the `fr` catalog.
// `satisfies Record<InspectorKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/inspector`.
//
// Glossary: Propriétés Inspector · Nom a node's display name · étiquette the
// `label` edge mode · déclencheur trigger · activateur activator · valeur
// calculée Register · réservoir Pool · puits Drain · aiguillage Gate ·
// connexion edge · tracé Route · capacité capacity · pas a simulation step.
// Expression operators (`>= <= > < == !=`, `+ - =`, `S`) and the flow
// placeholder are syntax and stay exactly as they are.

import type { InspectorKey } from '../en/inspector'

const inspector = {
  'inspector.delete': 'Supprimer',
  'inspector.field.label': 'Nom',
  'inspector.empty.title': 'Sélectionnez un nœud ou une connexion à modifier.',
  'inspector.empty.hint':
    'Faites glisser un élément depuis la barre du haut vers le canevas, puis tirez entre les points de chaque côté pour les relier.',
  'inspector.unreadable.note':
    'Les données de ce nœud sont illisibles ({detail}). Il est chargé tel quel et exclu du modèle — corrigez-le dans le fichier, ou supprimez le nœud.',
  'inspector.unreadable.detailFallback': 'les données ne sont pas un objet lisible',
  'inspector.field.rawData': 'Données brutes',
  'enum.activation.passive': 'passif',
  'enum.activation.automatic': 'automatique',
  'enum.activation.onStart': 'au démarrage',
  'enum.activation.interactive': 'interactif',
  'enum.flowMode.pullAny': 'tirer depuis une source',
  'enum.flowMode.pullAll': 'tirer depuis toutes les sources',
  'enum.flowMode.pushAny': 'pousser vers une cible',
  'enum.flowMode.pushAll': 'pousser vers toutes les cibles',
  'enum.distribution.deterministic': 'déterministe',
  'enum.distribution.probabilistic': 'probabiliste',
  'enum.format.int': 'entier',
  'enum.format.float': 'décimal',
  'enum.format.percent': 'pourcentage',
  'enum.stateMode.trigger': 'déclencheur',
  'enum.stateMode.activator': 'activateur',
  'enum.stateMode.label': 'étiquette',
  'inspector.field.activation': 'Activation',
  'inspector.node.endNote': 'Arrête l’exécution dès qu’une ressource l’atteint.',
  'inspector.field.startingAmount': 'Quantité initiale',
  'inspector.field.capacity': 'Capacité (vide = illimitée)',
  'inspector.number.nonNegativeHint': 'Saisissez un nombre supérieur ou égal à 0.',
  'inspector.field.flowMode': 'Mode de flux',
  'inspector.field.distribution': 'Répartition',
  'inspector.field.value': 'Valeur',
  'inspector.field.unit': 'Unité (indicatif)',
  'inspector.field.min': 'Minimum (indicatif)',
  'inspector.field.max': 'Maximum (indicatif)',
  'inspector.field.step': 'Pas (indicatif)',
  'inspector.field.expression': 'Expression',
  'inspector.field.format': 'Format (indicatif)',
  'inspector.field.resourceType': 'Type de ressource (indicatif)',
  'inspector.resourceType.placeholder': 'Gold, Energy, XP, Player, Item, ou un nom personnalisé',
  'inspector.resourceType.tooLong':
    'Plus de {max} octets — cette étiquette ne sera pas exportée.',
  'inspector.resourceType.normalised': 'Normalisé en « {value} ».',
  'inspector.resourceType.custom':
    'Type personnalisé — pastille générique ; aucune couleur intégrée.',
  'inspector.resourceType.mismatch':
    'Types incompatibles : {pairs}. Indicatif seulement — cela ne change aucune quantité et ne bloque aucune exécution.',
  'inspector.parameter.outOfRange':
    'La valeur est en dehors du minimum/maximum indicatif — conservée telle quelle, sans écrêtage.',
  'inspector.parameter.hintIncoherent':
    'Une indication est incohérente et ne sera pas exportée.',
  'inspector.parameter.noPorts':
    'Un paramètre n’a pas de points de connexion — référencez-le par son identifiant depuis une expression.',
  'inspector.register.formatInvalid':
    'Format non reconnu — retour au format décimal à l’export.',
  'inspector.register.noStore':
    'Une valeur calculée ne stocke rien et n’a pas de points de connexion.',
  'inspector.edge.kindLink': 'connexion de type {kind}',
  'inspector.field.type': 'Type',
  'inspector.edge.type.resource': 'ressource — transporte des ressources',
  'inspector.edge.type.state': 'état — lit une valeur, modifie la cible',
  'inspector.field.flow': 'Flux',
  'inspector.edge.flowPlaceholder': '1, all, 2D6, 1-3, 25%',
  'inspector.edge.flowParam.pickLabel': 'Piloter par un paramètre',
  'inspector.edge.flowParam.literalOption': '— valeur fixe —',
  'inspector.edge.flowParam.resolved': '= {value}',
  'inspector.edge.flowParam.unknown':
    'aucun paramètre « {id} » — cette connexion contribue pour 0',
  'inspector.edge.flowParam.notParam':
    '« {id} » n’est pas un paramètre — cette connexion contribue pour 0',
  'inspector.edge.flowParam.malformed':
    'référence de paramètre invalide — cette connexion contribue pour 0',
  'inspector.edge.flowParam.hint':
    'Une référence de paramètre est conservée par identifiant : renommer le paramètre ne pose pas de problème ; le supprimer laisse la référence orpheline (elle n’est pas réécrite).',
  'inspector.field.route': 'Tracé',
  'inspector.edge.route.curved': 'Courbe',
  'inspector.edge.route.orthogonal': 'Orthogonal',
  'inspector.edge.note':
    'Modifier une connexion relance l’exécution au pas 0 et efface les déclenchements en attente ; un résultat Monte-Carlo terminé est marqué comme périmé.',
  'inspector.field.mode': 'Mode',
  'inspector.edge.mode.trigger': 'déclencheur — envoie une impulsion pour faire agir la cible',
  'inspector.edge.mode.activator': 'activateur — active ou désactive la cible',
  'inspector.edge.mode.label': 'étiquette — ajoute au réservoir cible ou le fixe',
  'inspector.field.delay': 'Délai — pas avant que l’impulsion soit livrée',
  'inspector.delay.ok': 'livrée à (déclenchement + délai + 1) ; 0 signifie le pas suivant.',
  'inspector.delay.bad':
    'utilisez un entier ≥ 0 — le moteur exécute toute autre valeur comme 0 et laisse intacte celle que vous avez saisie.',
  'inspector.field.condition': 'Condition — comparaison avec la source',
  'inspector.field.modifier': 'Modificateur — variation appliquée à chaque pas',
  'inspector.expr.activatorPlaceholder': '>= 5',
  'inspector.expr.labelPlaceholder': '+1   ·   -2   ·   =S',
  'inspector.stateExpr.noEffect':
    '{hint} — tant qu’elle ne s’analyse pas, cette connexion reste sans effet.',
  'inspector.activator.describe': 'la cible est active tant que la source {op} {n}',
  'inspector.activator.paramPicker.pickLabel': 'Piloter par un paramètre',
  'inspector.activator.paramPicker.literalOption': '— valeur fixe —',
  'inspector.activator.offsetLabel': 'Décalage',
  'inspector.activator.preview.resolved':
    'la cible est active tant que la source {op} {threshold} (= {paramLabel}{offsetText}, actuellement {paramValue})',
  'inspector.activator.preview.unknown':
    'aucun paramètre « {id} » — cet activateur bloque actuellement sa cible',
  'inspector.activator.preview.notParam':
    '« {id} » n’est pas un paramètre (type : {kind}) — cet activateur bloque actuellement sa cible',
  'inspector.activator.preview.nonFinite':
    'le paramètre « {id} » n’est pas un nombre fini — cet activateur bloque actuellement sa cible',
  'inspector.activator.preview.overflow':
    'le paramètre « {id} » donne un nombre trop grand pour être comparé — cet activateur bloque actuellement sa cible',
  'inspector.label.describe.set': 'fixe le réservoir cible à {amount} à chaque pas',
  'inspector.label.describe.add': 'ajoute {amount} au réservoir cible à chaque pas',
  'inspector.label.describe.subtract': 'retire {amount} du réservoir cible à chaque pas',
  'inspector.label.amountSource': 'la valeur du réservoir source',
  'inspector.legacy.note':
    'Connexion non prise en charge. Le mode {mode} n’est pas exécuté — cette liaison n’a aucun effet sur la simulation. Loop Studio ne la convertit jamais automatiquement ; choisissez ce qu’elle doit devenir, puis convertissez-la explicitement.',
  'inspector.legacy.convertTo': 'Convertir en',
  'inspector.legacy.convertButton': 'Convertir en {mode}',
  'stateExpr.activator.hint.empty': 'saisissez une comparaison, par exemple >= 5',
  'stateExpr.activator.hint.opOnly': 'ajoutez un nombre, par exemple >= 5',
  'stateExpr.activator.hint.notAComparison': 'utilisez >= <= > < == != puis un nombre',
  'stateExpr.activator.hint.nonFinite': 'le nombre doit être fini',
  'stateExpr.label.hint.empty': 'saisissez un modificateur, par exemple +1 ou =S',
  'stateExpr.label.hint.notAnAssignment': 'utilisez + - ou = puis un nombre ou S',
  'stateExpr.label.hint.nonFinite': 'le nombre doit être fini',
  // docs/label-timing-authoring.md — the label-timing preset control (CSU8 slice 3)
  'inspector.field.labelTiming': 'Moment d’application',
  'inspector.labelTiming.always': 'Toujours — au début de chaque pas',
  'inspector.labelTiming.afterPull': 'Quand la source agit — après les résultats de ce pas',
  'inspector.labelTiming.previewAlways': 'Appliqué au début de chaque pas.',
  'inspector.labelTiming.previewAfterPull':
    'Appliqué dès que la source de cette connexion agit à ce pas, juste après le calcul des résultats du pas.',
  'inspector.labelTiming.warnTargetNotPool': 'la cible doit être un réservoir',
  'inspector.labelTiming.warnModifierInvalid': 'le modificateur doit être une valeur valide',
  'inspector.labelTiming.warnSourceNotPool': 'nécessite un réservoir comme source',
  'inspector.labelTiming.warnSourceNotRouter':
    'nécessite un aiguillage, un convertisseur, un puits ou une fin comme source',
  'inspector.labelTiming.warnSForm': 'nécessite un nombre fixe, pas S',
  'inspector.labelTiming.unsupported':
    'Cette connexion a une combinaison moment/condition que Loop Studio ne prend pas en charge (actuellement : timing = {timing}, when = {when}) — elle est donc sans effet. Choisissez l’une des deux options ci-dessus pour la remplacer.',
  'panels.inputs.title': 'Entrées',
  'panels.summary.title': 'Synthèse',
  'panels.inputs.collapse': 'Réduire le panneau Entrées',
  'panels.inputs.expand': 'Développer le panneau Entrées',
  'panels.summary.collapse': 'Réduire le panneau Synthèse',
  'panels.summary.expand': 'Développer le panneau Synthèse',
  'panels.inputs.paramValue': 'Valeur de {label}',
  'panels.inputs.flowVia': 'flux via {param}',
  'panels.summary.showCalc': 'Afficher le calcul',
  'panels.summary.hideCalc': 'Masquer le calcul',
  'panels.summary.noValue': '— aucune valeur au pas {step}',
  'panels.empty.inputs': 'Aucun paramètre dans ce graphe.',
  'panels.empty.summary': 'Aucune valeur calculée dans ce graphe.',

  // docs/register-expression-authoring.md §RXA3
  'regExpr.pick.listLabel': 'Référencer un réservoir, un paramètre ou une valeur calculée',
  'regExpr.pick.optionAria': '{name}, {kind}, valeur actuelle {value}',
  'regExpr.pick.noMatch': 'Aucun nœud correspondant',
  'regExpr.pick.more': '+{n} de plus — continuez à saisir',
  'regExpr.block.self': 'ne peut pas se référencer elle-même',
  'regExpr.block.cycle': 'créerait un cycle avec {name}',
  'regExpr.empty': 'L’expression est vide.',
  'regExpr.chip.deleted': '(supprimé)',
  'regExpr.chip.wrongKind': '(inutilisable)',
  'regExpr.row.unknownRef': '— référence « {id} » introuvable',
  'regExpr.row.wrongKind':
    '— « {name} » n’est pas un réservoir, un paramètre ni une valeur calculée',
  'regExpr.row.invalidId': '— « {id} » n’est pas une référence valide',
  'regExpr.row.cycle': '— cycle : {name} → … → {name}',
  'regExpr.row.divZero': '→ division par 0 impossible',
  'regExpr.row.notFinite': '→ nombre non fini',
  'regExpr.row.dependsInvalid': '— dépend d’une référence invalide',
  'regExpr.row.generic': '— {code}',
  // §RXA8 — arm-and-click canvas insert
  'regExpr.insert.title': '＋ Insérer une référence',
  'regExpr.insert.armedLabel': 'Sélection d’une référence',
  'regExpr.insert.hint':
    'Cliquez sur un réservoir, un paramètre ou une valeur calculée du canevas pour insérer sa référence.',
  'regExpr.insert.armed':
    'Insertion de référence armée. Cliquez sur un nœud du canevas, ou appuyez sur Échap pour annuler.',
  'regExpr.insert.cancelled': 'Insertion de référence annulée.',
  'regExpr.insert.done': 'Référence à {name} insérée.',
  'regExpr.insert.wrongKind':
    'Seuls un réservoir, un paramètre ou une valeur calculée peuvent être insérés.',
  // §RXA8b — the operator / parenthesis buttons
  'regExpr.op.groupName': 'Boutons d’opérateur',
  'regExpr.op.add': 'Addition',
  'regExpr.op.sub': 'Soustraction',
  'regExpr.op.mul': 'Multiplication',
  'regExpr.op.div': 'Division',
  'regExpr.op.group': 'Parenthèses',
  'regExpr.op.inserts': '{name} — insère {sym} dans la formule',
  'regExpr.op.groupTitle':
    'Parenthèses — encadrer la partie sélectionnée, ou ajouter ( )',
  'regExpr.op.inserted': '{name} inséré',
} satisfies Record<InspectorKey, string>

export default inspector
