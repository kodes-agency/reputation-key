// New portal — which languages the form shows when the person changes what to
// start from. A copy brings the languages of the portal it copies; going back
// to the Property's wording brings back the Property's. The form only applies
// this while the person has not chosen languages themselves.
import {
  GUEST_LOCALE_METADATA,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import { sourceLocalesOf, type PortalNewOptions } from './portal-new-rules'
import type { PortalNewSource } from './portal-new-types'

export function languagesAfterChange(
  options: Pick<PortalNewOptions, 'defaultGuestLocales'>,
  sources: readonly PortalNewSource[],
  startFrom: 'property' | 'portal',
  sourcePortalId: string,
): OfferedGuestLocale[] {
  const defaults = [...options.defaultGuestLocales]
  if (startFrom !== 'portal') return defaults
  const source = sources.find((candidate) => candidate.portalId === sourcePortalId)
  const copied = source ? sourceLocalesOf(source) : []
  return copied.length > 0 ? [...copied] : defaults
}

/**
 * The line under Languages that says what a copy did to them, so a change made in
 * a field above the one the person is working in is never silent: the copied
 * portal's languages, or that the person's own choice stays. Nothing when the
 * start is the Property's wording, or no portal has been chosen yet.
 */
export function copiedLanguagesNote(
  sources: readonly PortalNewSource[],
  startFrom: 'property' | 'portal',
  sourcePortalId: string,
  languagesEdited: boolean,
): string | null {
  if (startFrom !== 'portal') return null
  const source = sources.find((candidate) => candidate.portalId === sourcePortalId)
  if (!source) return null
  if (languagesEdited) {
    return `Keeps the languages you chose, not ${source.name}’s.`
  }
  const names = sourceLocalesOf(source).map(
    (locale) => GUEST_LOCALE_METADATA[locale].nativeName,
  )
  return names.length === 0 ? null : `Copied from ${source.name}: ${names.join(', ')}.`
}
