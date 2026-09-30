import type { GuestLanguagePackV2, GuestLocale } from '#/shared/domain/guest-locale'

// The key set of the v2 guest copy packs (generation 2, carried by schema
// version 3 snapshots). A pack is plain JSON: text with `{placeholder}` slots
// and plural forms keyed by CLDR category, never functions, so the server can
// hand exactly one pack to the browser inside the page data.
//
// The values are the placeholders each text may use. A pack test holds every
// locale to this table, so a placeholder can be neither dropped nor invented
// in one language. The copy is industry-neutral on purpose: a guest has a
// "visit", never a "stay", and no text names a kind of place.

export type GuestCopyPlaceholder =
  'name' | 'word' | 'stars' | 'time' | 'date' | 'zone' | 'count'

export const GUEST_COPY_V2_PLACEHOLDERS = {
  // Page chrome: language chip and sheet, footer, visit notice, logo.
  languageChipLabel: [],
  languageSheetTitle: [],
  languageSheetHint: [],
  languageSheetClose: [],
  languageCurrent: [],
  // Each guest locale named in this pack's language: the sheet's second line.
  languageNameEn: [],
  languageNameBg: [],
  languageNameEs: [],
  languageNameIt: [],
  languageNameFr: [],
  languageNameDe: [],
  privacyNoticeLink: [],
  footerMadeWith: [],
  logoAlt: ['name'],
  visitNotice: ['name'],
  // The full disclosure (ADR 0044): the essential session cookie and the
  // network marker. Slice 17 renders this until the owner approves shorter copy.
  visitNoticeDetail: ['name'],
  visitNoticeLabel: [],
  visitNoticeAcknowledge: [],
  // The rating card.
  ratingTitle: [],
  ratingWord1: [],
  ratingWord2: [],
  ratingWord3: [],
  ratingWord4: [],
  ratingWord5: [],
  ratingScaleLow: [],
  ratingScaleHigh: [],
  ratingGroupLabel: [],
  ratingOption: ['stars', 'word'],
  ratingChoose: [],
  ratingSend: [],
  ratingPrivacyLine: ['name'],
  ratingSaveFailed: [],
  sending: [],
  honeypotLabel: [],
  errorGeneric: [],
  // After a rating.
  ratingThanks: [],
  ratingSentTitle: [],
  ratingSentSummary: ['word'],
  ratingChange: [],
  ratingUpdated: [],
  // The Google card.
  googleTitle: [],
  googleBody: [],
  googleAction: [],
  googleOpensLabel: [],
  googleHint: [],
  googleUnavailableTitle: [],
  googleUnavailableBody: ['name'],
  googleOpenFailed: [],
  // The private note.
  noteOfferTitle: [],
  noteOfferBody: ['name'],
  noteOfferAction: [],
  noteLabel: [],
  noteHint: [],
  noteSend: [],
  noteDismiss: [],
  noteRequired: [],
  noteSent: ['name'],
  noteSendFailed: [],
  // "Your response": change, remove or start over.
  responseTitle: [],
  responseSummary: [],
  responseChangeTitle: [],
  responseChangeSave: [],
  responseRemoveNoteTitle: [],
  responseRemoveNoteAction: [],
  responseRemoveNoteDone: [],
  responseRemoveNoteFailed: [],
  responseRemoveAllTitle: [],
  responseRemoveAllNote: [],
  responseRemoveAllAction: [],
  responseRemoveAllConfirmTitle: [],
  responseRemoveAllConfirmBody: [],
  responseRemoveAllConfirm: [],
  responseRemoveAllCancel: [],
  responseRemoveAllDoneTitle: [],
  responseRemoveAllDoneBody: [],
  responseRemoveAllFailed: [],
  // Deadlines: today, tomorrow, or a named day, always in the portal's zone.
  deadlineToday: ['time', 'zone'],
  deadlineTomorrow: ['time', 'zone'],
  deadlineDate: ['date', 'time', 'zone'],
  windowEndedChange: [],
  windowEndedNote: [],
  windowEndedAll: [],
  // Shared devices.
  sharedDeviceTitle: [],
  sharedDeviceBody: [],
  startOverAction: [],
  startOverDone: [],
  startOverFailed: [],
  // The Linktree and the page that has nothing to show.
  linktreeDefaultTitle: [],
  linkOpensNewTab: [],
  unavailableTitle: [],
  unavailableBody: [],
} as const satisfies Readonly<Record<string, readonly GuestCopyPlaceholder[]>>

export const GUEST_PLURAL_V2_PLACEHOLDERS = {
  ratingStars: ['count'],
} as const satisfies Readonly<Record<string, readonly GuestCopyPlaceholder[]>>

export type GuestCopyKeyV2 = keyof typeof GUEST_COPY_V2_PLACEHOLDERS
export type GuestPluralKeyV2 = keyof typeof GUEST_PLURAL_V2_PLACEHOLDERS

/** The placeholders one key's text takes, as an object type of the values to fill in. */
export type GuestCopyValues<K extends GuestCopyKeyV2> = Readonly<
  Record<(typeof GUEST_COPY_V2_PLACEHOLDERS)[K][number], string | number>
>

/** Text per CLDR plural category; `other` is always written. */
export type GuestPluralForms = Readonly<
  Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
>

export type GuestPortalCopyV2 = Readonly<{
  locale: GuestLocale
  version: GuestLanguagePackV2
  copy: Readonly<Record<GuestCopyKeyV2, string>>
  plurals: Readonly<Record<GuestPluralKeyV2, GuestPluralForms>>
  /** Place names by IANA zone id, for the zones the product offers; others print the id's own place name. */
  zoneNames: Readonly<Record<string, string>>
}>

/** Freezes a pack so one request can never change the copy another request reads. */
export function defineGuestCopyV2(pack: GuestPortalCopyV2): GuestPortalCopyV2 {
  for (const forms of Object.values(pack.plurals)) Object.freeze(forms)
  Object.freeze(pack.copy)
  Object.freeze(pack.plurals)
  Object.freeze(pack.zoneNames)
  return Object.freeze(pack)
}
