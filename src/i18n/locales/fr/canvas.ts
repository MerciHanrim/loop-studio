// docs/localization.md §L3.3 — the Canvas-surface slice of the `fr` catalog.
// `satisfies Record<CanvasKey, string>` makes `tsc` fail on a missing or an
// extra key against `../en/canvas`.
//
// Glossary: réservoir Pool · source (f) Source · puits Drain · aiguillage
// Gate · convertisseur Converter · fin (f) End · paramètre Parameter ·
// valeur calculée Register · nœud node · connexion edge · cadre de groupe
// frame (default label `Groupe {n}`) · tracé Route · étiquette the `label`
// edge mode · Nom a node's display name · pas a simulation step.
//
// French typography (§L2.8): U+202F before `; ? !` and inside « », U+00A0
// before `:` and between a number and its unit, apostrophe U+2019.

import type { CanvasKey } from '../en/canvas'

const canvas = {
  'palette.pool.name': 'Réservoir',
  'palette.pool.description':
    'Contient des ressources et affiche la quantité actuelle. Lorsque sa capacité est atteinte, il exerce une contre-pression sur le flux entrant.',
  'palette.source.name': 'Source',
  'palette.source.description':
    'Crée de nouvelles ressources à chaque pas et les envoie aux nœuds qu’elle alimente.',
  'palette.drain.name': 'Puits',
  'palette.drain.description':
    'Tire des ressources des nœuds qu’il sollicite et les retire du système.',
  'palette.gate.name': 'Aiguillage',
  'palette.gate.description':
    'Répartit les ressources entrantes selon un rapport fixe, ou choisit une branche par probabilité et y envoie tout. Ne contient rien.',
  'palette.converter.name': 'Convertisseur',
  'palette.converter.description':
    'Consomme les ressources d’entrée et produit des ressources de sortie selon le rapport que vous définissez. Ne contient rien.',
  'palette.end.name': 'Fin',
  'palette.end.description': 'Arrête l’exécution dès qu’une ressource l’atteint.',
  'palette.parameter.name': 'Paramètre',
  'palette.parameter.description':
    'Un nombre fixe que vous définissez. Il n’a pas de points de connexion, et une expression peut le référencer par son identifiant.',
  'palette.register.name': 'Valeur calculée',
  'palette.register.description':
    'Évalue une expression pour le pas en cours et affiche le résultat. Elle n’accumule rien, ne stocke rien et n’a pas de points de connexion.',
  'palette.addAction': 'Cliquez, ou faites glisser sur le canevas, pour en ajouter un.',
  'canvas.minimap': 'Miniature du graphe',
  'canvas.minimap.hide': 'Masquer la miniature',
  'canvas.minimap.show': 'Afficher la miniature',
  'canvas.lock.lock': 'Verrouiller l’édition — la sélection et la lecture restent actives',
  'canvas.lock.unlock': 'Déverrouiller l’édition — déplacer, connecter et modifier les valeurs',
  'canvas.focus.on': 'Focus désactivé — cliquez pour cibler le nœud sélectionné',
  'canvas.focus.off': 'Focus activé — cliquez pour afficher tout le graphe',
  'canvas.focus.hint': 'Sélectionnez un nœud à cibler',
  'canvas.focus.rowLabel': 'Focus sur la sélection',
  'canvas.focus.stateOn': 'Activé',
  'canvas.focus.stateOff': 'Désactivé',
  'canvas.panMode.off': 'Mode déplacement désactivé — faites glisser le canevas vide pour vous déplacer',
  'canvas.panMode.on': 'Mode déplacement activé — faites glisser n’importe où pour vous déplacer',
  'canvas.panMode.rowLabel': 'Mode déplacement',
  'canvas.filter.open': 'Filtres — masquer des parties du graphe pendant l’exploration',
  'canvas.filter.close': 'Fermer le panneau des filtres',
  'canvas.filter.title': 'Filtres',
  'canvas.filter.rowLabel': 'Filtres',
  'canvas.filter.groupEdgeClass': 'Type de connexion',
  'canvas.filter.groupResourceType': 'Type de ressource',
  'canvas.filter.groupNodeKind': 'Type de nœud',
  'canvas.filter.edgeClass.resource': 'Ressource',
  'canvas.filter.edgeClass.state': 'État',
  'canvas.filter.edgeClass.hint': 'Indice de dépendance',
  'canvas.filter.untyped': 'sans type',
  'canvas.filter.clear': 'Effacer les filtres',
  'canvas.filter.hiddenCount': '{n} masqué(s)',
  'canvas.filter.none': 'Rien n’est masqué',
  'canvas.filter.checkboxHint': 'coché = masqué',
  'canvas.nodeKind.source': 'Source',
  'canvas.nodeKind.pool': 'Réservoir',
  'canvas.nodeKind.gate': 'Aiguillage',
  'canvas.nodeKind.converter': 'Convertisseur',
  'canvas.nodeKind.drain': 'Puits',
  'canvas.nodeKind.end': 'Fin',
  'canvas.nodeKind.parameter': 'Paramètre',
  'canvas.nodeKind.register': 'Valeur calculée',
  'canvas.resetView':
    'Réinitialiser la vue — ajuster le graphe et effacer les filtres et le focus',
  // docs/large-graph-readability.md §LGR12 — the one-shot region-select tool.
  'canvas.regionSelect.off':
    'Sélectionner une zone — faites glisser sur le canevas vide ; Maj + glisser fonctionne aussi',
  'canvas.regionSelect.on':
    'Sélectionner une zone — sélection en cours ; faites glisser sur le canevas vide, Échap pour annuler',
  'canvas.regionSelect.count': '{n, plural, one {# nœud sélectionné} other {# nœuds sélectionnés}}',
  'canvas.regionSelect.countLocked':
    '{n, plural, one {# nœud sélectionné} other {# nœuds sélectionnés}} · déverrouillez l’édition pour les déplacer',
  'canvas.frame.draw': 'Cadre de groupe — faites glisser sur le canevas vide pour en tracer un',
  'canvas.frame.drawing':
    'Cadre de groupe — tracé en cours ; faites glisser sur le canevas vide, Échap pour annuler',
  'canvas.frame.defaultName': 'Groupe {n}',
  'canvas.frame.delete': 'Supprimer ce cadre',
  'canvas.frame.suggest':
    'Suggérer des cadres — des rectangles de regroupement approximatifs autour des nœuds structurellement liés. Structure uniquement ; pas le sens métier.',
  'canvas.frame.suggestStale':
    'Suggérer des cadres — le graphe a changé ; cliquez pour recalculer les groupes suggérés',
  'canvas.frame.suggestRow': 'Suggérer des cadres',
  'canvas.frame.suggestNote':
    'Groupes structurels suggérés — ils ne correspondent pas forcément à votre découpage du travail.',
  'canvas.frame.suggestNoteDismiss': 'Masquer cette note',
  'canvas.frame.areaName': 'Zone {n}',
  'canvas.frame.dismiss': 'Ignorer ce cadre suggéré',
  'canvas.frame.clearAll': 'Effacer tous les cadres',
  'canvas.frame.clearSuggested': 'Effacer les cadres suggérés',
  'canvas.frame.clearSuggestedRow': 'Effacer les cadres suggérés',
  'canvas.frame.colorRow': 'Couleur du cadre',
  'canvas.frame.color.neutral': 'Neutre',
  'canvas.frame.color.slate': 'Ardoise',
  'canvas.frame.color.sage': 'Sauge',
  'canvas.frame.color.gold': 'Or',
  'canvas.frame.color.violet': 'Violet',
  'canvas.frame.color.rose': 'Rose',
  'canvas.frame.props.title': 'Réglages du cadre — {label}',
  'canvas.frame.props.name': 'Nom',
  'canvas.activity.off':
    'Calque d’activité désactivé — cliquez pour teinter les parties récemment actives',
  'canvas.activity.on': 'Calque d’activité activé — cliquez pour masquer la teinte',
  'canvas.activity.rowLabel': 'Calque d’activité',
  'canvas.route.invalidFlag': 'tracé invalide — un point de tracé est à l’intérieur d’un nœud',
  'canvas.edgeLabel.clamp': 'écrêtage',
  'canvas.edgeLabel.clamp.title':
    'retiré par l’unique écrêtage de fin de phase 0 du réservoir cible',
  'canvas.edgeLabel.blocked': 'bloqué',
  'canvas.edgeLabel.blocked.title':
    'livré, mais la cible n’a pas pu se déclencher (mauvais mode d’activation, ou un activateur la maintenait fermée)',
  'canvas.edgeLabel.breakdown.title': 'les transferts de ce pas le long de cette connexion',
  'canvas.edgeLabel.refMissing': 'Erreur de référence de paramètre',
  'node.unreadable.title': '{kind} illisible',
  'node.unreadable.sub': 'données illisibles — corrigez-les dans le fichier',
  'node.invalidFlag': 'Ce nœud est invalide',
  'node.aria.invalid': 'invalide',
  'node.aria.selected': 'sélectionné',
  'node.aria.focused': 'focalisé',
  'node.evaluatedCue': 'Évalué à ce pas mais sans action',
  'node.default.pool': 'Réservoir',
  'node.default.source': 'Source',
  'node.default.drain': 'Puits',
  'node.default.gate': 'Aiguillage',
  'node.default.converter': 'Convertisseur',
  'node.default.end': 'Fin',
  'node.default.parameter': 'Paramètre',
  'node.default.register': 'Valeur calculée',
  'canvas.frame.a11y.roledescription': 'cadre de groupe',
  'canvas.frame.a11y.roledescriptionAuto': 'cadre de groupe suggéré',
  'canvas.frame.a11y.name': '{label}, {n, plural, one {# nœud} other {# nœuds}}',
  'canvas.frame.a11y.desc': 'Appuyez sur Entrée ou Espace pour sélectionner ce cadre.',
  'canvas.frame.a11y.descSelected':
    'Sélectionné. Les flèches déplacent le cadre et tout ce qu’il contient, Maj pour un pas plus grand. Retour arrière ou Suppr le supprime. Échap désélectionne.',
  'canvas.frame.a11y.descReadonly':
    'Lecture seule — ce cadre peut être sélectionné et consulté, mais pas modifié.',
  'canvas.frame.a11y.resize':
    'Redimensionner {label} — largeur {w}, hauteur {h}. Les flèches le redimensionnent, Maj pour un pas plus grand.',
  'canvas.frame.a11y.moved': '{label} déplacé en x {x}, y {y}',
  'canvas.frame.a11y.resized': '{label} redimensionné à largeur {w}, hauteur {h}',
  'rf.node.moveCancelled': 'Déplacement annulé. Le nœud est revenu en x {x}, y {y}',
  'rf.node.moved': 'Nœud sélectionné déplacé vers {direction}. Nouvelle position, x {x}, y {y}',
  'rf.dir.left': 'la gauche',
  'rf.dir.right': 'la droite',
  'rf.dir.up': 'le haut',
  'rf.dir.down': 'le bas',
  'rf.controls.label': 'Commandes du canevas',
  'rf.controls.zoomIn': 'Zoom avant',
  'rf.controls.zoomOut': 'Zoom arrière',
  'rf.controls.fitView': 'Ajuster le schéma à la vue',
  'rf.controls.interactive': 'Activer ou désactiver l’édition du canevas',
  'rf.handle.label': 'Point de connexion',
  'rf.node.a11y':
    'Appuyez sur Entrée ou Espace pour sélectionner ce nœud. Appuyez sur Suppr pour le retirer, Échap pour annuler.',
  'rf.node.a11yKeyboard':
    'Appuyez sur Entrée ou Espace pour sélectionner ce nœud, puis sur les flèches pour le déplacer. Appuyez sur Suppr pour le retirer, Échap pour annuler.',
  'rf.edge.a11y':
    'Appuyez sur Entrée ou Espace pour sélectionner cette connexion. Appuyez sur Suppr pour la retirer, Échap pour annuler.',
} satisfies Record<CanvasKey, string>

export default canvas
