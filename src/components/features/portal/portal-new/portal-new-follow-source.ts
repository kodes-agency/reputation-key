// New portal — which languages the form shows when the person changes what to
// start from. A copy brings the languages of the portal it copies; going back
// to the Property's wording brings back the Property's. The form only applies
// this while the person has not chosen languages themselves.
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
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
