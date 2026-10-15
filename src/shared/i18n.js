'use strict';

/**
 * Interface language.
 *
 * Two separate things travel under "language" in this app, and they have very
 * different costs:
 *
 *   1. The COACHING TIPS. Written by the model, so any language is native
 *      quality and costs nothing but a line in the prompt. Every language in
 *      LANGUAGES is supported for tips, no catalogue entry required.
 *   2. The UI STRINGS below. Hand written per language, so a language only gets
 *      translated chrome once its catalogue exists. A missing key falls back to
 *      English rather than showing a blank or a raw key, because an English
 *      label is a small blemish and an empty button is a broken app.
 *
 * That asymmetry is deliberate. A German player gets German coaching the day
 * their language is added to LANGUAGES, and German chrome whenever the
 * catalogue catches up.
 *
 * Adding a language: add it to LANGUAGES (tips work immediately), then add a
 * key block to STRINGS for the interface.
 */

// `name` is what the player picks in Settings, in their own language.
// `prompt` is the name the model is told to write in, in English, because the
// prompt itself is English and a model follows "write in German" far more
// reliably than "write in Deutsch".
const LANGUAGES = [
  { code: 'en',    name: 'English',    prompt: 'English' },
  { code: 'de',    name: 'Deutsch',    prompt: 'German' },
  { code: 'es',    name: 'Español',    prompt: 'Spanish' },
  { code: 'pt-BR', name: 'Português',  prompt: 'Brazilian Portuguese' },
  { code: 'fr',    name: 'Français',   prompt: 'French' },
  { code: 'tr',    name: 'Türkçe',     prompt: 'Turkish' },
  { code: 'ru',    name: 'Русский',    prompt: 'Russian' },
  { code: 'pl',    name: 'Polski',     prompt: 'Polish' },
  { code: 'ja',    name: '日本語',      prompt: 'Japanese' },
  { code: 'ko',    name: '한국어',      prompt: 'Korean' },
];

const DEFAULT_LANG = 'en';

/**
 * UI strings, keyed by a dotted id used in markup as data-i18n="panel.start".
 * English is the source of truth and the fallback for every other language.
 */
