// docs/localization.md §L3.3 — the UI-chrome slice of the `fr` catalog.
// `satisfies Record<UiKey, string>` makes `tsc` fail on a missing or an extra
// key against `../en/ui`.
//
// Glossary: Paramètres Settings · Fichier File · Modèles templates · module ·
// projet · révision de projet · proposition · importer/exporter · partager ·
// Annuler/Rétablir undo/redo · Monte-Carlo · réservoir Pool · valeur calculée
// Register · cadre de groupe frame · Propriétés Inspector · chronologie
// timeline · graine seed · régime permanent steady state.
// **pas** is a simulation step; **étape** is a stage of a guided tour or a
// production line (§L2.7). Format tokens (`Graph JSON`, `Workspace JSON`,
// `CSV`, `#g1=`, `v1 / v2`, `MonteCarloResult`, `p10/p50/p90`), key names and
// every `{slot}` stay exactly as they are.

import type { UiKey } from '../en/ui'

const ui = {
  'i18n.messageError': 'texte indisponible ({key})',
  'i18n.loadFailed': 'Impossible de charger {language}. {current} reste affiché.',
  'toolbar.preview': 'aperçu',
  'toolbar.buildTitle': 'Loop Studio v{version} · build {sha}',
  'toolbar.undo.title': 'Annuler (Ctrl/Cmd+Z)',
  'toolbar.redo.title': 'Rétablir (Ctrl/Cmd+Shift+Z)',
  'toolbar.new': 'Nouveau',
  'toolbar.import': 'Importer',
  'toolbar.more': 'Autres actions',
  'toolbar.newGraph.title': 'Commencer un nouveau graphe ?',
  'toolbar.newGraph.body': 'Votre graphe actuel sera remplacé.',
  'toolbar.newGraph.confirm': 'Nouveau graphe',
  'toolbar.file.button': 'Fichier ▾',
  'toolbar.file.menuLabel': 'Fichier',
  'toolbar.settings.button': 'Paramètres ▾',
  'toolbar.settings.menuLabel': 'Paramètres',
  'theme.rowLabel': 'Thème',
  'theme.title': 'Thème : système / clair / sombre',
  'theme.auto': '◐ Auto',
  'theme.light': '☀ Clair',
  'theme.dark': '☾ Sombre',
  'theme.option.system': 'Auto',
  'theme.option.light': 'Clair',
  'theme.option.dark': 'Sombre',
  'theme.menuLabel': 'Thème',
  'lang.rowLabel': 'Langue',
  'lang.title': 'Langue',
  'lang.menuLabel': 'Choisir une langue',
  'lang.loading': 'chargement…',
  'lang.search': 'Rechercher une langue',
  'lang.noResults': 'Aucune langue correspondante',
  // a language's own name in the ACTIVE UI language (registry `displayNameKey`)
  'language.english': 'Anglais',
  'language.korean': 'Coréen',
  'language.japanese': 'Japonais',
  'language.chineseSimplified': 'Chinois (simplifié)',
  'language.chineseTraditional': 'Chinois (traditionnel)',
  'language.french': 'Français',
  'language.german': 'Allemand',
  'language.spanishLatinAmerica': 'Espagnol (Amérique latine)',
  'language.portugueseBrazil': 'Portugais (Brésil)',
  'language.spanishSpain': 'Espagnol (Espagne)',
  'language.portuguesePortugal': 'Portugais (Portugal)',
  'language.russian': 'Russe',
  'language.turkish': 'Turc',
  'language.thai': 'Thaï',
  'playbar.reset.title': 'Réinitialiser au pas 0',
  'playbar.step.title': 'Avancer d’un pas',
  'playbar.play': '▶ Lecture',
  'playbar.pause': '⏸ Pause',
  'playbar.replay': '⟳ Rejouer',
  'playbar.step': 'pas {n}',
  'playbar.stepEnded': 'pas {n} · terminé',
  'playbar.speed': 'vitesse',
  'playbar.seed': 'graine',
  'playbar.seed.title':
    'Graine aléatoire — la même graine reproduit l’exécution ; la modifier relance depuis le début',
  'playbar.mc': 'Monte-Carlo',
  'playbar.mc.withNote': 'Monte-Carlo · {note}',
  'playbar.mc.cancelled': 'Annulé',
  'playbar.mc.failed': 'Échec de l’exécution',
  'playbar.initError': 'Exécution impossible : {detail}',
  'playbar.mc.title': 'Exécuter le schéma de nombreuses fois et voir la distribution',
  'playbar.mc.progress': 'Monte-Carlo {pct} %',
  'playbar.mc.progress.title': 'Exécution Monte-Carlo en cours',
  'playbar.cancel': 'Annuler',
  'playbar.steady': 'Régime permanent — les flux continuent',
  'playbar.timeline.show': 'Afficher la chronologie',
  'playbar.timeline.hide': 'Masquer la chronologie',
  'runbar.ariaLabel': 'Commandes d’exécution',
  'runbar.mc.cancel': 'MC {pct} % · Annuler',
  'runbar.timeline': 'Chronologie',
  'mobile.topbar.caption': 'consulter et exécuter — édition sur ordinateur',
  'mobile.more': 'Plus',
  'a11y.playback.started': 'Lecture démarrée',
  'a11y.playback.endedAtStep': 'Terminé au pas {n}',
  'a11y.playback.resetToZero': 'Réinitialisé au pas 0',
  'a11y.playback.stepN': 'Pas {n}',
  'a11y.playback.pausedAtStep': 'En pause au pas {n}',
  'timeline.title': 'chronologie',
  'timeline.view.live': 'EN DIRECT',
  'timeline.view.distribution': 'DISTRIBUTION',
  'timeline.legend.hide': 'Masquer {label}',
  'timeline.legend.show': 'Afficher {label}',
  'timeline.legend.more': '+{n} de plus',
  'timeline.legend.fewer': 'Afficher moins',
  'timeline.csv': 'CSV',
  'timeline.csvTitle': 'Télécharger l’exécution au format CSV',
  'timeline.axis.step': 'pas {n}',
  'timeline.sheetTitle': 'Chronologie',
  'mobile.inspector.title': 'Propriétés — lecture seule',
  'mobile.inspector.roNote':
    'L’édition se fait sur ordinateur. Ceci est une vue en lecture seule.',
  'error.unknownCode': 'l’expression est invalide',
  'error.EXPR_EMPTY.message': 'l’expression est vide',
  'error.EXPR_SYNTAX.message': 'erreur de syntaxe au caractère {column}',
  'error.EXPR_UNCLOSED_PAREN.message': '« ( » au caractère {column} n’est jamais fermée',
  'error.EXPR_UNCLOSED_REF.message':
    '« @\'{\' » au caractère {column} n’est jamais fermée',
  'error.EXPR_BAD_ESCAPE.message':
    '« \\ » au caractère {column} doit être suivi de « \'}\' » ou « \\ »',
  'error.EXPR_NUMBER_RANGE.message': 'le nombre au caractère {column} est trop grand',
  'error.EXPR_BAD_TOKEN.message': 'il y a un caractère parasite au caractère {column}',
  'dialog.cancel': 'Annuler',
  'dialog.close': 'Fermer',
  'share.button': 'Partager',
  'share.button.title': 'Copier un lien qui ouvre ce schéma',
  'share.disclosure.title': 'Créer un lien de partage ?',
  'share.disclosure.body':
    'Le lien contient l’intégralité de ce schéma, y compris chaque nom — toute personne qui l’a peut ouvrir et modifier le schéma. Il n’est pas envoyé sur un serveur, mais il voyage à l’intérieur du lien : il reste donc dans votre historique de navigation et il est visible par toute personne à qui vous l’envoyez.',
  'share.disclosure.confirm': 'Créer le lien',
  'share.tooLarge':
    'Ce schéma est trop volumineux pour un lien de partage ({size} ; la limite est {cap}). Utilisez « Fichier ▾ → Graph JSON » et partagez le fichier à la place.',
  'share.replacePrompt':
    'Ouvrir le schéma partagé ? Votre schéma actuel sera remplacé. Exportez-le d’abord si vous voulez le conserver.',
  'share.noBase':
    'Le partage n’est pas configuré avec une adresse publique, un lien ne peut donc pas être créé. Merci de le signaler.',
  'share.panel.label': 'Lien de partage',
  'share.panel.copied': 'Lien copié dans le presse-papiers.',
  'share.panel.copyThis': 'Copiez ce lien :',
  'share.panel.copyAgain': 'Copier à nouveau',
  'share.panel.copy': 'Copier',
  'share.panel.close': 'Fermer',
  'pwa.text':
    'Une nouvelle version de Loop Studio est prête. L’appliquer recharge l’application et réinitialise l’exécution en cours ainsi que tout résultat non enregistré. Votre schéma est enregistré.',
  'pwa.update': 'Mettre à jour',
  'pwa.dismiss': 'Ignorer',
  'pwa.running.title': 'Une exécution est en cours',
  'pwa.running.body':
    'Appliquer la mise à jour recharge la page et met fin à l’exécution en cours. L’appliquer quand même ?',
  'pwa.running.confirm': 'Appliquer et recharger',
  'bootNotice.dismiss': 'Ignorer',
  'autosave.failed.quota':
    'L’enregistrement automatique s’est arrêté : le stockage de ce navigateur est plein, vos dernières modifications ne sont donc pas enregistrées sur cet appareil. Exportez un fichier pour les conserver.',
  'autosave.failed.unavailable':
    'L’enregistrement automatique est indisponible : ce navigateur bloque le stockage, les modifications ne sont donc pas enregistrées sur cet appareil. Exportez un fichier pour les conserver.',
  'autosave.exportButton': 'Exporter Graph JSON',
  'bootNotice.proposalReboot':
    'Cette session modifiait une proposition. La base dont elle est issue n’est pas enregistrée sur cet appareil : elle a donc été rouverte comme un graphe ordinaire — vos modifications sont conservées. Réimportez le fichier de proposition pour la relire ou la réexporter.',
  'revChip.proposal': 'proposition',
  'revChip.rev': 'rév. {id}',
  'revChip.title': 'Projet {project} · {role} {revision}',
  'revChip.titleDirty':
    'Projet {project} · {role} {revision} · modifications non enregistrées depuis cette révision',
  'revChip.unsaved': 'modifications non enregistrées',
  'import.replace.title': 'Remplacer le schéma actuel ?',
  'import.replace.body': 'Le fichier importé remplacera ce qui se trouve sur le canevas.',
  'import.replace.confirm': 'Remplacer',
  'import.readError': 'Impossible de lire ce fichier.',
  'import.error.invalidJson': 'Ce fichier n’est pas du JSON valide.',
  'import.error.unexpected': 'Contenu de fichier inattendu.',
  'import.error.notLoopStudio': 'Cela ne ressemble pas à un fichier de graphe Loop Studio.',
  'import.error.missingNodesEdges': 'Il manque nodes ou edges au fichier de graphe.',
  'import.structuralWarning':
    'Ce graphe présente des problèmes de structure et ces connexions sont ignorées :\n{detail}',
  'import.modelLayerUnreadable':
    'Le contenu de la couche modèle de ce fichier est illisible ({detail}) ; ses données de projet ont été ignorées.',
  'mobile.more.import': 'Importer un fichier',
  'mobile.more.importSub': 'Graph ou Workspace JSON',
  'export.button': 'Exporter ▾',
  'export.menuLabel': 'Exporter',
  'export.graphJson.name': 'Graph JSON',
  'export.graphJson.blurb': 'le schéma + les réglages d’exécution recommandés',
  'export.workspaceJson.name': 'Workspace JSON',
  'export.workspaceJson.blurb': 'graphe + distribution + vue + exécution en cours',
  'export.projectRevision.name': 'Révision de projet',
  'export.projectRevision.blurb':
    'le schéma, plus identifiant de projet et filiation, pour la collaboration hors ligne',
  'export.proposal.name': 'Créer une proposition',
  'export.proposal.blurb': 'une copie à modifier et à renvoyer pour relecture',
  'export.proposal.needRevision': 'Exportez d’abord une révision de projet',
  'revision.export.noSecureRandom':
    'Ce navigateur n’a pas de source aléatoire sûre, un identifiant de révision ne peut donc pas être créé. Rien n’a été exporté.',
  'revision.export.tooLarge':
    'Ce schéma est trop volumineux pour être exporté comme révision de projet ({size} ; limite {cap}). Utilisez « Fichier ▾ → Graph JSON » à la place.',
  'proposal.needProject':
    'Créer une proposition demande un projet ouvert. Utilisez d’abord « Fichier ▾ → Révision de projet » pour en créer un.',
  'proposal.dirtyOrigin':
    'Le document a changé depuis cette révision. Utilisez « Fichier ▾ → Révision de projet » pour figer les modifications, puis créez une proposition.',
  'proposal.tooLarge':
    'Cette proposition est trop volumineuse pour être envoyée en un seul fichier ({size} ; limite {cap}). Un Graph JSON ordinaire reste possible.',
  'export.author.name': 'Définir l’auteur des exports…',
  'export.author.blurb': 'étiquette locale à l’appareil, non vérifiée, jointe au fichier',
  'export.projectRevision.disclosure.title': 'Exporter une révision de projet ?',
  'export.projectRevision.disclosure.body':
    'Le fichier est un Graph JSON ordinaire qui porte en plus une identité de projet et la filiation de cette révision, pour qu’un collaborateur puisse comparer et appliquer vos modifications entièrement hors ligne. Ni compte ni serveur — tout voyage dans le fichier.',
  'export.projectRevision.disclosure.confirm': 'Exporter la révision',
  'export.workspace.title': 'Enregistrer cet espace de travail ?',
  'export.workspace.included': 'Comprend : {items}.',
  'export.workspace.excluded':
    'Non compris : l’historique d’annulation, la sélection, le thème.',
  'export.workspace.confirm': 'Enregistrer l’espace de travail',
  'export.workspace.item.runConfig': 'la configuration d’exécution',
  'export.workspace.item.distribution': 'la distribution sur {runs} exécutions',
  'export.workspace.item.timeline': 'la vue chronologie',
  'export.workspace.item.canvas': 'la position du canevas',
  'export.workspace.item.liveRun': 'l’exécution en cours au pas {step}',
  'export.workspace.omit.body':
    'Avec la distribution, cela atteint {full} — au-delà de la limite de {limit}. Enregistrer sans la distribution ({lean}) ?',
  'export.workspace.omit.confirm': 'Enregistrer sans',
  'export.workspace.reject':
    'Cet espace de travail fait {size} — au-delà de la limite de {limit} même sans la distribution. Allégez le graphe, ou utilisez Graph JSON.',
  'author.title': 'Auteur des exports',
  'author.name': 'Nom',
  'author.namePlaceholder': 'par exemple Alex',
  'author.note': 'Note (facultatif)',
  'author.notePlaceholder': 'un court message qui accompagne le fichier',
  'author.disclosure':
    'Ce nom n’est enregistré que sur cet appareil. Il est joint — sans vérification — à chaque révision de projet et à chaque proposition que vous exportez, et il voyage dans le fichier que vous envoyez. N’importe qui peut le modifier ; considérez-le comme une étiquette, pas comme une identité.',
  'author.save': 'Enregistrer',
  'mc.title': 'Monte-Carlo',
  'mc.close': 'Fermer',
  'mc.closeKeepRunning': 'Fermer (poursuivre l’exécution)',
  'mc.field.runs': 'exécutions',
  'mc.field.steps': 'pas',
  'mc.field.baseSeed': 'graine de base',
  'mc.pools.head': 'réservoirs suivis',
  'mc.pools.headAll': 'suivis · tous les réservoirs',
  'mc.pools.headSome': 'suivis · {n} sur {total}',
  'mc.pools.selectAll': 'Tout sélectionner',
  'mc.pools.none': 'Aucun réservoir dans le graphe — ajoutez-en un pour exécuter.',
  'mc.pools.group': 'Réservoirs suivis',
  'mc.pools.keepOne': 'Au moins un réservoir doit rester suivi.',
  'mc.cost.estimating': 'estimation…',
  'mc.cost.measured': 'Mesuré (dernière exécution)',
  'mc.cost.benchmark': 'Test de référence local',
  'mc.cost.execution': 'Exécution',
  'mc.cost.parallel': 'En parallèle, {workers} processus',
  'mc.cost.localPause': 'Local · peut marquer une brève pause',
  'mc.cost.local': 'Local',
  'mc.cost.memory': 'Mémoire',
  'mc.cost.overLimit': ' — au-delà de la limite, réduisez les exécutions ou les pas',
  'mc.run': 'Lancer {runs} exécutions',
  'mc.cancel': 'Annuler',
  'review.title': 'Relire la proposition',
  'review.close': 'Fermer',
  'review.byPrefix': 'Proposé par',
  'review.byAnon': 'Proposition',
  'review.unverified': '· non vérifié',
  'review.fileSays': 'le fichier indique : {stamp}',
  'review.differentProject': 'Identifiant de projet différent de celui que vous avez ouvert.',
  'review.diff.none': 'Aucune modification du graphe.',
  'review.diff.nodes': 'Nœuds',
  'review.diff.edges': 'Connexions',
  'review.diff.runConfig': 'configuration d’exécution',
  'review.diff.frames': 'cadres',
  'review.gate.wrongProject':
    'Cette proposition appartient à un autre projet. Vous pouvez tout de même l’ouvrir comme document.',
  'review.gate.noTarget':
    'Aucun projet n’est ouvert. Ouvrez cette proposition comme document, ou annulez.',
  'review.gate.targetIsProposal':
    'Vous avez actuellement une proposition ouverte. Exportez-la comme révision de projet avant d’y appliquer une autre proposition.',
  'review.gate.versionMismatch':
    'Cette proposition et le document ouvert n’ont pas la même version de modèle (v1 / v2). Elle ne peut pas être appliquée ici. Vous pouvez tout de même l’ouvrir comme document.',
  'review.class.exact':
    'La révision que vous avez ouverte est exactement la base dont cette proposition est issue.',
  'review.class.divergent':
    'La révision que vous avez ouverte contient des modifications qui recoupent cette proposition. Appliquer toute la proposition les abandonne.',
  'review.class.unknown':
    'La révision que vous avez ouverte contient des modifications et les fichiers ne permettent pas d’établir leur lien. Aucun conflit de champ n’a été trouvé.',
  'review.confirm.default':
    'Cette proposition est issue d’une révision antérieure. Appliquer toute la proposition remplace votre graphe par sa version — vos modifications depuis lors sont perdues. Une annulation revient en arrière.',
  'review.confirm.unknown':
    'Cette proposition est issue d’une révision antérieure, et leur lien ne peut pas être établi à partir des fichiers. Appliquer toute la proposition remplace votre graphe par sa version — vos modifications depuis lors sont perdues. Une annulation revient en arrière.',
  'review.err.targetMoved':
    'Le document a changé depuis votre confirmation — relisez la modification et appliquez de nouveau.',
  'review.err.targetMovedList':
    'Le document a changé pendant votre choix — la liste ci-dessous est à jour. Relisez et appliquez de nouveau.',
  'review.err.noEffect': 'Ces choix ne changent rien — il n’y a rien à appliquer.',
  'review.err.generic': 'Application impossible ({reason}).',
  'review.fail.wrongProject': 'Cette proposition concerne un autre projet.',
  'review.fail.noTarget': 'Aucun projet ouvert sur lequel appliquer.',
  'review.fail.targetIsProposal':
    'Exportez d’abord la proposition ouverte comme révision de projet.',
  'review.fail.versionMismatch':
    'Cette proposition et le document ouvert n’ont pas la même version de modèle (v1 / v2), elle ne peut donc pas être appliquée ici.',
  'review.fail.payloadInvalid':
    'Ce fichier de proposition a échoué au contrôle d’intégrité — réimportez-le.',
  'review.fail.invalidSelection':
    'Cette sélection ne peut pas être appliquée — une connexion acceptée a besoin d’un nœud que vous n’avez pas inclus. Ajustez les choix et réessayez.',
  'review.hunks.none': 'Rien de nouveau à appliquer — la cible correspond déjà.',
  'review.hunk.add': 'Ajouter',
  'review.hunk.remove': 'Retirer',
  'review.hunk.change': 'Modifier',
  'review.hunk.bothChanged': ' · les deux côtés ont modifié ceci',
  'review.hunk.youDeleted': ' · vous avez supprimé ceci',
  'review.hunk.alsoRemove': 'retirer aussi la connexion ou la rediriger',
  'review.hunk.cantRemove': 'retrait impossible — votre côté a ajouté une connexion',
  'review.hunk.toThisNode': 'vers ce nœud',
  'review.hunk.framesTitle': 'Cadres enregistrés',
  'review.hunk.framesTake': 'Prendre les cadres de la proposition ({yours} → {theirs})',
  'review.hunk.framesClear': 'Prendre les cadres de la proposition (effacer les {yours})',
  'review.field.base': 'base',
  'review.field.yours': 'votre valeur',
  'review.field.theirs': 'leur valeur',
  'review.field.takeTheirs': 'prendre leur valeur',
  'review.field.keepMine': 'garder ma valeur',
  'review.action.applyAnyway': 'Appliquer quand même',
  'review.action.applyProposal': 'Appliquer la proposition',
  'review.action.applySelected': 'Appliquer les {count} éléments choisis',
  'review.action.chooseChanges': 'Choisir les modifications',
  'review.action.wholeProposal': 'Toute la proposition',
  'review.action.openAsDoc': 'Ouvrir comme document',
  'review.action.cancel': 'Annuler',
  'review.foot.hunks':
    'Appliquer la cible plus les modifications que vous choisissez crée une nouvelle révision locale (parent {parent}) ; une annulation revient en arrière. Rien n’est écrit dans un fichier.',
  'review.foot.whole':
    'Appliquer crée une nouvelle révision locale (parent {parent}) ; une annulation revient en arrière. Rien n’est écrit dans un fichier.',
  'dist.runs': 'exécutions',
  'dist.steps': 'pas',
  'dist.seed': 'graine',
  'dist.ended': 'Terminé',
  'dist.stale': 'périmé — le graphe a changé ; relancez pour actualiser',
  'dist.export.staleTitle': 'Résultat périmé — relancez pour exporter',
  'dist.export.title': 'Exporter cette exécution',
  'dist.export.seriesCsv': 'CSV de séries',
  'dist.export.seriesCsv.blurb': 'p10/p50/p90/moyenne/min/max par pas',
  'dist.export.runsCsv': 'CSV d’exécutions',
  'dist.export.runsCsv.blurb': 'valeur finale par exécution · exécution, graine, réservoirs',
  'dist.export.summaryCsv': 'CSV de synthèse',
  'dist.export.summaryCsv.blurb': 'synthèse des valeurs finales par réservoir',
  'dist.export.json.blurb': 'MonteCarloResult complet',
  'term.title': 'arrêt',
  'term.ended': 'terminé',
  'term.noRuns': 'Aucune exécution terminée',
  'band.pool': 'Réservoir',
  'band.mean': 'moyenne',
  'openhint.title': 'Pas de synchronisation de compte',
  'openhint.body':
    'Ouvrez un fichier enregistré ou un lien de partage pour le consulter ici.',
  'openhint.button': 'Ouvrir un fichier',
  'openhint.sub':
    'Exportez Graph JSON ou Workspace JSON sur ordinateur, ou ouvrez un lien de partage #g1=.',
  'tour.welcome.title': 'Bienvenue dans Loop Studio',
  'tour.welcome.body':
    'Une visite rapide de deux minutes des six parties de l’espace de travail ?',
  'tour.welcome.start': 'Commencer la visite',
  'tour.welcome.skip': 'Passer',
  'tour.nav.back': 'Précédent',
  'tour.nav.next': 'Suivant',
  'tour.nav.done': 'Terminé',
  'tour.nav.position': '{n} / {total}',
  'tour.nav.close': 'Fermer la visite',
  'tour.desktop.pieces.title': 'Éléments',
  'tour.desktop.pieces.body':
    'Les briques de base — réservoir, source, puits, aiguillage, et les autres. Cliquez sur l’une d’elles, ou faites-la glisser sur le canevas, pour l’ajouter.',
  'tour.desktop.canvas.title': 'Canevas',
  'tour.desktop.canvas.body':
    'Placez les éléments ici, reliez-les d’un point de connexion à l’autre, et déplacez-vous ou zoomez pour naviguer.',
  'tour.desktop.inspector.title': 'Propriétés',
  'tour.desktop.inspector.body':
    'Sélectionnez un élément ou une connexion pour en modifier les réglages ici.',
  'tour.desktop.playback.title': 'Lecture',
  'tour.desktop.playback.body':
    'Exécutez le modèle pas à pas ou en continu. Une graine fixe rend une exécution aléatoire reproductible.',
  'tour.desktop.timeline.title': 'Chronologie',
  'tour.desktop.timeline.body':
    'Observez l’évolution des valeurs des réservoirs et des résultats d’exécution dans le temps.',
  'tour.desktop.files.title': 'Fichiers et partage',
  'tour.desktop.files.body':
    'Partez d’un modèle, importez un fichier, copiez un lien de partage, ou exportez le graphe ou l’espace de travail.',
  'tour.mobile.open.title': 'Ouvrir un graphe',
  'tour.mobile.open.body':
    'Ouvrez un graphe partagé — depuis un lien #g1=, ou en important un fichier depuis le menu Plus.',
  'tour.mobile.canvas.title': 'Se déplacer',
  'tour.mobile.canvas.body':
    'Faites glisser pour vous déplacer, pincez pour zoomer. « Ajuster » recentre le schéma.',
  'tour.mobile.inspect.title': 'Consulter',
  'tour.mobile.inspect.body':
    'Touchez un nœud ou une connexion pour en lire la configuration. L’édition est réservée à l’ordinateur.',
  'tour.mobile.run.title': 'Exécuter',
  'tour.mobile.run.body':
    'Parcourez le modèle pas à pas, ou appuyez sur Lecture pour l’exécuter.',
  'tour.mobile.timeline.title': 'Chronologie',
  'tour.mobile.timeline.body':
    'Ouvrez le panneau de chronologie pour voir les valeurs dans le temps.',
  'tour.mobile.more.title': 'Plus',
  'tour.mobile.more.body':
    'Le partage, l’export et le changement de langue se trouvent tous dans ce menu.',
  'tour.help.menuLabel': 'Aide',
  'tour.help.takeTour': 'Faire la visite',
  'tour.help.about': 'À propos de Loop Studio',
  'tour.help.feedback': 'Envoyer un retour (formulaire en anglais)',
  'tour.help.feedbackAria':
    'Envoyer un retour (formulaire en anglais) — s’ouvre dans un nouvel onglet',
  'about.createdBy': 'Créé par',
  'about.repo': 'Dépôt GitHub',
  'about.repoAria': 'Dépôt GitHub de Loop Studio',
  'about.notAffiliated':
    'Loop Studio est un projet indépendant, sans affiliation avec Machinations.io ni approbation de sa part.',
  'hint.close': 'Masquer cette note',
  'hint.emptyCanvas.body':
    'Partez d’un modèle, ou faites glisser des types de nœuds depuis le panneau de gauche.',
  'hint.mc.body':
    'Monte-Carlo exécute le modèle de nombreuses fois et montre un éventail de résultats, pas une prédiction unique.',
  'hint.review.body':
    'Relire une proposition ne modifie jamais le projet que vous avez ouvert — rien ne bouge tant que vous ne l’appliquez pas.',
  // docs/data-import.md §DI17
  'hint.importFirstCommit.body':
    '{n, plural, one {# paramètre ajouté} other {# paramètres ajoutés}} depuis {tables}. Leurs valeurs sont dans le panneau Entrées. Pour en utiliser un dans une valeur calculée, saisissez @ dans son expression et choisissez le nom ; le champ de flux d’une connexion et un activateur proposent le même sélecteur.',
  'help.contextual.hint.import.name': 'Import de feuille de calcul',
  'help.contextual.hint.import.desc':
    'Affiché une fois, juste après le premier import de feuille de calcul sur le canevas.',
  'hint.frameMove.body':
    'Faites glisser le bord d’un cadre pour le déplacer avec tout ce qu’il contient. Maintenez Alt pendant le déplacement pour ne bouger que le cadre.',
  'help.contextual.hint.frameMove.name': 'Déplacement de cadre',
  'help.contextual.hint.frameMove.desc':
    'Affiché une fois, la première fois qu’un cadre de groupe est sélectionné sur un canevas modifiable.',
  'hint.focusFilter.body':
    'Le graphe se charge ? « Focus » estompe tout sauf le voisinage d’un nœud ; « Filtres » masque des types de nœuds ou de connexions.',
  'help.contextual.menuLabel': 'Aide contextuelle',
  'help.contextual.title': 'Aide contextuelle',
  'help.contextual.intro':
    'Loop Studio affiche quelques notes courtes la première fois que chacun de ces cas se présente. Réarmez-en une pour la revoir la prochaine fois qu’elle s’applique.',
  'help.contextual.rearm': 'Afficher de nouveau la prochaine fois',
  'help.contextual.rearmWaiting': 'En attente d’affichage',
  'help.contextual.rearmWaitingHint':
    'Elle s’affichera d’elle-même à la prochaine occasion appropriée.',
  'help.contextual.hint.emptyCanvas.name': 'Canevas vide',
  'help.contextual.hint.emptyCanvas.desc':
    'Affiché sur un canevas vide, avant qu’un nœud n’existe.',
  'help.contextual.hint.mc.name': 'Monte-Carlo',
  'help.contextual.hint.mc.desc':
    'Affiché la première fois que la fenêtre Monte-Carlo s’ouvre.',
  'help.contextual.hint.review.name': 'Relecture',
  'help.contextual.hint.review.desc':
    'Affiché la première fois qu’une proposition partagée s’ouvre pour relecture.',
  'help.contextual.hint.focusFilter.name': 'Focus / Filtres',
  'help.contextual.hint.focusFilter.desc':
    'Affiché une fois que le graphe est assez grand pour que Focus et Filtres deviennent utiles.',
} satisfies Record<UiKey, string>

export default ui
