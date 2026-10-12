import { defineGuestCopyV2 } from './guest-copy-v2'

// French guest copy, generation 2 (schema version 3 snapshots). The form of
// address is "vous". Two choices follow from the template slots: the property
// name never follows "de" (it would need an elision before a vowel), and the
// deadline names the zone in brackets for the same reason. The private note is
// a "message", so it never collides with "note", the rating. French
// punctuation keeps a no-break space before "?", ":" and "!". No native check
// happens during the closed beta (owner decision 5, 2026-09-30).
// Industry-neutral: no text names a kind of place.
export const frV2 = defineGuestCopyV2({
  locale: 'fr',
  version: 'guest-ui-fr-v2',
  copy: {
    languageChipLabel: 'Langue',
    languageSheetTitle: 'Langue',
    languageSheetHint:
      'Cette page s’ouvre dans la langue de votre téléphone lorsqu’elle est disponible.',
    languageSheetClose: 'Fermer',
    languageCurrent: 'Sélectionnée',
    languageNameEn: 'Anglais',
    languageNameBg: 'Bulgare',
    languageNameEs: 'Espagnol',
    languageNameIt: 'Italien',
    languageNameFr: 'Français',
    languageNameDe: 'Allemand',
    privacyNoticeLink: 'Avis de confidentialité',
    privacyNoticeLinkInEnglish: 'Avis de confidentialité (en anglais)',
    footerMadeWith: 'Créé avec Reputation Key',
    logoAlt: 'Logo : {name}',
    visitNotice:
      '{name} compte les visites avec un cookie essentiel et un marqueur qui protège la vie privée. Pas de publicité, pas de traceurs tiers.',
    visitNoticeLabel: 'Comptage des visites',
    visitNoticeAcknowledge: 'Compris',

    ratingTitle: 'Comment s’est passée votre expérience ?',
    ratingWord1: 'Mauvaise',
    ratingWord2: 'Passable',
    ratingWord3: 'Bonne',
    ratingWord4: 'Très bonne',
    ratingWord5: 'Excellente',
    ratingScaleLow: 'Mauvaise',
    ratingScaleHigh: 'Excellente',
    ratingGroupLabel: 'Note',
    ratingOption: '{stars}, {word}',
    ratingChoose: 'Choisissez une note de 1 à 5 étoiles.',
    ratingSend: 'Envoyer en privé',
    ratingPrivacyLine: 'Partagée en privé avec {name}.',
    ratingSaveFailed: 'Votre note n’a pas pu être enregistrée. Veuillez réessayer.',
    sending: 'Envoi en cours…',
    honeypotLabel: 'Site web',
    errorGeneric: 'Une erreur s’est produite. Veuillez réessayer.',

    ratingThanks: 'Merci.',
    ratingSentTitle: 'Note envoyée en privé',
    ratingSentSummary: '{word} · envoyée en privé',
    ratingChange: 'Modifier',
    ratingUpdated: 'Votre note a été modifiée.',

    googleTitle: 'Partagez votre expérience sur Google',
    googleBody:
      'Si vous le souhaitez, vous pouvez aussi laisser un avis public sur Google.',
    googleAction: 'Continuer vers Google',
    googleOpensLabel: '(ouvre Google)',
    googleHint: 'Ouvre Google · vous devrez peut-être vous connecter',
    googleUnavailableTitle: 'Google ne peut pas être ouvert d’ici pour le moment',
    googleUnavailableBody: 'Votre note est bien parvenue en privé à {name}. Merci.',
    googleOpenFailed: 'Google n’a pas pu être ouvert. Veuillez réessayer.',

    noteOfferTitle: 'Ajoutez un message privé pour l’équipe',
    noteOfferBody: 'Facultatif. Partagé en privé avec {name}.',
    noteOfferAction: 'Écrire un message privé',
    noteLabel: 'Votre message (facultatif)',
    noteHint: 'Inutile d’indiquer votre nom.',
    noteSend: 'Envoyer le message en privé',
    noteDismiss: 'Pas maintenant',
    noteRequired: 'Écrivez votre message avant de l’envoyer.',
    noteSent: 'Votre message a été envoyé en privé à {name}.',
    noteSendFailed: 'Votre message n’a pas pu être envoyé. Veuillez réessayer.',

    responseTitle: 'Votre réponse',
    responseSummary: 'Modifier, supprimer ou recommencer',
    responseChangeTitle: 'Modifiez votre note',
    responseChangeSave: 'Enregistrer la nouvelle note',
    responseRemoveNoteTitle: 'Supprimez votre message',
    responseRemoveNoteAction: 'Supprimer',
    responseRemoveNoteDone: 'Votre message a été supprimé. Votre note reste enregistrée.',
    responseRemoveNoteFailed:
      'Votre message n’a pas pu être supprimé. Veuillez réessayer.',
    responseRemoveAllTitle: 'Supprimez votre note et votre message',
    responseRemoveAllNote: 'Ce que vous avez publié sur Google n’est pas modifié.',
    responseRemoveAllAction: 'Supprimer…',
    responseRemoveAllConfirmTitle: 'Supprimer la note et le message ?',
    responseRemoveAllConfirmBody:
      'Les deux seront effacés. Cette action est irréversible.',
    responseRemoveAllConfirm: 'Supprimer les deux',
    responseRemoveAllCancel: 'Les conserver',
    responseRemoveAllDoneTitle: 'Votre réponse a été supprimée',
    responseRemoveAllDoneBody:
      'Votre note et, le cas échéant, votre message ont été effacés.',
    responseRemoveAllFailed:
      'Votre réponse n’a pas pu être supprimée. Veuillez réessayer.',
    responseRemoveRatingTitle: 'Supprimez votre note',
    responseRemoveRatingConfirmTitle: 'Supprimer la note ?',
    responseRemoveRatingConfirmBody: 'Elle sera effacée. Cette action est irréversible.',
    responseRemoveRatingConfirm: 'La supprimer',
    responseRemoveRatingCancel: 'La conserver',

    deadlineToday: 'Jusqu’à {time} aujourd’hui, heure locale ({zone})',
    deadlineTomorrow: 'Jusqu’à {time} demain, heure locale ({zone})',
    deadlineDate: 'Jusqu’au {date}, {time}, heure locale ({zone})',
    windowEndedChange: 'Le délai pour modifier votre note est écoulé.',
    windowEndedNote: 'Le délai pour supprimer votre message est écoulé.',
    windowEndedAll: 'Le délai pour supprimer votre réponse est écoulé.',

    sharedDeviceTitle: 'Téléphone ou tablette partagé ?',
    sharedDeviceBody: 'Recommencez pour que le prochain invité trouve une page vierge.',
    startOverAction: 'Recommencer sur cet appareil',
    startOverDone:
      'Prêt pour le prochain invité. Votre réponse précédente reste enregistrée.',
    startOverDoneAfterRemoval: 'Prêt pour le prochain invité.',
    startOverFailed: 'Impossible de recommencer. Veuillez réessayer.',

    linktreeDefaultTitle: 'Liens utiles',
    linkOpensNewTab: '(s’ouvre dans un nouvel onglet)',
    unavailableTitle: 'Cette page n’est pas disponible pour le moment.',
    unavailableBody: 'Veuillez revenir plus tard.',
    unavailableRetry: 'Réessayer',
    ratingUnavailableTitle:
      'Les notes ne peuvent pas être envoyées d’ici pour le moment.',
    ratingUnavailableBody: 'Veuillez réessayer plus tard.',
  },
  plurals: {
    ratingStars: { one: '{count} étoile', other: '{count} étoiles' },
  },
  zoneNames: {
    UTC: 'UTC',
    'Europe/Sofia': 'Sofia',
    'Europe/London': 'Londres',
    'Europe/Berlin': 'Berlin',
    'Europe/Paris': 'Paris',
    'Europe/Madrid': 'Madrid',
    'Europe/Rome': 'Rome',
    'Europe/Athens': 'Athènes',
    'Europe/Bucharest': 'Bucarest',
    'Europe/Belgrade': 'Belgrade',
    'Europe/Istanbul': 'Istanbul',
    'Europe/Kyiv': 'Kyiv',
    'Europe/Kiev': 'Kyiv',
  },
})