const STRINGS = {
  en: {
    'common.settings': 'Settings',
    'common.quit': 'Quit',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.done': 'Done',
    'common.on': 'On',
    'common.off': 'Off',
    'common.language': 'Language',
    'common.save': 'Save',
    'settings.performance': 'Performance',
    'settings.game': 'Game',
    'common.languageSaved': 'Language saved.',
    'common.languageHint': 'Your reviews and the app appear in this language.',

    'panel.start': 'Start',
    'panel.stop': 'Stop',
    'panel.pause': 'Pause',
    'panel.resume': 'Resume',
    // The top strip's notice line while recording is paused (shell.js
    // noticeLine). It says what the status word "Paused" over the record
    // card's buttons said until 8.2.1, and the line under them until 8.3.
    'panel.pausedLine': 'Paused. Nothing is read until you resume.',
    'panel.tips': 'tips',
    'panel.stats': 'Stats',
    'panel.history': 'Matches',
    'panel.askCoach': 'Ask Coach',
    'panel.vodReview': 'AI log: every frame the coach read',

    'settings.title': 'Settings',
    'settings.tipFrequency': 'Capture speed',
    'settings.riotId': 'Riot ID',
    'settings.showTips': 'Show tips',
    'settings.tipStyle': 'Tip style',
    'settings.voice': 'Voice coach',
    'settings.connect': 'Connect',
    'settings.manageSub': 'Manage subscription',
    'settings.logOut': 'Log out',
    'settings.minimal': 'Minimal',
    'settings.max': 'Max',
    'settings.default': 'Default',

    'onboarding.welcome': 'Welcome to Occlara',
    'onboarding.chooseLanguage': 'Choose your language',
    'onboarding.getStarted': 'Get started',
    'onboarding.finish': 'Start recording',

    'overlay.coach': 'Coach',
    'overlay.deathReview': 'Death Review',

    // Ask Coach (8.5.0, renderer/chat): {name} is filled in by the page.
    'chat.lead': 'Ask about a round, a death or your agent.',
    'chat.placeholder': 'Ask your coach anything',
    'chat.send': 'Send',
    'chat.matchLabel': 'The match you are asking about',
    'chat.noMatch': 'No match, general questions',
    'chat.won': 'won',
    'chat.lost': 'lost',
    'chat.drew': 'drew',
    'chat.to': 'to',
    'chat.win': 'win',
    'chat.loss': 'loss',
    'chat.draw': 'draw',
    'chat.match': 'match',
    'chat.divider': 'Now about your {match}',
    'chat.dividerNone': 'Now general questions, about no match',
    'chat.walk': 'Walk me through round {n}',
    'chat.change': 'What should I change on {agent}?',
    'chat.losing': 'Where am I losing rounds?',
    'chat.kit': "How should I use my agent's kit?",
    'chat.save': 'When should my team save?',
    'chat.sheriff': 'How do I win more duels with a Sheriff?',
    'chat.workOn': 'What should I work on first?',
    'chat.openRecorded': 'Go through my {match} match with me. What was my most costly mistake, and what should I work on first?',
    'chat.openRiot': "Go through my {map} match with me. What does Riot's record show, and where would you start?",
    'chat.held': "This match may still be going on. Ask Coach can talk about it once Riot's record has it, or in 90 minutes.",
    'chat.cap': "You've used today's questions. Ask Coach is back at {time}.",
    'chat.capTomorrow': "You've used today's questions. Ask Coach is back tomorrow.",
    'chat.which': '{count} of your last ten matches are on {map}. Which one do you mean? Pick it from the match list above.',
    'chat.noneOnMap': 'None of your last ten matches is on {map}. Pick a match from the list above, or ask about this one.',
    'chat.failed': 'Could not reach your coach right now. Try again in a moment.',
    'chat.midMatch': 'A match is in progress. Ask Coach is back once it ends.',
    'chat.honest': "I couldn't give you an answer I can stand behind for that one. Ask me about a round, a death or your agent in this match.",
  },

  de: {
    'common.settings': 'Einstellungen',
    'common.quit': 'Beenden',
    'common.close': 'Schließen',
    'common.back': 'Zurück',
    'common.next': 'Weiter',
    'common.done': 'Fertig',
    'common.on': 'An',
    'common.off': 'Aus',
    'common.language': 'Sprache',
    'common.save': 'Speichern',
    'settings.performance': 'Leistung',
    'settings.game': 'Spiel',
    'common.languageSaved': 'Sprache gespeichert.',
    'common.languageHint': 'Deine Reviews und die App erscheinen in dieser Sprache.',

    'panel.start': 'Starten',
    'panel.stop': 'Stoppen',
    'panel.pause': 'Pause',
    'panel.resume': 'Fortsetzen',
    'panel.pausedLine': 'Pausiert. Bis du fortsetzt, wird nichts gelesen.',
    'panel.tips': 'Tipps',
    'panel.stats': 'Statistiken',
    'panel.history': 'Matches',
    'panel.askCoach': 'Coach fragen',

    'settings.title': 'Einstellungen',
    'settings.tipFrequency': 'Aufnahmetempo',
    'settings.riotId': 'Riot-ID',
    'settings.showTips': 'Tipps anzeigen',
    'settings.tipStyle': 'Tipp-Stil',
    'settings.voice': 'Sprach-Coach',
    'settings.connect': 'Verbinden',
    'settings.manageSub': 'Abo verwalten',
    'settings.logOut': 'Abmelden',
    'settings.minimal': 'Minimal',
    'settings.max': 'Max',
    'settings.default': 'Standard',

    'onboarding.welcome': 'Willkommen bei Occlara',
    'onboarding.chooseLanguage': 'Wähle deine Sprache',
    'onboarding.getStarted': 'Loslegen',
    'onboarding.finish': 'Aufnahme starten',

    'overlay.coach': 'Coach',
    'overlay.deathReview': 'Todesanalyse',

    'chat.lead': 'Frag nach einer Runde, einem Tod oder deinem Agenten.',
    'chat.placeholder': 'Frag deinen Coach',
    'chat.send': 'Senden',
    'chat.matchLabel': 'Das Match, nach dem du fragst',
    'chat.noMatch': 'Kein Match, allgemeine Fragen',
    'chat.won': 'gewonnen',
    'chat.lost': 'verloren',
    'chat.drew': 'unentschieden',
    'chat.to': 'zu',
    'chat.win': 'Sieg',
    'chat.loss': 'Niederlage',
    'chat.draw': 'Unentschieden',
    'chat.match': 'Match',
    'chat.divider': 'Jetzt geht es um {match}',
    'chat.dividerNone': 'Jetzt allgemeine Fragen, ohne Match',
    'chat.walk': 'Geh mit mir Runde {n} durch',
    'chat.change': 'Was sollte ich mit {agent} ändern?',
    'chat.losing': 'Wo verliere ich Runden?',
    'chat.kit': 'Wie setze ich das Kit meines Agenten ein?',
    'chat.save': 'Wann sollte mein Team sparen?',
    'chat.sheriff': 'Wie gewinne ich mehr Duelle mit dem Sheriff?',
    'chat.workOn': 'Woran sollte ich zuerst arbeiten?',
    'chat.openRecorded': 'Geh mein Match {match} mit mir durch. Was war mein teuerster Fehler, und woran sollte ich zuerst arbeiten?',
    'chat.openRiot': 'Geh mein Match auf {map} mit mir durch. Was zeigt Riots Aufzeichnung, und wo würdest du anfangen?',
    'chat.held': 'Dieses Match läuft vielleicht noch. Dein Coach kann darüber sprechen, sobald Riots Aufzeichnung es hat, oder in 90 Minuten.',
    'chat.cap': 'Deine Fragen für heute sind aufgebraucht. Dein Coach ist um {time} wieder da.',
    'chat.capTomorrow': 'Deine Fragen für heute sind aufgebraucht. Dein Coach ist morgen wieder da.',
    'chat.which': '{count} deiner letzten zehn Matches waren auf {map}. Welches meinst du? Wähle es oben in der Matchliste.',
    'chat.noneOnMap': 'Keins deiner letzten zehn Matches war auf {map}. Wähle oben ein Match, oder frag nach diesem.',
    'chat.failed': 'Dein Coach ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
    'chat.midMatch': 'Ein Match läuft. Dein Coach ist wieder da, sobald es vorbei ist.',
    'chat.honest': 'Darauf konnte ich dir keine Antwort geben, hinter der ich stehen kann. Frag mich nach einer Runde, einem Tod oder deinem Agenten in diesem Match.',
  },

  es: {
    'common.settings': 'Ajustes',
    'common.quit': 'Salir',
    'common.close': 'Cerrar',
    'common.back': 'Atrás',
    'common.next': 'Siguiente',
    'common.done': 'Listo',
    'common.on': 'Sí',
    'common.off': 'No',
    'common.language': 'Idioma',
    'common.save': 'Guardar',
    'settings.performance': 'Rendimiento',
    'settings.game': 'Juego',
    'common.languageSaved': 'Idioma guardado.',
    'common.languageHint': 'Tus revisiones y la app aparecen en este idioma.',

    'panel.start': 'Iniciar',
    'panel.stop': 'Detener',
    'panel.pause': 'Pausar',
    'panel.resume': 'Reanudar',
    'panel.pausedLine': 'En pausa. No se lee nada hasta que reanudes.',
    'panel.tips': 'consejos',
    'panel.stats': 'Estadísticas',
    'panel.history': 'Partidas',
    'panel.askCoach': 'Preguntar al coach',

    'settings.title': 'Ajustes',
    'settings.tipFrequency': 'Velocidad de captura',
    'settings.riotId': 'Riot ID',
    'settings.showTips': 'Mostrar consejos',
    'settings.tipStyle': 'Estilo de consejo',
    'settings.voice': 'Coach por voz',
    'settings.connect': 'Conectar',
    'settings.manageSub': 'Gestionar suscripción',
    'settings.logOut': 'Cerrar sesión',
    'settings.minimal': 'Mínimo',
    'settings.max': 'Máx',
    'settings.default': 'Predeterminado',

    'onboarding.welcome': 'Bienvenido a Occlara',
    'onboarding.chooseLanguage': 'Elige tu idioma',
    'onboarding.getStarted': 'Empezar',
    'onboarding.finish': 'Empezar a grabar',

    'overlay.coach': 'Coach',
    'overlay.deathReview': 'Análisis de muerte',

    'chat.lead': 'Pregunta por una ronda, una muerte o tu agente.',
    'chat.placeholder': 'Pregúntale a tu coach',
    'chat.send': 'Enviar',
    'chat.matchLabel': 'La partida sobre la que preguntas',
    'chat.noMatch': 'Sin partida, preguntas generales',
    'chat.won': 'ganada',
    'chat.lost': 'perdida',
    'chat.drew': 'empatada',
    'chat.to': 'a',
    'chat.win': 'victoria',
    'chat.loss': 'derrota',
    'chat.draw': 'empate',
    'chat.match': 'partida',
    'chat.divider': 'Ahora sobre: {match}',
    'chat.dividerNone': 'Ahora preguntas generales, sin partida',
    'chat.walk': 'Explícame la ronda {n}',
    'chat.change': '¿Qué debería cambiar con {agent}?',
    'chat.losing': '¿Dónde estoy perdiendo rondas?',
    'chat.kit': '¿Cómo debería usar el kit de mi agente?',
    'chat.save': '¿Cuándo debería ahorrar mi equipo?',
    'chat.sheriff': '¿Cómo gano más duelos con el Sheriff?',
    'chat.workOn': '¿En qué debería trabajar primero?',
    'chat.openRecorded': 'Repasa conmigo mi partida {match}. ¿Cuál fue mi error más caro y en qué debería trabajar primero?',
    'chat.openRiot': 'Repasa conmigo mi partida en {map}. ¿Qué muestra el registro de Riot y por dónde empezarías?',
    'chat.held': 'Puede que esta partida siga en juego. El coach podrá hablar de ella cuando el registro de Riot la tenga, o dentro de 90 minutos.',
    'chat.cap': 'Has usado las preguntas de hoy. El coach vuelve a las {time}.',
    'chat.capTomorrow': 'Has usado las preguntas de hoy. El coach vuelve mañana.',
    'chat.which': '{count} de tus diez últimas partidas fueron en {map}. ¿Cuál quieres decir? Elígela en la lista de partidas de arriba.',
    'chat.noneOnMap': 'Ninguna de tus diez últimas partidas fue en {map}. Elige una partida de la lista de arriba, o pregunta por esta.',
    'chat.failed': 'No se pudo contactar con tu coach ahora mismo. Inténtalo de nuevo en un momento.',
    'chat.midMatch': 'Hay una partida en curso. El coach vuelve cuando termine.',
    'chat.honest': 'No pude darte una respuesta que pueda respaldar. Pregúntame por una ronda, una muerte o tu agente en esta partida.',
  },

  'pt-BR': {
    'common.settings': 'Configurações',
    'common.quit': 'Sair',
    'common.close': 'Fechar',
    'common.back': 'Voltar',
    'common.next': 'Avançar',
    'common.done': 'Pronto',
    'common.on': 'Sim',
    'common.off': 'Não',
    'common.language': 'Idioma',
    'common.save': 'Salvar',
    'settings.performance': 'Desempenho',
    'settings.game': 'Jogo',
    'common.languageSaved': 'Idioma salvo.',
    'common.languageHint': 'Suas análises e o app aparecem neste idioma.',

    'panel.start': 'Iniciar',
    'panel.stop': 'Parar',
    'panel.pause': 'Pausar',
    'panel.resume': 'Retomar',
    'panel.pausedLine': 'Pausado. Nada é lido até você retomar.',
    'panel.tips': 'dicas',
    'panel.stats': 'Estatísticas',
    'panel.history': 'Partidas',
    'panel.askCoach': 'Perguntar ao coach',

    'settings.title': 'Configurações',
    'settings.tipFrequency': 'Velocidade de captura',
    'settings.riotId': 'Riot ID',
    'settings.showTips': 'Mostrar dicas',
    'settings.tipStyle': 'Estilo da dica',
    'settings.voice': 'Coach por voz',
    'settings.connect': 'Conectar',
    'settings.manageSub': 'Gerenciar assinatura',
    'settings.logOut': 'Sair da conta',
    'settings.minimal': 'Mínimo',
    'settings.max': 'Máx',
    'settings.default': 'Padrão',

    'onboarding.welcome': 'Bem-vindo ao Occlara',
    'onboarding.chooseLanguage': 'Escolha seu idioma',
    'onboarding.getStarted': 'Começar',
    'onboarding.finish': 'Começar a gravar',

    'overlay.coach': 'Coach',
    'overlay.deathReview': 'Análise da morte',

    'chat.lead': 'Pergunte sobre uma rodada, uma morte ou o seu agente.',
    'chat.placeholder': 'Pergunte ao seu coach',
    'chat.send': 'Enviar',
    'chat.matchLabel': 'A partida sobre a qual você está perguntando',
    'chat.noMatch': 'Nenhuma partida, perguntas gerais',
    'chat.won': 'vencida',
    'chat.lost': 'perdida',
    'chat.drew': 'empatada',
    'chat.to': 'a',
    'chat.win': 'vitória',
    'chat.loss': 'derrota',
    'chat.draw': 'empate',
    'chat.match': 'partida',
    'chat.divider': 'Agora sobre: {match}',
    'chat.dividerNone': 'Agora perguntas gerais, sem partida',
    'chat.walk': 'Me explique a rodada {n}',
    'chat.change': 'O que eu deveria mudar com {agent}?',
    'chat.losing': 'Onde estou perdendo rodadas?',
    'chat.kit': 'Como devo usar o kit do meu agente?',
    'chat.save': 'Quando meu time deve economizar?',
    'chat.sheriff': 'Como ganho mais duelos com a Sheriff?',
    'chat.workOn': 'No que devo trabalhar primeiro?',
    'chat.openRecorded': 'Repasse comigo a minha partida {match}. Qual foi o meu erro mais caro, e no que devo trabalhar primeiro?',
    'chat.openRiot': 'Repasse comigo a minha partida em {map}. O que o registro da Riot mostra, e por onde você começaria?',
    'chat.held': 'Esta partida pode ainda estar em andamento. O coach pode falar dela quando o registro da Riot a tiver, ou em 90 minutos.',
    'chat.cap': 'Você usou as perguntas de hoje. O coach volta às {time}.',
    'chat.capTomorrow': 'Você usou as perguntas de hoje. O coach volta amanhã.',
    'chat.which': '{count} das suas últimas dez partidas foram em {map}. Qual delas você quer dizer? Escolha na lista de partidas acima.',
    'chat.noneOnMap': 'Nenhuma das suas últimas dez partidas foi em {map}. Escolha uma partida na lista acima, ou pergunte sobre esta.',
    'chat.failed': 'Não foi possível falar com o seu coach agora. Tente de novo em instantes.',
    'chat.midMatch': 'Há uma partida em andamento. O coach volta quando ela terminar.',
    'chat.honest': 'Não consegui te dar uma resposta da qual eu tenha certeza. Pergunte sobre uma rodada, uma morte ou o seu agente nesta partida.',
  },

  fr: {
    'common.settings': 'Paramètres',
    'common.quit': 'Quitter',
    'common.close': 'Fermer',
    'common.back': 'Retour',
    'common.next': 'Suivant',
    'common.done': 'Terminé',
    'common.on': 'Oui',
    'common.off': 'Non',
    'common.language': 'Langue',
    'common.save': 'Enregistrer',
    'settings.performance': 'Performances',
    'settings.game': 'Jeu',
    'common.languageSaved': 'Langue enregistrée.',
    'common.languageHint': 'Tes analyses et l\'app apparaissent dans cette langue.',

    'panel.start': 'Démarrer',
    'panel.stop': 'Arrêter',
    'panel.pause': 'Pause',
    'panel.resume': 'Reprendre',
    'panel.pausedLine': 'En pause. Rien n\'est lu tant que tu ne reprends pas.',
    'panel.tips': 'conseils',
    'panel.stats': 'Statistiques',
    'panel.history': 'Matchs',
    'panel.askCoach': 'Demander au coach',

    'settings.title': 'Paramètres',
    'settings.tipFrequency': 'Vitesse de capture',
    'settings.riotId': 'Riot ID',
    'settings.showTips': 'Afficher les conseils',
    'settings.tipStyle': 'Style des conseils',
    'settings.voice': 'Coach vocal',
    'settings.connect': 'Connecter',
    'settings.manageSub': 'Gérer l’abonnement',
    'settings.logOut': 'Se déconnecter',
    'settings.minimal': 'Minimal',
    'settings.max': 'Max',
    'settings.default': 'Par défaut',

    'onboarding.welcome': 'Bienvenue sur Occlara',
    'onboarding.chooseLanguage': 'Choisis ta langue',
    'onboarding.getStarted': 'Commencer',
    'onboarding.finish': 'Commencer',

    'overlay.coach': 'Coach',
    'overlay.deathReview': 'Analyse de la mort',

    'chat.lead': 'Pose une question sur une manche, une mort ou ton agent.',
    'chat.placeholder': 'Pose une question à ton coach',
    'chat.send': 'Envoyer',
    'chat.matchLabel': 'Le match dont tu parles',
    'chat.noMatch': 'Aucun match, questions générales',
    'chat.won': 'gagné',
    'chat.lost': 'perdu',
    'chat.drew': 'nul',
    'chat.to': 'à',
    'chat.win': 'victoire',
    'chat.loss': 'défaite',
    'chat.draw': 'match nul',
    'chat.match': 'match',
    'chat.divider': 'Maintenant, à propos de {match}',
    'chat.dividerNone': 'Maintenant, des questions générales, sans match',
    'chat.walk': 'Explique-moi la manche {n}',
    'chat.change': 'Que devrais-je changer avec {agent} ?',
    'chat.losing': 'Où est-ce que je perds des manches ?',
    'chat.kit': 'Comment utiliser le kit de mon agent ?',
    'chat.save': 'Quand mon équipe devrait-elle économiser ?',
    'chat.sheriff': 'Comment gagner plus de duels au Sheriff ?',
    'chat.workOn': 'Sur quoi devrais-je travailler en premier ?',
    'chat.openRecorded': 'Revois avec moi mon match {match}. Quelle a été mon erreur la plus coûteuse, et sur quoi devrais-je travailler en premier ?',
    'chat.openRiot': 'Revois avec moi mon match sur {map}. Que montre le relevé de Riot, et par où commencerais-tu ?',
    'chat.held': "Ce match est peut-être encore en cours. Le coach pourra en parler dès que le relevé de Riot l'aura, ou dans 90 minutes.",
    'chat.cap': 'Tu as utilisé tes questions du jour. Le coach revient à {time}.',
    'chat.capTomorrow': 'Tu as utilisé tes questions du jour. Le coach revient demain.',
    'chat.which': '{count} de tes dix derniers matchs étaient sur {map}. Lequel veux-tu dire ? Choisis-le dans la liste des matchs en haut.',
    'chat.noneOnMap': "Aucun de tes dix derniers matchs n'était sur {map}. Choisis un match dans la liste en haut, ou pose ta question sur celui-ci.",
    'chat.failed': 'Impossible de joindre ton coach pour le moment. Réessaie dans un instant.',
    'chat.midMatch': 'Un match est en cours. Le coach revient quand il est terminé.',
    'chat.honest': "Je n'ai pas pu te donner une réponse sûre pour celle-là. Pose-moi une question sur une manche, une mort ou ton agent dans ce match.",
  },
};

/** Is this a language we know about at all? */
function isSupported(code) {
  return LANGUAGES.some((l) => l.code === code);
}

function normalize(code) {
  return isSupported(code) ? code : DEFAULT_LANG;
}

/** The English name to put in the prompt, for tips in the player's language. */
function promptName(code) {
  const hit = LANGUAGES.find((l) => l.code === normalize(code));
  return hit ? hit.prompt : 'English';
}

/**
 * Translate a key. Falls back to English, then to the key itself, so a missing
 * translation degrades to a readable English label instead of blanking the UI.
 */
function t(code, key) {
  const lang = normalize(code);
  const table = STRINGS[lang];
  if (table && table[key] != null) return table[key];
  const en = STRINGS[DEFAULT_LANG];
  if (en && en[key] != null) return en[key];
  return key;
}

/** Does this language have translated chrome, or only translated coaching? */
function hasUi(code) {
  return Object.prototype.hasOwnProperty.call(STRINGS, normalize(code));
}

module.exports = { LANGUAGES, DEFAULT_LANG, STRINGS, t, promptName, isSupported, normalize, hasUi };
