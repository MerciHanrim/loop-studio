// docs/data-import.md §DI16 / §DI17 — the CSV/TSV import-wizard slice of the
// `fr` catalog. `satisfies Record<DataImportKey, string>` makes `tsc` fail on
// a missing or an extra key against `../en/dataImport`.
//
// Glossary (§L2.7): **feuille de calcul** = the spreadsheet DOCUMENT, and
// **tableur** = the spreadsheet APPLICATION — the two are not
// interchangeable. `données tabulaires` covers CSV/TSV text that is not a
// sheet. tableau table · ligne row · colonne column · cellule cell · en-tête
// header · clé / clé étrangère · Nom the Label role · correspondance mapping ·
// cadre de groupe frame · étape a wizard stage (a simulation step is `pas`).
// Column ids in the example (`item_id`, `price`, …), file extensions,
// `CSV` / `TSV` / `Loop Studio` and every `{slot}` name stay as they are.

import type { DataImportKey } from '../en/dataImport'

const dataImport = {
  'import.button': 'Données ▾',
  'import.title': 'Importer des données de feuille de calcul',
  'import.tableName': 'Nom du tableau',
  'import.removeTable': 'Retirer le tableau',
  'import.addTable': 'Ajouter un autre tableau',
  'import.pastePlaceholder': 'Collez ici du texte CSV ou TSV',
  'import.pasteAria': 'Texte CSV ou TSV',
  'import.tableNameRequired': 'Saisissez un nom de tableau pour continuer.',
  'import.pasteDataRequired': 'Collez ou importez des données CSV/TSV pour continuer.',
  'import.uploadFile': 'Importer un fichier…',
  'import.delimiter': 'Séparateur',
  'import.delimiterAuto': 'Détection automatique',
  'import.delimiterComma': 'Virgule',
  'import.delimiterTab': 'Tabulation',
  'import.headerRow': 'Ligne d’en-tête',
  'import.ignoreLastRows': 'Ignorer les N dernières lignes',
  'import.parseError':
    'Ce texte n’est pas du CSV/TSV valide : {kind} à la ligne {line}, caractère {column}.',
  'import.parseErrorKind.unterminated-quote': 'un guillemet non fermé',
  'import.parseErrorKind.text-after-quote':
    'du texte inattendu juste après un guillemet fermant',
  'import.parseErrorKind.quote-in-unquoted-field': 'un guillemet dans un champ sans guillemets',
  'import.role.ignored': 'Ignorer',
  'import.role.key': 'Clé',
  'import.role.number': 'Nombre',
  'import.role.label': 'Nom',
  'import.role.foreignKey': 'Clé étrangère',
  'import.roleAria': 'Rôle de la colonne {header}',
  'import.selectTable': 'Choisissez un tableau…',
  'import.selectColumn': 'Choisissez une colonne…',
  'import.selectFrame': 'Choisissez un cadre…',
  'import.groupBy': 'Regrouper les cadres par :',
  'import.warningsFound':
    '{n, plural, one {# ligne affichera la clé brute au lieu d’un nom.} other {# lignes afficheront la clé brute au lieu d’un nom.}}',
  'import.parseErrorsBlockValidation': 'Corrigez les erreurs CSV/TSV ci-dessus avant de continuer.',
  'import.placement.none': 'Placer sur le canevas, sans cadre',
  'import.placement.framePerTable': 'Un cadre par tableau',
  'import.placement.existingFrame': 'Ajouter à un cadre existant',
  'import.summary':
    'Prêt à importer {tables, plural, one {# tableau} other {# tableaux}}, créant {parameters, plural, one {# paramètre} other {# paramètres}}.',
  'import.next': 'Suivant',
  'import.back': 'Précédent',
  'import.commit': 'Importer',

  // §DI17 -- the quick start block
  'import.qs.title': 'Démarrage rapide',
  'import.qs.toggleAria': 'Démarrage rapide — afficher ou masquer',
  'import.qs.lead':
    'Transformez les nombres d’une feuille de calcul en paramètres ajustables.',
  'import.qs.body':
    'Chaque ligne a besoin d’une colonne avec un identifiant unique. Chaque colonne marquée « Nombre » devient un paramètre par ligne. Les relier à votre modèle reste une étape à faire ensuite. Rien n’est envoyé en ligne, et votre feuille de calcul n’est jamais modifiée.',
  'import.qs.exampleHeading': 'Un exemple minimal',
  'import.qs.mapping':
    'item_id : {key} · item_name : {label} · price : {number} · drop_rate : {number}',
  'import.qs.result': '2 lignes × 2 colonnes Nombre = 4 paramètres',
  'import.qs.useExample': 'Utiliser cet exemple',
  'import.qs.tableLimit':
    'La limite de {max} tableaux est atteinte — retirez d’abord un tableau.',
  'import.qs.download': 'Télécharger un CSV d’exemple',
  'import.qs.fullGuide': 'Guide complet',
  'import.qs.fullGuideAria': 'Guide complet — s’ouvre sur GitHub dans un nouvel onglet',
  'import.qs.sources.summary': 'Extraire des données de Google Sheets ou d’Excel',
  'import.qs.sources.sheets':
    'Google Sheets : Fichier → Télécharger → Valeurs séparées par des virgules (.csv), ou sélectionnez une plage et copiez-la.',
  'import.qs.sources.excel':
    'Excel ou Numbers : Enregistrer sous / Exporter au format CSV, ou copiez une plage.',
  'import.qs.sources.privacy':
    'N’utilisez pas « Publier sur le Web » sur une feuille privée — cela la rend lisible par toute personne disposant du lien. Un téléchargement ou une copie la garde privée.',
  'import.qs.notImported.summary': 'Ce qui n’est pas importé',
  'import.qs.notImported.formulas':
    'Les formules elles-mêmes ne sont pas importées — un CSV ou un collage ne transporte que la valeur calculée de chaque cellule.',
  'import.qs.notImported.list':
    'Mise en forme, graphiques, cellules fusionnées ou à valeurs multiples, fichiers .xlsx, et synchronisation en direct. C’est à vous de modéliser la façon dont les valeurs interagissent.',
  'import.qs.limits':
    'Jusqu’à {tables} tableaux, {columns} colonnes associées par tableau, {rows} lignes par tableau.',

  // §DI17 -- the shared role help
  'import.roleHelp.title': 'Rôles des colonnes',
  'import.roleHelp.key':
    'Identifiant unique utilisé pour retrouver cette ligne lors d’une actualisation.',
  'import.roleHelp.label': 'Nom affiché sur les paramètres générés.',
  'import.roleHelp.number': 'Crée un paramètre ajustable pour chaque ligne.',
  'import.roleHelp.foreignKey':
    'Relie cette valeur à une ligne d’un autre tableau importé.',
  'import.roleHelp.ignored': 'Laisser cette colonne en dehors de Loop Studio.',
  'import.linkTables.summary': 'Relier plusieurs tableaux',
  'import.linkTables.body':
    'Ajoutez un second tableau et marquez une colonne comme clé étrangère pour référencer la clé de l’autre tableau. Le nom de celui-ci enrichit ensuite les noms générés. Un tableau comportant deux clés étrangères doit indiquer laquelle sert à regrouper.',

  // §DI17 -- the per-table status line (input step)
  'import.status.key': 'Clé : {header}',
  'import.status.keyNone': 'Clé : aucune pour l’instant',
  'import.status.keyMany': 'Clé : {n} colonnes — n’en gardez qu’une',
  'import.status.counts':
    '{cols, plural, one {# colonne Nombre} other {# colonnes Nombre}} × {rows, plural, one {# ligne} other {# lignes}} → {n, plural, one {# paramètre} other {# paramètres}}',

  // §DI17 -- placement step echoes
  'import.placement.frameHelp':
    'Un cadre est un rectangle titré qui regroupe des nœuds sur le canevas.',
  'import.placement.noneResult':
    '{n, plural, one {# paramètre} other {# paramètres}} sur le canevas, sans cadre',
  'import.placement.framePerTableResult':
    '{n, plural, one {# cadre sera créé} other {# cadres seront créés}}',
  'import.placement.noFramesYet': 'Aucun cadre sur ce canevas pour l’instant',

  // §DI17 -- the review breakdown
  'import.review.col.table': 'Tableau',
  'import.review.col.rows': 'Lignes',
  'import.review.col.numberColumns': 'Colonnes Nombre',
  'import.review.col.parameters': 'Paramètres',
  'import.review.col.frames': 'Cadres',
  'import.review.lookupOnly': '0 (consultation seule)',
  'import.review.total': 'Total',
  'import.review.labelsPreview': 'Les noms ressembleront à ceci :',
  'import.review.more': '{n, plural, one {… et # de plus} other {… et # de plus}}',

  // §DI17 -- inline validation errors
  'import.issueSummary':
    '{n, plural, one {# problème} other {# problèmes}} dans {m, plural, one {# tableau} other {# tableaux}}. Corrigez-les ci-dessous et appuyez de nouveau sur Suivant.',
  'import.issueSummaryStale':
    'La saisie a changé depuis la dernière vérification — appuyez sur Suivant pour revérifier.',
  'import.issueJump': 'Aller à cette cellule',

  // location composers
  'import.loc.table': 'Tableau {table}',
  'import.loc.tableRow': 'Tableau {table}, ligne {row}',
  'import.loc.tableRowColumn': 'Tableau {table}, ligne {row}, colonne {column}',
  'import.loc.tableRowColumnHeader': 'Tableau {table}, ligne {row}, colonne {column} ({header})',
  'import.loc.tableColumnHeader': 'Tableau {table}, colonne {column} ({header})',

  // one description per `IssueCode` (dataImportValidate.ts)
  'import.issue.table-limit-exceeded': 'Trop de tableaux ({count}, maximum {max}).',
  'import.issue.column-limit-exceeded': 'Trop de colonnes associées ({count}, maximum {max}).',
  'import.issue.row-limit-exceeded': 'Trop de lignes ({count}, maximum {max}).',
  'import.issue.invalid-header-row': 'La ligne d’en-tête doit être un entier supérieur ou égal à 1.',
  'import.issue.invalid-ignore-rows':
    '« Ignorer les N dernières lignes » doit être un entier supérieur ou égal à 0.',
  'import.issue.empty-table-name': 'Le nom du tableau est vide.',
  'import.issue.label-too-long': 'Le nom du tableau est trop long (maximum {max} caractères).',
  'import.issue.empty-column-header': 'L’en-tête de cette colonne est vide.',
  'import.issue.header-too-long':
    'L’en-tête de cette colonne est trop long (maximum {max} caractères).',
  'import.issue.missing-source-column-id':
    'Cette colonne n’a pas d’identifiant interne — resélectionnez son rôle.',
  'import.issue.duplicate-source-table-id':
    'L’identifiant interne de ce tableau entre en conflit avec celui d’un autre tableau.',
  'import.issue.missing-key-column':
    'Aucune colonne n’est marquée comme clé. Choisissez « Clé » sur la colonne qui identifie chaque ligne, par exemple un identifiant.',
  'import.issue.multiple-key-columns':
    'Plusieurs colonnes sont marquées comme clé — n’en gardez qu’une.',
  'import.issue.empty-key': 'La clé est vide. Chaque ligne a besoin d’une valeur de clé.',
  'import.issue.key-too-long': 'La clé est trop longue (maximum {max} octets).',
  'import.issue.key-control-char': 'La clé contient un caractère de contrôle.',
  'import.issue.duplicate-key':
    'La clé « {value} » est déjà utilisée par une autre ligne. Donnez une clé unique à chaque ligne.',
  'import.issue.ragged-row':
    'Cette ligne a {actual} cellules ; {expected} étaient attendues. Vérifiez s’il manque une virgule ; les lignes de total peuvent être retirées avec « Ignorer les N dernières lignes ».',
  'import.issue.empty-number':
    'Cette cellule est vide. Saisissez un nombre, ou réglez la colonne sur « Ignorer ».',
  'import.issue.invalid-number':
    '« {value} » n’est pas un nombre. Retirez les séparateurs de milliers, les symboles monétaires et %, par exemple 4900.',
  'import.issue.orphan-foreign-key':
    'Aucune ligne du tableau cible n’a la clé « {value} ».',
  'import.issue.missing-fk-target':
    'Cette colonne de clé étrangère n’a pas de tableau cible. Choisissez le tableau qu’elle référence sous l’en-tête de colonne.',
  'import.issue.invalid-fk-target': 'Le tableau cible de cette clé étrangère n’existe plus.',
  'import.issue.missing-group-by':
    'Ce tableau a deux colonnes de clé étrangère ou plus — indiquez laquelle sert à regrouper les cadres (« Regrouper les cadres par » sous la ligne d’en-tête).',
  'import.issue.invalid-group-by':
    'La colonne de regroupement doit être l’une des colonnes de clé étrangère de ce tableau.',
  'import.issue.round-trip-mismatch':
    'Ces données n’ont pas pu être enregistrées de façon sûre — simplifiez-les et réessayez.',
  'import.issue.label-fallback':
    'Aucun nom n’est disponible pour cette référence — la clé brute sera affichée à la place.',

  // one description per `CommitFailureCode` (dataImportCommit.ts).
  'import.commitError.source-table-id-collision':
    'Un tableau portant le même identifiant interne existe déjà — relancez l’import.',
  'import.commitError.parameter-id-collision':
    'Un identifiant généré est entré en conflit avec un identifiant existant — relancez l’import.',
  'import.commitError.frame-placement-failed':
    'Impossible de trouver de la place pour le cadre de « {table} ».',
  'import.commitError.frame-not-found': 'Le cadre sélectionné n’existe plus.',
  'import.commitError.frame-insufficient-space': 'Pas assez de place libre dans « {frame} ».',
  'import.commitError.invalid-result-graph':
    'Le graphe obtenu est invalide — contactez l’assistance technique.',

  // §DI16 Phase 2 -- manage bindings + the refresh wizard
  'import.menu.import': 'Importer des valeurs de feuille de calcul comme paramètres…',
  'import.menu.manage': 'Actualiser ou gérer les tableaux importés…',
  'import.menu.guide': 'Comment préparer une feuille de calcul…',
  'import.refresh.manageTitle': 'Gérer les liaisons de feuille de calcul',
  'import.refresh.noBindings': 'Aucun tableau de feuille de calcul n’est encore lié.',
  'import.refresh.rowCount': '{n, plural, one {# ligne} other {# lignes}}',
  'import.refresh.renameLabel': 'Nom du tableau',
  'import.refresh.refreshButton': 'Actualiser…',
  'import.refresh.exportCsv': 'Exporter un CSV de proposition de modifications',
  'import.refresh.exportBlockedDuplicate':
    'Export bloqué : une même ligne et colonne porte plusieurs paramètres actifs. Corrigez le doublon avant d’exporter.',
  'import.refresh.title': 'Actualiser « {table} »',
  'import.refresh.commit': 'Valider l’actualisation',

  'import.refresh.columnEvents.title': 'Changements de colonnes',
  'import.refresh.columnEvents.none':
    'Aucun changement de colonne — chaque colonne a été appariée automatiquement.',
  'import.refresh.columnEvents.missingHeader':
    'La colonne « {header} » ({role}) n’est plus dans les nouvelles données.',
  'import.refresh.columnEvents.ambiguousMatch':
    'La colonne « {header} » correspond à plusieurs colonnes entrantes.',
  'import.refresh.columnEvents.unresolved': '— choisissez-en une —',
  'import.refresh.columnEvents.removedOption': 'Colonne retirée',
  'import.refresh.columnEvents.mapMore': 'Associer d’autres colonnes…',
  'import.refresh.columnEvents.unrecognized': 'La colonne « {header} » n’est pas associée.',
  'import.refresh.columnEvents.doNotMap': 'Ne pas associer',
  'import.refresh.columnEvents.fkTarget': 'Référence le tableau…',

  'import.refresh.review.added': '{n, plural, one {# ligne sera ajoutée} other {# lignes seront ajoutées}}',
  'import.refresh.review.missing':
    '{n, plural, one {# ligne est absente des nouvelles données} other {# lignes sont absentes des nouvelles données}}',
  'import.refresh.review.changed':
    '{n, plural, one {# valeur sera mise à jour automatiquement} other {# valeurs seront mises à jour automatiquement}}',
  'import.refresh.review.conflicts':
    '{n, plural, one {# valeur est en conflit et demande un choix} other {# valeurs sont en conflit et demandent un choix}}',
  'import.refresh.review.locallyDeleted':
    '{n, plural, one {# valeur a été supprimée localement} other {# valeurs ont été supprimées localement}}',
  'import.refresh.review.fkRepoints':
    '{n, plural, one {# clé étrangère a changé} other {# clés étrangères ont changé}}',
  'import.refresh.review.newColumnValues':
    '{n, plural, one {# valeur de nouvelle colonne sera ajoutée} other {# valeurs de nouvelles colonnes seront ajoutées}}',
  'import.refresh.review.confirmAdd': 'Ajouter cette ligne',
  'import.refresh.review.missingChoiceNone': '— choisissez —',
  'import.refresh.review.missingChoiceUnlink':
    'Conserver telle quelle, dissocier de la feuille de calcul',
  'import.refresh.review.missingChoiceDelete': 'Supprimer',
  'import.refresh.review.missingBlocked':
    'Encore référencée par {table} — actualisez d’abord ce tableau.',
  'import.refresh.review.cellChoiceApplyIncoming': 'Utiliser la nouvelle valeur ({value})',
  'import.refresh.review.cellChoiceKeepMine': 'Conserver ma valeur ({value})',
  'import.refresh.review.locallyDeletedChoiceRecreate':
    'Recréer avec la nouvelle valeur ({value})',
  'import.refresh.review.locallyDeletedChoiceDiscard':
    'Abandonner — ne plus suivre cette cellule',
  'import.refresh.review.fkChoiceAccept': 'Accepter la nouvelle référence ({value})',
  'import.refresh.review.fkChoiceReject': 'Conserver l’ancienne référence ({value})',

  'import.refresh.duplicateTripleError':
    'Ces données sont corrompues : plusieurs paramètres sont liés à la même ligne et à la même colonne. L’actualisation est bloquée tant que ce n’est pas corrigé.',
  'import.refresh.commitError.referenced-node':
    'Impossible de supprimer le paramètre de cette ligne — il est encore référencé ailleurs dans le graphe.',
  'import.refresh.commitError.missing-row-dependency':
    'Impossible de dissocier ou de supprimer cette ligne — un autre tableau la référence encore.',
  'import.refresh.commitError.placement-failed':
    'Impossible de trouver de la place sur le canevas pour le ou les nouveaux paramètres — réessayez depuis une autre position de la vue.',

  // REFRESH-ONLY `RefreshIssueCode` descriptions
  'import.refreshIssue.table-not-found': 'Cette liaison de tableau n’existe plus.',
  'import.refreshIssue.unresolved-column-event':
    'Ce changement de colonne demande un choix avant de continuer.',
  'import.refreshIssue.invalid-column-pairing':
    'Ce choix de colonne ne correspond à aucun changement de colonne en attente.',
  'import.refreshIssue.key-column-cannot-be-removed':
    'La colonne de clé de ligne ne peut pas être retirée — associez-la plutôt à une autre colonne entrante.',
  'import.refreshIssue.duplicate-column-pairing': 'Ce choix de colonne en contredit un autre.',
  'import.refreshIssue.invalid-new-column-pairing':
    'La cible de clé étrangère de cette nouvelle colonne est invalide.',
  'import.refreshIssue.duplicate-source-column-id':
    'L’identifiant interne de cette colonne entre en conflit avec un identifiant existant.',
} satisfies Record<DataImportKey, string>

export default dataImport
