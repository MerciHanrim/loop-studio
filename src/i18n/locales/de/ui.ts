// docs/localization.md §L3.3 — the shared-UI slice of the `de` catalog.
// `satisfies Record<UiKey, string>` makes `tsc` fail on a missing or an extra
// key against `../en/ui`.
//
// Glossary (§L2.12): Speicher Pool · Quelle Source · Senke Drain · Verteiler
// Gate · Konverter Converter · Berechneter Wert Register · Knoten node ·
// Verbindung connection · Gruppenrahmen frame · Linienführung route ·
// Zeitverlauf timeline · Eigenschaften Inspector · Vorlage template ·
// Modul module · Vorschlag proposal · Projektstand project revision ·
// Startwert seed · Verteilung distribution · Lauf run · Schritt step ·
// Arbeitsbereich workspace · Ziehung gacha pull.
//
// `Schritt` covers both a simulation timestep and a stage of a procedure;
// German does not need the split French makes (§L2.12).
//
// §L2.11 — `{column}` in the `error.EXPR_*` messages is a 1-based CHARACTER
// offset, so German says `Zeichen`, never `Spalte`.
//
// Style: impersonal or infinitive where possible, formal `Sie` when a subject
// is unavoidable — never `du`. German noun capitalisation only, never English
// Title Case. Quotation marks „…“. Numbers come from the locale formatter,
// never hardcoded.

import type { UiKey } from '../en/ui'

