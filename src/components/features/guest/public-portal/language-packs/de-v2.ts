import { defineGuestCopyV2 } from './guest-copy-v2'

// German guest copy, generation 2 (schema version 3 snapshots). The form of
// address is the formal "Sie" throughout. The wording the owner agreed in the
// German glossary (the rating question and scale, the privacy line, the visit
// notice, the language sheet, the Google card, the private note offer and the
// footer) is used as written and pinned by `guest-copy-v2.test.ts`; it is the
// wording of round 4 board G10. The rest is drafted in the same register. No
// native check happens during the closed beta (owner decision 5, 2026-09-30).
// Industry-neutral: no text names a kind of place.
export const deV2 = defineGuestCopyV2({
  locale: 'de',
  version: 'guest-ui-de-v2',
  copy: {
    languageChipLabel: 'Sprache',
    languageSheetTitle: 'Sprache',
    languageSheetHint:
      'Die Seite öffnet sich in der Sprache Ihres Telefons, wenn verfügbar.',
    languageSheetClose: 'Schließen',
    languageCurrent: 'Ausgewählt',
    languageNameEn: 'Englisch',
    languageNameBg: 'Bulgarisch',
    languageNameEs: 'Spanisch',
    languageNameIt: 'Italienisch',
    languageNameFr: 'Französisch',
    languageNameDe: 'Deutsch',
    privacyNoticeLink: 'Datenschutzhinweis',
    privacyNoticeLinkInEnglish: 'Datenschutzhinweis (auf Englisch)',
    footerMadeWith: 'Erstellt mit Reputation Key',
    logoAlt: 'Logo von {name}',
    visitNotice:
      '{name} zählt Besuche mit einem notwendigen Cookie und einem datenschutzfreundlichen Marker. Keine Werbung, keine Tracker von Dritten.',
    visitNoticeLabel: 'Besuchszählung',
    visitNoticeAcknowledge: 'Verstanden',

    ratingTitle: 'Wie hat es Ihnen gefallen?',
    ratingWord1: 'Schlecht',
    ratingWord2: 'Mäßig',
    ratingWord3: 'Gut',
    ratingWord4: 'Sehr gut',
    ratingWord5: 'Ausgezeichnet',
    ratingScaleLow: 'Schlecht',
    ratingScaleHigh: 'Ausgezeichnet',
    ratingGroupLabel: 'Bewertung',
    ratingOption: '{stars}, {word}',
    ratingChoose: 'Wählen Sie eine Bewertung von 1 bis 5 Sternen.',
    ratingSend: 'Privat senden',
    ratingPrivacyLine: 'Wird vertraulich an {name} gesendet.',
    ratingSaveFailed:
      'Ihre Bewertung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',
    sending: 'Wird gesendet…',
    honeypotLabel: 'Webseite',
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',

    ratingThanks: 'Vielen Dank.',
    ratingSentTitle: 'Bewertung privat gesendet',
    ratingSentSummary: '{word} · privat gesendet',
    ratingChange: 'Ändern',
    ratingUpdated: 'Ihre Bewertung wurde geändert.',

    googleTitle: 'Teilen Sie Ihre Erfahrung auf Google',
    googleBody:
      'Wenn Sie möchten, können Sie auch eine öffentliche Bewertung auf Google hinterlassen.',
    googleAction: 'Weiter zu Google',
    googleOpensLabel: '(öffnet Google)',
    googleHint: 'Öffnet Google · eventuell müssen Sie sich anmelden',
    googleUnavailableTitle: 'Google kann von hier aus gerade nicht geöffnet werden',
    googleUnavailableBody:
      'Ihre Bewertung ist privat bei {name} angekommen. Vielen Dank.',
    googleOpenFailed:
      'Google konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.',

    noteOfferTitle: 'Private Nachricht an das Team',
    noteOfferBody: 'Optional. Wird vertraulich mit {name} geteilt.',
    noteOfferAction: 'Private Nachricht schreiben',
    noteLabel: 'Ihre Nachricht (optional)',
    noteHint: 'Sie müssen Ihren Namen nicht angeben.',
    noteSend: 'Nachricht privat senden',
    noteDismiss: 'Jetzt nicht',
    noteRequired: 'Schreiben Sie Ihre Nachricht, bevor Sie sie senden.',
    noteSent: 'Ihre Nachricht wurde privat an {name} gesendet.',
    noteSendFailed:
      'Ihre Nachricht konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',

    responseTitle: 'Ihre Rückmeldung',
    responseSummary: 'Ändern, entfernen oder neu beginnen',
    responseChangeTitle: 'Ihre Bewertung ändern',
    responseChangeSave: 'Neue Bewertung speichern',
    responseRemoveNoteTitle: 'Ihre Nachricht entfernen',
    responseRemoveNoteAction: 'Entfernen',
    responseRemoveNoteDone:
      'Ihre Nachricht wurde entfernt. Ihre Bewertung bleibt gespeichert.',
    responseRemoveNoteFailed:
      'Ihre Nachricht konnte nicht entfernt werden. Bitte versuchen Sie es erneut.',
    responseRemoveAllTitle: 'Ihre Bewertung und Nachricht entfernen',
    responseRemoveAllNote: 'Was Sie auf Google veröffentlicht haben, bleibt unverändert.',
    responseRemoveAllAction: 'Entfernen…',
    responseRemoveAllConfirmTitle: 'Bewertung und Nachricht entfernen?',
    responseRemoveAllConfirmBody:
      'Beides wird gelöscht. Das lässt sich nicht rückgängig machen.',
    responseRemoveAllConfirm: 'Beides entfernen',
    responseRemoveAllCancel: 'Behalten',
    responseRemoveAllDoneTitle: 'Ihre Rückmeldung wurde entfernt',
    responseRemoveAllDoneBody:
      'Ihre Bewertung und, falls vorhanden, Ihre Nachricht wurden gelöscht.',
    responseRemoveAllFailed:
      'Ihre Rückmeldung konnte nicht entfernt werden. Bitte versuchen Sie es erneut.',
    responseRemoveRatingTitle: 'Ihre Bewertung entfernen',
    responseRemoveRatingConfirmTitle: 'Bewertung entfernen?',
    responseRemoveRatingConfirmBody:
      'Sie wird gelöscht. Das lässt sich nicht rückgängig machen.',
    responseRemoveRatingConfirm: 'Bewertung entfernen',
    responseRemoveRatingCancel: 'Behalten',

    deadlineToday: 'Bis heute, {time} Uhr, Ortszeit {zone}',
    deadlineTomorrow: 'Bis morgen, {time} Uhr, Ortszeit {zone}',
    deadlineDate: 'Bis {date}, {time} Uhr, Ortszeit {zone}',
    windowEndedChange: 'Die Frist zum Ändern Ihrer Bewertung ist abgelaufen.',
    windowEndedNote: 'Die Frist zum Entfernen Ihrer Nachricht ist abgelaufen.',
    windowEndedAll: 'Die Frist zum Entfernen Ihrer Rückmeldung ist abgelaufen.',

    sharedDeviceTitle: 'Gemeinsam genutztes Telefon oder Tablet?',
    sharedDeviceBody: 'Beginnen Sie neu, damit der nächste Gast eine leere Seite sieht.',
    startOverAction: 'Auf diesem Gerät neu beginnen',
    startOverDone:
      'Bereit für den nächsten Gast. Ihre frühere Rückmeldung bleibt gespeichert.',
    startOverDoneAfterRemoval: 'Bereit für den nächsten Gast.',
    startOverFailed: 'Neu beginnen war nicht möglich. Bitte versuchen Sie es erneut.',

    linktreeDefaultTitle: 'Nützliche Links',
    linkOpensNewTab: '(öffnet in neuem Tab)',
    unavailableTitle: 'Diese Seite ist derzeit nicht verfügbar.',
    unavailableBody: 'Bitte schauen Sie später noch einmal vorbei.',
    unavailableRetry: 'Erneut versuchen',
    ratingUnavailableTitle:
      'Bewertungen können von hier aus gerade nicht gesendet werden.',
    ratingUnavailableBody: 'Bitte versuchen Sie es später noch einmal.',
  },
  plurals: {
    ratingStars: { one: '{count} Stern', other: '{count} Sterne' },
  },
  zoneNames: {
    UTC: 'UTC',
    'Europe/Sofia': 'Sofia',
    'Europe/London': 'London',
    'Europe/Berlin': 'Berlin',
    'Europe/Paris': 'Paris',
    'Europe/Madrid': 'Madrid',
    'Europe/Rome': 'Rom',
    'Europe/Athens': 'Athen',
    'Europe/Bucharest': 'Bukarest',
    'Europe/Belgrade': 'Belgrad',
    'Europe/Istanbul': 'Istanbul',
    'Europe/Kyiv': 'Kyiv',
    'Europe/Kiev': 'Kyiv',
  },
})
