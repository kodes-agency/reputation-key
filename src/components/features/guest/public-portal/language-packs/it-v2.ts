import { defineGuestCopyV2 } from './guest-copy-v2'

// Italian guest copy, generation 2 (schema version 3 snapshots). Sentences
// address the guest as "Lei" (la sua esperienza, riprovi); buttons use the
// neutral forms every Italian interface uses (Invia, Rimuovi, Mantieni or the
// infinitive), never a tu imperative with a pronoun on the end. No native check happens
// during the closed beta (owner decision 5, 2026-09-30). Industry-neutral: no
// text names a kind of place.
export const itV2 = defineGuestCopyV2({
  locale: 'it',
  version: 'guest-ui-it-v2',
  copy: {
    languageChipLabel: 'Lingua',
    languageSheetTitle: 'Lingua',
    languageSheetHint:
      'Questa pagina si apre nella lingua del suo telefono, quando è disponibile.',
    languageSheetClose: 'Chiudi',
    languageCurrent: 'Selezionata',
    languageNameEn: 'Inglese',
    languageNameBg: 'Bulgaro',
    languageNameEs: 'Spagnolo',
    languageNameIt: 'Italiano',
    languageNameFr: 'Francese',
    languageNameDe: 'Tedesco',
    privacyNoticeLink: 'Informativa sulla privacy',
    footerMadeWith: 'Creato con Reputation Key',
    logoAlt: 'Logo di {name}',
    visitNotice:
      'Questa pagina conta le visite per {name}. Nessuna pubblicità, nessun tracker di terze parti.',
    visitNoticeDetail:
      'Un cookie di sessione essenziale protegge la sua risposta. Separatamente, contiamo questa visita per {name} con un marcatore di rete di breve durata, a tutela della sua privacy. Nessuna pubblicità, nessun tracker di terze parti.',
    visitNoticeLabel: 'Conteggio delle visite',
    visitNoticeAcknowledge: 'Ho capito',

    ratingTitle: 'Com’è stata la sua esperienza?',
    ratingWord1: 'Scarsa',
    ratingWord2: 'Discreta',
    ratingWord3: 'Buona',
    ratingWord4: 'Molto buona',
    ratingWord5: 'Eccellente',
    ratingScaleLow: 'Scarsa',
    ratingScaleHigh: 'Eccellente',
    ratingGroupLabel: 'Valutazione',
    ratingOption: '{stars}, {word}',
    ratingChoose: 'Scelga una valutazione da 1 a 5 stelle.',
    ratingSend: 'Invia in privato',
    ratingPrivacyLine: 'Condivisa in privato con {name}.',
    ratingSaveFailed: 'Non è stato possibile salvare la sua valutazione. Riprovi.',
    sending: 'Invio in corso…',
    honeypotLabel: 'Sito web',
    errorGeneric: 'Qualcosa è andato storto. Riprovi.',

    ratingThanks: 'Grazie.',
    ratingSentTitle: 'Valutazione inviata in privato',
    ratingSentSummary: '{word} · inviata in privato',
    ratingChange: 'Modifica',
    ratingUpdated: 'La sua valutazione è stata aggiornata.',

    googleTitle: 'Condivida la sua esperienza su Google',
    googleBody: 'Se lo desidera, può lasciare anche una recensione pubblica su Google.',
    googleAction: 'Continua su Google',
    googleOpensLabel: '(apre Google)',
    googleHint: 'Apre Google · potrebbe essere necessario accedere',
    googleUnavailableTitle: 'Google non può essere aperto da qui in questo momento',
    googleUnavailableBody: 'La sua valutazione è arrivata in privato a {name}. Grazie.',
    googleOpenFailed: 'Non è stato possibile aprire Google. Riprovi.',

    noteOfferTitle: 'Aggiunga una nota privata per il team',
    noteOfferBody: 'Facoltativa. Condivisa in privato con {name}.',
    noteOfferAction: 'Scrivere una nota privata',
    noteLabel: 'La sua nota (facoltativa)',
    noteHint: 'Non è necessario indicare il suo nome.',
    noteSend: 'Invia la nota in privato',
    noteDismiss: 'Non ora',
    noteRequired: 'Scriva la sua nota prima di inviarla.',
    noteSent: 'La sua nota è stata inviata in privato a {name}.',
    noteSendFailed: 'Non è stato possibile inviare la sua nota. Riprovi.',

    responseTitle: 'La sua risposta',
    responseSummary: 'Modificare, rimuovere o ricominciare',
    responseChangeTitle: 'Modifichi la sua valutazione',
    responseChangeSave: 'Salva la nuova valutazione',
    responseRemoveNoteTitle: 'Rimuova la sua nota',
    responseRemoveNoteAction: 'Rimuovi',
    responseRemoveNoteDone:
      'La sua nota è stata rimossa. La sua valutazione resta salvata.',
    responseRemoveNoteFailed: 'Non è stato possibile rimuovere la sua nota. Riprovi.',
    responseRemoveAllTitle: 'Rimuova la sua valutazione e la sua nota',
    responseRemoveAllNote: 'Ciò che ha pubblicato su Google non viene modificato.',
    responseRemoveAllAction: 'Rimuovi…',
    responseRemoveAllConfirmTitle: 'Rimuovere valutazione e nota?',
    responseRemoveAllConfirmBody:
      'Verranno eliminate entrambe. L’operazione non può essere annullata.',
    responseRemoveAllConfirm: 'Rimuovi entrambe',
    responseRemoveAllCancel: 'Mantieni',
    responseRemoveAllDoneTitle: 'La sua risposta è stata rimossa',
    responseRemoveAllDoneBody:
      'La sua valutazione e, se l’ha inviata, la sua nota sono state eliminate.',
    responseRemoveAllFailed: 'Non è stato possibile rimuovere la sua risposta. Riprovi.',
    responseRemoveRatingTitle: 'Rimuova la sua valutazione',
    responseRemoveRatingConfirmTitle: 'Rimuovere la valutazione?',
    responseRemoveRatingConfirmBody:
      'Verrà eliminata. L’operazione non può essere annullata.',
    responseRemoveRatingConfirm: 'Rimuovi',
    responseRemoveRatingCancel: 'Mantieni',

    deadlineToday: 'Fino alle {time} di oggi, ora di {zone}',
    deadlineTomorrow: 'Fino alle {time} di domani, ora di {zone}',
    // No article before the date: `Fino al` would need all'8 and all'11.
    deadlineDate: 'Scadenza: {date}, ore {time}, ora di {zone}',
    windowEndedChange: 'Il tempo per modificare la sua valutazione è scaduto.',
    windowEndedNote: 'Il tempo per rimuovere la sua nota è scaduto.',
    windowEndedAll: 'Il tempo per rimuovere la sua risposta è scaduto.',

    sharedDeviceTitle: 'Telefono o tablet condiviso?',
    sharedDeviceBody:
      'Ricominci da capo, così il prossimo ospite troverà una pagina nuova.',
    startOverAction: 'Ricominciare da capo su questo dispositivo',
    startOverDone:
      'Pronto per il prossimo ospite. La sua risposta precedente resta salvata.',
    startOverFailed: 'Non è stato possibile ricominciare. Riprovi.',

    linktreeDefaultTitle: 'Link utili',
    linkOpensNewTab: '(si apre in una nuova scheda)',
    unavailableTitle: 'Questa pagina al momento non è disponibile.',
    unavailableBody: 'Riprovi più tardi.',
  },
  plurals: {
    ratingStars: { one: '{count} stella', other: '{count} stelle' },
  },
  zoneNames: {
    UTC: 'UTC',
    'Europe/Sofia': 'Sofia',
    'Europe/London': 'Londra',
    'Europe/Berlin': 'Berlino',
    'Europe/Paris': 'Parigi',
    'Europe/Madrid': 'Madrid',
    'Europe/Rome': 'Roma',
    'Europe/Athens': 'Atene',
    'Europe/Bucharest': 'Bucarest',
    'Europe/Belgrade': 'Belgrado',
    'Europe/Istanbul': 'Istanbul',
    'Europe/Kyiv': 'Kyiv',
    'Europe/Kiev': 'Kyiv',
  },
})
