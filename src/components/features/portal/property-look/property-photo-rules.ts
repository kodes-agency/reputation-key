// What the photograph's dialog decides without a screen: which languages are
// asked for a description, which of them changed, what is sent, and when "Use
// photo" may be pressed. Pure, so the wording and the rules are pinned by tests.

import {
  GUEST_LOCALE_METADATA,
  isOfferedGuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import { sameFocal, type FocalPoint } from './focal-point'

/** Mirrors the longest description the use case keeps (160 characters). */
export const PHOTO_DESCRIPTION_MAX = 160

/** One language's description of the photograph, as the page keeps it. */
export type PhotoDescriptions = Readonly<Partial<Record<OfferedGuestLocale, string>>>

type ContentRow = Readonly<{ locale: string; heroAltText: string | null }>

/** The descriptions the Property has written, by language; a language with none is left out. */
export function savedDescriptions(content: readonly ContentRow[]): PhotoDescriptions {
  return Object.fromEntries(
    content.flatMap(({ locale, heroAltText }) =>
      isOfferedGuestLocale(locale) && heroAltText !== null && heroAltText.trim() !== ''
        ? [[locale, heroAltText.trim()] as const]
        : [],
    ),
  )
}

export type DescriptionField = Readonly<{
  locale: OfferedGuestLocale
  /** "Describe the photo", with the language named when there is more than one. */
  label: string
  value: string
}>

/**
 * One field per language the Property offers by default, the first (its primary)
 * first. Pages in another language read the primary's description until they have
 * their own, so the first language is the one that matters most.
 */
export function descriptionFields(
  locales: readonly OfferedGuestLocale[],
  drafts: PhotoDescriptions,
): readonly DescriptionField[] {
  return locales.map((locale) => ({
    locale,
    label:
      locales.length > 1
        ? `Describe the photo in ${GUEST_LOCALE_METADATA[locale].englishName}`
        : 'Describe the photo',
    value: drafts[locale] ?? '',
  }))
}

/** The description over the limit, if any, as the sentence that says so. */
export function descriptionProblem(drafts: PhotoDescriptions): string | null {
  const isTooLong = Object.values(drafts).some(
    (text) => text.trim().length > PHOTO_DESCRIPTION_MAX,
  )
  return isTooLong
    ? `A description can be at most ${PHOTO_DESCRIPTION_MAX} characters`
    : null
}

/** The languages whose description differs from what is saved, as the write takes them: empty means clear. */
export function changedDescriptions(
  locales: readonly OfferedGuestLocale[],
  drafts: PhotoDescriptions,
  saved: PhotoDescriptions,
): Array<{ locale: OfferedGuestLocale; text: string | null }> {
  return locales.flatMap((locale) => {
    const text = (drafts[locale] ?? '').trim()
    return text === (saved[locale] ?? '')
      ? []
      : [{ locale, text: text === '' ? null : text }]
  })
}

export type PhotoDialogState = Readonly<{
  /** The photograph the Property has now, if any. */
  hasPhoto: boolean
  /** A new file was chosen. */
  hasFile: boolean
  /** The new file passed every check. */
  isFileUsable: boolean
  isRightsConfirmed: boolean
  isFocalChanged: boolean
  isDescriptionChanged: boolean
  isDescriptionValid: boolean
  isBusy: boolean
}>

/**
 * Whether the primary button may be pressed. A new file needs the rights
 * confirmed and every check passed. With no new file, the current photograph's
 * focal point and descriptions can still be saved, once something changed.
 */
export function canUsePhoto(state: PhotoDialogState): boolean {
  if (state.isBusy || !state.isDescriptionValid) return false
  if (state.hasFile) return state.isFileUsable && state.isRightsConfirmed
  return state.hasPhoto && (state.isFocalChanged || state.isDescriptionChanged)
}

/** The primary button's name: "Use photo" for a new file, "Save" for changes to the one in place. */
export const photoButtonLabel = (hasFile: boolean, isBusy: boolean): string => {
  if (isBusy) return hasFile ? 'Uploading…' : 'Saving…'
  return hasFile ? 'Use photo' : 'Save'
}

/** The dialog's title: "Replace photo" when there is one, "Add a photo" when there is not. */
export const photoDialogTitle = (hasPhoto: boolean): string =>
  hasPhoto ? 'Replace photo' : 'Add a photo'

/** Whether the point moved from the one saved; a first photograph has none saved. */
export const focalMoved = (before: FocalPoint | null, after: FocalPoint): boolean =>
  before === null || !sameFocal(before, after)