const ui = {
  'i18n.messageError': 'Text nicht verfügbar ({key})',
  'i18n.loadFailed': '{language} konnte nicht geladen werden. Es wird weiter {current} angezeigt.',
  'toolbar.preview': 'Vorschau',
  'toolbar.buildTitle': 'Loop Studio v{version} · Build {sha}',
  'toolbar.undo.title': 'Rückgängig (Strg/Cmd+Z)',
  'toolbar.redo.title': 'Wiederherstellen (Strg/Cmd+Umschalt+Z)',
  'toolbar.new': 'Neu',
  'toolbar.import': 'Importieren',
  'toolbar.more': 'Weitere Aktionen',
  'toolbar.newGraph.title': 'Einen neuen Graphen anlegen?',
  'toolbar.newGraph.body': 'Ihr aktueller Graph wird ersetzt.',
  'toolbar.newGraph.confirm': 'Neuer Graph',
  'toolbar.file.button': 'Datei ▾',
  'toolbar.file.menuLabel': 'Datei',
  'toolbar.settings.button': 'Einstellungen ▾',
  'toolbar.settings.menuLabel': 'Einstellungen',
  'theme.rowLabel': 'Design',
  'theme.title': 'Design: System / Hell / Dunkel',
  'theme.auto': '◐ Automatisch',
  'theme.light': '☀ Hell',
  'theme.dark': '☾ Dunkel',
  'theme.option.system': 'Automatisch',
  'theme.option.light': 'Hell',
  'theme.option.dark': 'Dunkel',
  'theme.menuLabel': 'Design',
  'lang.rowLabel': 'Sprache',
  'lang.title': 'Sprache',
  'lang.menuLabel': 'Eine Sprache wählen',
  'lang.loading': 'wird geladen…',
  'lang.search': 'Sprachen durchsuchen',
  'lang.noResults': 'Keine passende Sprache',
  'language.english': 'Englisch',
  'language.korean': 'Koreanisch',
  'language.japanese': 'Japanisch',
  'language.chineseSimplified': 'Chinesisch (vereinfacht)',
  'language.chineseTraditional': 'Chinesisch (traditionell)',
  'language.french': 'Französisch',
  'language.german': 'Deutsch',
  'language.spanishLatinAmerica': 'Spanisch (Lateinamerika)',
  'language.portugueseBrazil': 'Portugiesisch (Brasilien)',
  'language.spanishSpain': 'Spanisch (Spanien)',
  'language.portuguesePortugal': 'Portugiesisch (Portugal)',
  'language.russian': 'Russisch',
  'language.turkish': 'Türkisch',
  'language.thai': 'Thailändisch',
  'language.vietnamese': 'Vietnamesisch',
  'language.italian': 'Italienisch',
  'language.dutch': 'Niederländisch',
  'playbar.reset.title': 'Auf Schritt 0 zurücksetzen',
  'playbar.step.title': 'Einen Schritt weiter',
  'playbar.play': '▶ Abspielen',
  'playbar.pause': '⏸ Pause',
  'playbar.replay': '⟳ Erneut abspielen',
  'playbar.step': 'Schritt {n}',
  'playbar.stepEnded': 'Schritt {n} · beendet',
  'playbar.speed': 'Tempo',
  'playbar.seed': 'Startwert',
  'playbar.seed.title':
    'Zufälliger Startwert — derselbe Startwert wiederholt den Lauf; eine Änderung startet neu',
  'playbar.mc': 'Monte Carlo',
  'playbar.mc.withNote': 'Monte Carlo · {note}',
  'playbar.mc.cancelled': 'Abgebrochen',
  'playbar.mc.failed': 'Lauf fehlgeschlagen',
  'playbar.initError': 'Ausführen nicht möglich: {detail}',
  'playbar.mc.title': 'Das Diagramm viele Male ausführen und die Verteilung ansehen',
  'playbar.mc.progress': 'Monte Carlo {pct} %',
  'playbar.mc.progress.title': 'Monte-Carlo-Lauf läuft',
  'playbar.cancel': 'Abbrechen',
  'playbar.steady': 'Eingeschwungener Zustand — die Flüsse laufen weiter',
  'playbar.timeline.show': 'Zeitverlauf einblenden',
  'playbar.timeline.hide': 'Zeitverlauf ausblenden',
  'runbar.ariaLabel': 'Steuerung des Laufs',
  'runbar.mc.cancel': 'MC {pct} % · Abbrechen',
  'runbar.timeline': 'Zeitverlauf',
  'mobile.topbar.caption': 'ansehen und ausführen — bearbeiten am Rechner',
  'mobile.more': 'Mehr',
  'a11y.playback.started': 'Wiedergabe gestartet',
  'a11y.playback.endedAtStep': 'Bei Schritt {n} beendet',
  'a11y.playback.resetToZero': 'Auf Schritt 0 zurückgesetzt',
  'a11y.playback.stepN': 'Schritt {n}',
  'a11y.playback.pausedAtStep': 'Bei Schritt {n} angehalten',
  'timeline.title': 'Zeitverlauf',
  'timeline.view.live': 'LIVE',
  'timeline.view.distribution': 'VERTEILUNG',
  'timeline.legend.hide': '{label} ausblenden',
  'timeline.legend.show': '{label} einblenden',
  'timeline.legend.more': '+{n} weitere',
  'timeline.legend.fewer': 'Weniger anzeigen',
  'timeline.csv': 'CSV',
  'timeline.csvTitle': 'Den Lauf als CSV herunterladen',
  'timeline.axis.step': 'Schritt {n}',
  'timeline.sheetTitle': 'Zeitverlauf',
  'mobile.inspector.title': 'Eigenschaften — schreibgeschützt',
  'mobile.inspector.roNote':
    'Bearbeitet wird am Rechner. Dies ist eine schreibgeschützte Ansicht.',
  'error.unknownCode': 'der Ausdruck ist ungültig',
  'error.EXPR_EMPTY.message': 'der Ausdruck ist leer',
  // §L2.11 — a 1-based CHARACTER offset, never a table column
  'error.EXPR_SYNTAX.message': 'an Zeichenposition {column} liegt ein Syntaxfehler',
  'error.EXPR_UNCLOSED_PAREN.message': '„(“ an Zeichen {column} wird nie geschlossen',
  'error.EXPR_UNCLOSED_REF.message': '„@\'{\'“ an Zeichen {column} wird nie geschlossen',
  'error.EXPR_BAD_ESCAPE.message':
    'auf „\\“ an Zeichen {column} muss „\'}\'“ oder „\\“ folgen',
  'error.EXPR_NUMBER_RANGE.message': 'die Zahl an Zeichen {column} ist zu groß',
  'error.EXPR_BAD_TOKEN.message': 'an Zeichenposition {column} steht ein überflüssiges Zeichen',
  'dialog.cancel': 'Abbrechen',
  'dialog.close': 'Schließen',
  'share.button': 'Teilen',
  'share.button.title': 'Einen Link kopieren, der dieses Diagramm öffnet',
  'share.disclosure.title': 'Einen Link zum Teilen erstellen?',
  'share.disclosure.body':
    'Der Link enthält dieses gesamte Diagramm samt aller Namen — wer ihn hat, kann das Diagramm öffnen und bearbeiten. Er wird nicht auf einen Server geladen, reist aber im Link selbst mit: Er bleibt damit in Ihrem Browserverlauf und ist für alle sichtbar, denen Sie ihn schicken.',
  'share.disclosure.confirm': 'Link erstellen',
  'share.tooLarge':
    'Dieses Diagramm ist für einen Link zum Teilen zu groß ({size}; die Grenze liegt bei {cap}). Nutzen Sie „Datei ▾ → Graph JSON“ und teilen Sie stattdessen die Datei.',
  'share.replacePrompt':
    'Das geteilte Diagramm öffnen? Ihr aktuelles Diagramm wird ersetzt. Exportieren Sie es vorher, wenn Sie es behalten möchten.',
  'share.noBase':
    'Für das Teilen ist keine öffentliche Adresse konfiguriert, daher lässt sich kein Link erstellen. Bitte melden Sie das.',
  'share.panel.label': 'Link zum Teilen',
  'share.panel.copied': 'Link in die Zwischenablage kopiert.',
  'share.panel.copyThis': 'Diesen Link kopieren:',
  'share.panel.copyAgain': 'Erneut kopieren',
  'share.panel.copy': 'Kopieren',
  'share.panel.close': 'Schließen',
  'pwa.text':
    'Eine neue Version von Loop Studio steht bereit. Beim Anwenden wird die App neu geladen und der aktuelle Lauf samt nicht gespeicherter Ergebnisse zurückgesetzt. Ihr Diagramm bleibt gespeichert.',
  'pwa.update': 'Aktualisieren',
  'pwa.dismiss': 'Später',
  'pwa.running.title': 'Ein Lauf läuft gerade',
  'pwa.running.body':
    'Das Anwenden der Aktualisierung lädt die Seite neu und beendet den aktuellen Lauf. Trotzdem anwenden?',
  'pwa.running.confirm': 'Anwenden und neu laden',
  'bootNotice.dismiss': 'Ausblenden',
  'autosave.failed.quota':
    'Das automatische Speichern hat aufgehört: Der Speicher dieses Browsers ist voll, Ihre letzten Änderungen werden auf diesem Gerät also nicht gesichert. Exportieren Sie eine Datei, um sie zu behalten.',
  'autosave.failed.unavailable':
    'Automatisches Speichern ist nicht verfügbar: Dieser Browser blockiert den Speicher, Änderungen werden auf diesem Gerät also nicht gesichert. Exportieren Sie eine Datei, um sie zu behalten.',
  'autosave.exportButton': 'Graph JSON exportieren',
  'bootNotice.proposalReboot':
    'In dieser Sitzung wurde ein Vorschlag bearbeitet. Der Stand, auf dem er beruht, ist auf diesem Gerät nicht gespeichert, daher wurde er als einfacher Graph wieder geöffnet — Ihre Änderungen bleiben erhalten. Importieren Sie die Vorschlagsdatei erneut, um sie zu prüfen oder neu zu exportieren.',
  'revChip.proposal': 'Vorschlag',
  'revChip.rev': 'Stand {id}',
  'revChip.title': 'Projekt {project} · {role} {revision}',
  'revChip.titleDirty':
    'Projekt {project} · {role} {revision} · nicht gespeicherte Änderungen seit diesem Stand',
  'revChip.unsaved': 'nicht gespeicherte Änderungen',
  'import.replace.title': 'Das aktuelle Diagramm ersetzen?',
  'import.replace.body': 'Die importierte Datei ersetzt, was gerade auf der Arbeitsfläche liegt.',
  'import.replace.confirm': 'Ersetzen',
  'import.readError': 'Diese Datei konnte nicht gelesen werden.',
  'import.error.invalidJson': 'Diese Datei ist kein gültiges JSON.',
  'import.error.unexpected': 'Unerwarteter Dateiinhalt.',
  'import.error.notLoopStudio': 'Das sieht nicht nach einer Loop-Studio-Graphdatei aus.',
  'import.error.missingNodesEdges': 'In der Graphdatei fehlen nodes oder edges.',
  'import.structuralWarning':
    'Dieser Graph hat strukturelle Probleme, und diese Verbindungen werden ignoriert:\n{detail}',
  'import.modelLayerUnreadable':
    'Der Inhalt der Modellebene dieser Datei ist nicht lesbar ({detail}); ihre Projektdaten wurden ignoriert.',
  'mobile.more.import': 'Datei importieren',
  'mobile.more.importSub': 'Graph oder Workspace JSON',
  'export.button': 'Exportieren ▾',
  'export.menuLabel': 'Exportieren',
  'export.graphJson.name': 'Graph JSON',
  'export.graphJson.blurb': 'das Diagramm + die empfohlenen Laufeinstellungen',
  'export.workspaceJson.name': 'Workspace JSON',
  'export.workspaceJson.blurb': 'Graph + Verteilung + Ansicht + laufender Lauf',
  'export.projectRevision.name': 'Projektstand',
  'export.projectRevision.blurb':
    'das Diagramm plus Projekt-ID und Herkunft, für Zusammenarbeit offline',
  'export.proposal.name': 'Vorschlag erstellen',
  'export.proposal.blurb': 'eine Kopie zum Bearbeiten und Zurückschicken',
  'export.proposal.needRevision': 'Exportieren Sie zuerst einen Projektstand',
  'revision.export.noSecureRandom':
    'Dieser Browser hat keine sichere Zufallsquelle, daher lässt sich keine Stand-ID erzeugen. Es wurde nichts exportiert.',
  'revision.export.tooLarge':
    'Dieses Diagramm ist zu groß, um es als Projektstand zu exportieren ({size}; Grenze {cap}). Nutzen Sie stattdessen „Datei ▾ → Graph JSON“.',
  'proposal.needProject':
    'Für einen Vorschlag muss ein Projekt geöffnet sein. Legen Sie zuerst über „Datei ▾ → Projektstand“ eines an.',
  'proposal.dirtyOrigin':
    'Das Dokument hat sich seit diesem Stand geändert. Halten Sie die Änderungen über „Datei ▾ → Projektstand“ fest und erstellen Sie dann einen Vorschlag.',
  'proposal.tooLarge':
    'Dieser Vorschlag ist zu groß, um ihn als eine Datei zu verschicken ({size}; Grenze {cap}). Ein einfaches Graph JSON geht weiterhin.',
  'export.author.name': 'Autor für Exporte festlegen…',
  'export.author.blurb': 'gerätelokale Angabe, ungeprüft, an die Datei geheftet',
  'export.projectRevision.disclosure.title': 'Einen Projektstand exportieren?',
  'export.projectRevision.disclosure.body':
    'Die Datei ist ein normales Graph JSON, das zusätzlich eine Projektidentität und die Herkunft dieses Stands mitführt, damit eine mitarbeitende Person Ihre Änderungen vollständig offline vergleichen und übernehmen kann. Kein Konto und kein Server — alles reist in der Datei mit.',
  'export.projectRevision.disclosure.confirm': 'Stand exportieren',
  'export.workspace.title': 'Diesen Arbeitsbereich speichern?',
  'export.workspace.included': 'Enthalten: {items}.',
  'export.workspace.excluded': 'Nicht enthalten: Rückgängig-Verlauf, Auswahl, Design.',
  'export.workspace.confirm': 'Arbeitsbereich speichern',
  'export.workspace.item.runConfig': 'die Laufkonfiguration',
  'export.workspace.item.distribution': 'die Verteilung über {runs} Läufe',
  'export.workspace.item.timeline': 'die Ansicht des Zeitverlaufs',
  'export.workspace.item.canvas': 'die Position der Arbeitsfläche',
  'export.workspace.item.liveRun': 'der laufende Lauf bei Schritt {step}',
  'export.workspace.omit.body':
    'Mit der Verteilung kommt das auf {full} — über der Grenze von {limit}. Ohne die Verteilung speichern ({lean})?',
  'export.workspace.omit.confirm': 'Ohne sie speichern',
  'export.workspace.reject':
    'Dieser Arbeitsbereich ist {size} groß — auch ohne die Verteilung über der Grenze von {limit}. Verkleinern Sie den Graphen oder nutzen Sie Graph JSON.',
  'author.title': 'Autor für Exporte',
  'author.name': 'Name',
  'author.namePlaceholder': 'zum Beispiel Alex',
  'author.note': 'Notiz (optional)',
  'author.notePlaceholder': 'eine kurze Nachricht, die mit der Datei mitreist',
  'author.disclosure':
    'Dieser Name wird nur auf diesem Gerät gespeichert. Er wird — ungeprüft — an jeden Projektstand und jeden Vorschlag geheftet, den Sie exportieren, und reist in der Datei mit, die Sie verschicken. Jede Person kann ihn ändern; behandeln Sie ihn als Angabe, nicht als Identität.',
  'author.save': 'Speichern',
  'mc.title': 'Monte Carlo',
  'mc.close': 'Schließen',
  'mc.closeKeepRunning': 'Schließen (weiterlaufen lassen)',
  'mc.field.runs': 'Läufe',
  'mc.field.steps': 'Schritte',
  'mc.field.baseSeed': 'Basis-Startwert',
  'mc.pools.head': 'verfolgte Speicher',
  'mc.pools.headAll': 'verfolgt · alle Speicher',
  'mc.pools.headSome': 'verfolgt · {n} von {total}',
  'mc.pools.selectAll': 'Alle auswählen',
  'mc.pools.none': 'Keine Speicher im Graphen — fügen Sie einen hinzu, um auszuführen.',
  'mc.pools.group': 'Verfolgte Speicher',
  'mc.pools.keepOne': 'Mindestens ein Speicher muss verfolgt bleiben.',
  'mc.cost.estimating': 'wird geschätzt…',
  'mc.cost.measured': 'Gemessen (letzter Lauf)',
  'mc.cost.benchmark': 'Lokaler Vergleichswert',
  'mc.cost.execution': 'Ausführung',
  'mc.cost.parallel': 'Parallel, {workers} Prozesse',
  'mc.cost.localPause': 'Lokal · kann kurz stocken',
  'mc.cost.local': 'Lokal',
  'mc.cost.memory': 'Arbeitsspeicher',
  'mc.cost.overLimit': ' — über der Grenze, Läufe oder Schritte verringern',
  'mc.run': '{runs} Läufe starten',
  'mc.cancel': 'Abbrechen',
  'review.title': 'Vorschlag prüfen',
  'review.close': 'Schließen',
  'review.byPrefix': 'Vorgeschlagen von',
  'review.byAnon': 'Vorschlag',
  'review.unverified': '· ungeprüft',
  'review.fileSays': 'die Datei sagt: {stamp}',
  'review.differentProject': 'Andere Projekt-ID als die des geöffneten Projekts.',
  'review.diff.none': 'Keine Änderungen am Graphen.',
  'review.diff.nodes': 'Knoten',
  'review.diff.edges': 'Verbindungen',
  'review.diff.runConfig': 'Laufkonfiguration',
  'review.diff.frames': 'Rahmen',
  'review.gate.wrongProject':
    'Dieser Vorschlag gehört zu einem anderen Projekt. Sie können ihn trotzdem als Dokument öffnen.',
  'review.gate.noTarget':
    'Es ist kein Projekt geöffnet. Öffnen Sie diesen Vorschlag als Dokument oder brechen Sie ab.',
  'review.gate.targetIsProposal':
    'Sie haben gerade einen Vorschlag geöffnet. Exportieren Sie ihn als Projektstand, bevor Sie einen weiteren Vorschlag darauf anwenden.',
  'review.gate.versionMismatch':
    'Dieser Vorschlag und das geöffnete Dokument haben unterschiedliche Modellversionen (v1 / v2). Er lässt sich hier nicht anwenden. Sie können ihn trotzdem als Dokument öffnen.',
  'review.class.exact':
    'Ihr geöffneter Stand ist genau der Stand, auf dem dieser Vorschlag beruht.',
  'review.class.divergent':
    'Ihr geöffneter Stand enthält Änderungen, die sich mit diesem Vorschlag überschneiden. Den ganzen Vorschlag anzuwenden verwirft sie.',
  'review.class.unknown':
    'Ihr geöffneter Stand enthält Änderungen, und aus den Dateien lässt sich ihr Verhältnis nicht belegen. Es wurden keine Feldkonflikte gefunden.',
  'review.confirm.default':
    'Dieser Vorschlag beruht auf einem früheren Stand. Den ganzen Vorschlag anzuwenden ersetzt Ihren Graphen durch dessen Fassung — Ihre Änderungen seitdem gehen verloren. Ein Rückgängig nimmt es zurück.',
  'review.confirm.unknown':
    'Dieser Vorschlag beruht auf einem früheren Stand, und ihr Verhältnis lässt sich aus den Dateien nicht bestimmen. Den ganzen Vorschlag anzuwenden ersetzt Ihren Graphen durch dessen Fassung — Ihre Änderungen seitdem gehen verloren. Ein Rückgängig nimmt es zurück.',
  'review.err.targetMoved':
    'Das Dokument hat sich seit Ihrer Bestätigung geändert — prüfen Sie die Änderung und wenden Sie erneut an.',
  'review.err.targetMovedList':
    'Das Dokument hat sich während Ihrer Auswahl geändert — die Liste unten ist aktualisiert. Prüfen Sie sie und wenden Sie erneut an.',
  'review.err.noEffect': 'Diese Auswahl ändert nichts — es gibt nichts anzuwenden.',
  'review.err.generic': 'Anwenden nicht möglich ({reason}).',
  'review.fail.wrongProject': 'Dieser Vorschlag gehört zu einem anderen Projekt.',
  'review.fail.noTarget': 'Es ist kein Projekt geöffnet, auf das sich anwenden ließe.',
  'review.fail.targetIsProposal':
    'Exportieren Sie den geöffneten Vorschlag zuerst als Projektstand.',
  'review.fail.versionMismatch':
    'Dieser Vorschlag und das geöffnete Dokument haben unterschiedliche Modellversionen (v1 / v2), daher lässt er sich hier nicht anwenden.',
  'review.fail.payloadInvalid':
    'Diese Vorschlagsdatei hat die Integritätsprüfung nicht bestanden — importieren Sie sie erneut.',
  'review.fail.invalidSelection':
    'Diese Auswahl lässt sich nicht anwenden — eine übernommene Verbindung braucht einen Knoten, den Sie nicht einbezogen haben. Passen Sie die Auswahl an und versuchen Sie es erneut.',
  'review.hunks.none': 'Nichts Neues anzuwenden — das Ziel stimmt bereits überein.',
  'review.hunk.add': 'Hinzufügen',
  'review.hunk.remove': 'Entfernen',
  'review.hunk.change': 'Ändern',
  'review.hunk.bothChanged': ' · beide Seiten haben das geändert',
  'review.hunk.youDeleted': ' · Sie haben das gelöscht',
  'review.hunk.alsoRemove': 'Verbindung ebenfalls entfernen oder umhängen',
  'review.hunk.cantRemove': 'Entfernen nicht möglich — Ihre Seite hat eine Verbindung ergänzt',
  'review.hunk.toThisNode': 'zu diesem Knoten',
  'review.hunk.framesTitle': 'Gespeicherte Rahmen',
  'review.hunk.framesTake': 'Die Rahmen des Vorschlags übernehmen ({yours} → {theirs})',
  'review.hunk.framesClear': 'Die Rahmen des Vorschlags übernehmen (alle {yours} löschen)',
  'review.field.base': 'Ausgangswert',
  'review.field.yours': 'Ihr Wert',
  'review.field.theirs': 'deren Wert',
  'review.field.takeTheirs': 'deren Wert übernehmen',
  'review.field.keepMine': 'meinen Wert behalten',
  'review.action.applyAnyway': 'Trotzdem anwenden',
  'review.action.applyProposal': 'Vorschlag anwenden',
  'review.action.applySelected': '{count} ausgewählte anwenden',
  'review.action.chooseChanges': 'Änderungen auswählen',
  'review.action.wholeProposal': 'Ganzer Vorschlag',
  'review.action.openAsDoc': 'Als Dokument öffnen',
  'review.action.cancel': 'Abbrechen',
  'review.foot.hunks':
    'Das Ziel plus die von Ihnen gewählten Änderungen anzuwenden erzeugt einen neuen lokalen Stand (übergeordnet {parent}); ein Rückgängig nimmt es zurück. Es wird nichts in eine Datei geschrieben.',
  'review.foot.whole':
    'Anwenden erzeugt einen neuen lokalen Stand (übergeordnet {parent}); ein Rückgängig nimmt es zurück. Es wird nichts in eine Datei geschrieben.',
  'dist.runs': 'Läufe',
  'dist.steps': 'Schritte',
  'dist.seed': 'Startwert',
  'dist.ended': 'Beendet',
  'dist.stale': 'veraltet — der Graph hat sich geändert; für eine Aktualisierung neu ausführen',
  'dist.export.staleTitle': 'Ergebnis ist veraltet — für den Export neu ausführen',
  'dist.export.title': 'Diesen Lauf exportieren',
  'dist.export.seriesCsv': 'Reihen-CSV',
  'dist.export.seriesCsv.blurb': 'p10/p50/p90/Mittel/Min/Max je Schritt',
  'dist.export.runsCsv': 'Läufe-CSV',
  'dist.export.runsCsv.blurb': 'Endwert je Lauf · Lauf, Startwert, Speicher',
  'dist.export.summaryCsv': 'Übersichts-CSV',
  'dist.export.summaryCsv.blurb': 'Übersicht der Endwerte je Speicher',
  'dist.export.json.blurb': 'vollständiges MonteCarloResult',
  'term.title': 'Abbruch',
  'term.ended': 'beendet',
  'term.noRuns': 'Kein Lauf wurde beendet',
  'band.pool': 'Speicher',
  'band.mean': 'Mittel',
  'openhint.title': 'Keine Kontosynchronisierung',
  'openhint.body':
    'Öffnen Sie eine gespeicherte Datei oder einen Link zum Teilen, um sie hier anzusehen.',
  'openhint.button': 'Eine Datei öffnen',
  'openhint.sub':
    'Exportieren Sie am Rechner Graph JSON oder Workspace JSON, oder öffnen Sie einen #g1=-Link zum Teilen.',
  'tour.welcome.title': 'Willkommen bei Loop Studio',
  'tour.welcome.body':
    'Eine kurze Tour von zwei Minuten durch die sechs Teile des Arbeitsbereichs?',
  'tour.welcome.start': 'Tour starten',
  'tour.welcome.skip': 'Überspringen',
  'tour.nav.back': 'Zurück',
  'tour.nav.next': 'Weiter',
  'tour.nav.done': 'Fertig',
  'tour.nav.position': '{n} / {total}',
  'tour.nav.close': 'Die Tour schließen',
  'tour.desktop.pieces.title': 'Bausteine',
  'tour.desktop.pieces.body':
    'Die Bausteine — Speicher, Quelle, Senke, Verteiler und die übrigen. Einen anklicken oder auf die Arbeitsfläche ziehen, um ihn hinzuzufügen.',
  'tour.desktop.canvas.title': 'Arbeitsfläche',
  'tour.desktop.canvas.body':
    'Hier Bausteine platzieren, sie von Verbindungspunkt zu Verbindungspunkt verbinden und durch Verschieben oder Zoomen navigieren.',
  'tour.desktop.inspector.title': 'Eigenschaften',
  'tour.desktop.inspector.body':
    'Einen Baustein oder eine Verbindung auswählen, um hier die Einstellungen zu bearbeiten.',
  'tour.desktop.playback.title': 'Wiedergabe',
  'tour.desktop.playback.body':
    'Das Modell Schritt für Schritt oder durchgehend ausführen. Ein fester Startwert macht einen zufälligen Lauf wiederholbar.',
  'tour.desktop.timeline.title': 'Zeitverlauf',
  'tour.desktop.timeline.body':
    'Verfolgen, wie sich Speicherwerte und Laufergebnisse über die Zeit ändern.',
  'tour.desktop.files.title': 'Dateien und Teilen',
  'tour.desktop.files.body':
    'Mit einer Vorlage beginnen, eine Datei importieren, einen Link zum Teilen kopieren oder den Graphen bzw. den Arbeitsbereich exportieren.',
  'tour.mobile.open.title': 'Einen Graphen öffnen',
  'tour.mobile.open.body':
    'Einen geteilten Graphen öffnen — über einen #g1=-Link oder durch Importieren einer Datei aus dem Menü „Mehr“.',
  'tour.mobile.canvas.title': 'Navigieren',
  'tour.mobile.canvas.body':
    'Ziehen zum Verschieben, Aufziehen zum Zoomen. „Einpassen“ zentriert das Diagramm neu.',
  'tour.mobile.inspect.title': 'Ansehen',
  'tour.mobile.inspect.body':
    'Auf einen Knoten oder eine Verbindung tippen, um die Konfiguration zu lesen. Bearbeitet wird nur am Rechner.',
  'tour.mobile.run.title': 'Ausführen',
  'tour.mobile.run.body':
    'Das Modell Schritt für Schritt durchgehen oder mit „Abspielen“ starten.',
  'tour.mobile.timeline.title': 'Zeitverlauf',
  'tour.mobile.timeline.body':
    'Den Bereich „Zeitverlauf“ öffnen, um die Werte über die Zeit zu sehen.',
  'tour.mobile.more.title': 'Mehr',
  'tour.mobile.more.body':
    'Teilen, Exportieren und die Sprachauswahl liegen alle in diesem Menü.',
  'tour.help.menuLabel': 'Hilfe',
  'tour.help.takeTour': 'Eine Tour machen',
  'tour.help.about': 'Über Loop Studio',
  'tour.help.feedback': 'Rückmeldung senden (englisches Formular)',
  'tour.help.feedbackAria':
    'Rückmeldung senden (englisches Formular) — öffnet sich in einem neuen Tab',
  'about.createdBy': 'Erstellt von',
  'about.repo': 'GitHub-Repository',
  'about.repoAria': 'GitHub-Repository von Loop Studio',
  'about.notAffiliated':
    'Loop Studio ist ein unabhängiges Projekt und steht weder in Verbindung mit Machinations.io noch wird es von dort unterstützt.',
  'hint.close': 'Diesen Hinweis ausblenden',
  'hint.emptyCanvas.body':
    'Mit einer Vorlage beginnen oder Knotenarten aus der linken Leiste hereinziehen.',
  'hint.mc.body':
    'Monte Carlo führt das Modell viele Male aus und zeigt eine Streuung von Ergebnissen, keine einzelne Vorhersage.',
  'hint.review.body':
    'Einen Vorschlag zu prüfen ändert nie Ihr geöffnetes Projekt — nichts bewegt sich, bis Sie ihn anwenden.',
  'hint.importFirstCommit.body':
    '{n, plural, one {# Parameter} other {# Parameter}} aus {tables} hinzugefügt. Ihre Werte stehen im Bereich „Eingaben“. Um einen davon in einem berechneten Wert zu verwenden, tippen Sie @ in dessen Ausdruck und wählen den Namen; das Flussfeld einer Verbindung und ein Aktivator bieten dieselbe Auswahl.',
  'help.contextual.hint.import.name': 'Import aus einem Tabellenblatt',
  'help.contextual.hint.import.desc':
    'Wird einmal gezeigt, direkt nachdem der erste Import aus einem Tabellenblatt auf der Arbeitsfläche gelandet ist.',
  'hint.frameMove.body':
    'Den Rand eines Rahmens ziehen, um ihn mit allem darin zu bewegen. Alt gedrückt halten, um nur den Rahmen zu bewegen.',
  'help.contextual.hint.frameMove.name': 'Rahmen bewegen',
  'help.contextual.hint.frameMove.desc':
    'Wird einmal gezeigt, wenn zum ersten Mal ein Gruppenrahmen auf einer bearbeitbaren Arbeitsfläche ausgewählt wird.',
  'hint.focusFilter.body':
    'Wird der Graph unübersichtlich? „Fokus“ dimmt alles außer der Nachbarschaft eines Knotens; „Filter“ blendet Knoten- oder Verbindungstypen aus.',
  'help.contextual.menuLabel': 'Kontexthilfe',
  'help.contextual.title': 'Kontexthilfe',
  'help.contextual.intro':
    'Loop Studio zeigt ein paar kurze Hinweise, wenn die jeweilige Situation zum ersten Mal auftritt. Setzen Sie einen zurück, um ihn beim nächsten passenden Mal wiederzusehen.',
  'help.contextual.rearm': 'Beim nächsten Mal wieder zeigen',
  'help.contextual.rearmWaiting': 'Wartet auf die nächste Anzeige',
  'help.contextual.rearmWaitingHint':
    'Er erscheint von selbst wieder, sobald die Situation das nächste Mal passt.',
  'help.contextual.hint.emptyCanvas.name': 'Leere Arbeitsfläche',
  'help.contextual.hint.emptyCanvas.desc':
    'Wird auf einer leeren Arbeitsfläche gezeigt, bevor ein Knoten existiert.',
  'help.contextual.hint.mc.name': 'Monte Carlo',
  'help.contextual.hint.mc.desc':
    'Wird gezeigt, wenn das Monte-Carlo-Fenster zum ersten Mal geöffnet wird.',
  'help.contextual.hint.review.name': 'Prüfen',
  'help.contextual.hint.review.desc':
    'Wird gezeigt, wenn zum ersten Mal ein geteilter Vorschlag zur Prüfung geöffnet wird.',
  'help.contextual.hint.focusFilter.name': 'Fokus / Filter',
  'help.contextual.hint.focusFilter.desc':
    'Wird gezeigt, sobald ein Graph groß genug ist, dass Fokus und Filter helfen.',
} satisfies Record<UiKey, string>

export default ui
