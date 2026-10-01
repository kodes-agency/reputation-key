// Portal context — the guest languages a new Portal starts with.
//
// Order of precedence: what the manager asked for, then the languages of the
// Portal being copied, then the Property's defaults (English when it has none
// that may be offered today). The first language is the Portal's primary.
// Pure: the readers of the Property and the source Portal live in the use case.

import {
  isOfferedGuestLocale,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import { portalError } from './errors'

export type NewPortalLocales = Readonly<{
  primary: OfferedGuestLocale
  additional: readonly OfferedGuestLocale[]
}>

const FALLBACK_LOCALE: OfferedGuestLocale = 'en'

function fromList(list: readonly GuestLocale[]): NewPortalLocales | null {
  const [primary, ...additional] = list.filter(isOfferedGuestLocale)
  return primary ? { primary, additional } : null
}

function fromRequest(requested: readonly GuestLocale[]): NewPortalLocales {
  if (requested.length === 0) {
    throw portalError('locale_not_offered', 'Choose at least one language')
  }
  if (new Set(requested).size !== requested.length) {
    throw portalError('locale_not_offered', 'A language was given more than once')
  }
  const offered = requested.filter(isOfferedGuestLocale)
  const chosen = fromList(offered)
  if (!chosen || offered.length !== requested.length) {
    throw portalError('locale_not_offered', 'That language is not offered yet')
  }
  return chosen
}

export function resolveNewPortalLocales(
  input: Readonly<{
    requested?: readonly GuestLocale[]
    source?: Readonly<{ primary: GuestLocale; additional: readonly GuestLocale[] }>
    propertyDefaults: readonly GuestLocale[]
  }>,
): NewPortalLocales {
  if (input.requested !== undefined) return fromRequest(input.requested)
  const fromSource = input.source
    ? fromList([input.source.primary, ...input.source.additional])
    : null
  return (
    fromSource ??
    fromList(input.propertyDefaults) ?? { primary: FALLBACK_LOCALE, additional: [] }
  )
}
