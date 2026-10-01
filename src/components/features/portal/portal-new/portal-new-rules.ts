// New portal dialog — the choices the form makes, as pure functions: what it
// starts with, what it sends, which language chips it draws and how it words
// who will be responsible. Kept apart from the components so each rule is
// tested without rendering.
import {
  GUEST_LOCALE_METADATA,
  OFFERED_GUEST_LOCALES,
  isOfferedGuestLocale,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import type {
  CreatePortalInput,
  NewPortalFormValues,
} from '#/contexts/portal/application/dto/create-portal.dto'
import {
  describeManagers,
  type PortalManagerName,
} from '../portal-overview/portal-overview-view'

/** What the dialog reads about the Property before it can start a portal. */
export type PortalNewOptions = Readonly<{
  defaultGuestLocales: readonly OfferedGuestLocale[]
  eligibleManagerUserIds: readonly string[]
  creatorIsEligible: boolean
}>

const FALLBACK_LOCALES: readonly OfferedGuestLocale[] = ['en']

export function newPortalDefaults(
  options: PortalNewOptions | undefined,
): NewPortalFormValues {
  return {
    name: '',
    groupId: '',
    guestLocales: [...(options?.defaultGuestLocales ?? FALLBACK_LOCALES)],
    startFrom: 'property',
    sourcePortalId: '',
    responsibleManagerUserIds: null,
  }
}

/** The server input for the form's values; a choice left at its default is not sent. */
export function toCreatePortalInput(
  propertyId: string,
  values: NewPortalFormValues,
): CreatePortalInput {
  return {
    propertyId,
    name: values.name.trim(),
    guestLocales: [...values.guestLocales],
    startFrom:
      values.startFrom === 'portal'
        ? { kind: 'portal', portalId: values.sourcePortalId }
        : { kind: 'property' },
    ...(values.groupId === '' ? {} : { groupId: values.groupId }),
    ...(values.responsibleManagerUserIds === null
      ? {}
      : { responsibleManagerUserIds: [...values.responsibleManagerUserIds] }),
  }
}

const nativeName = (locale: GuestLocale): string =>
  GUEST_LOCALE_METADATA[locale].nativeName

/**
 * The chips to draw and the languages left for the menu. A Property default
 * stays a chip when switched off, so it can be switched on again in place.
 */
export function languageChoices(
  defaults: readonly OfferedGuestLocale[],
  selected: readonly OfferedGuestLocale[],
): Readonly<{
  chips: readonly OfferedGuestLocale[]
  addable: readonly OfferedGuestLocale[]
}> {
  const chips = [...new Set([...defaults, ...selected])]
  return {
    chips,
    addable: OFFERED_GUEST_LOCALES.filter((locale) => !chips.includes(locale)),
  }
}

/** Switch one language on (last) or off. The last language left cannot be switched off. */
export function toggleLocale(
  selected: readonly OfferedGuestLocale[],
  locale: OfferedGuestLocale,
): OfferedGuestLocale[] {
  if (!selected.includes(locale)) return [...selected, locale]
  if (selected.length === 1) return [...selected]
  return selected.filter((candidate) => candidate !== locale)
}

export function languageNote(selected: readonly OfferedGuestLocale[]): string {
  const [primary] = selected
  if (primary === undefined) return ''
  if (selected.length === 1) {
    return `Guests see the page in ${nativeName(primary)}. No language switch.`
  }
  return `Guests can switch between these. ${GUEST_LOCALE_METADATA[primary].englishName} is the fallback.`
}

/** The languages of a portal that can be copied, primary first, without any not offered yet. */
export function sourceLocalesOf(
  portal: Readonly<{
    primaryGuestLocale: GuestLocale
    additionalGuestLocales: readonly GuestLocale[]
  }>,
): readonly OfferedGuestLocale[] {
  return [portal.primaryGuestLocale, ...portal.additionalGuestLocales].filter(
    isOfferedGuestLocale,
  )
}

const CREATOR_SENTENCE = "You'll be responsible for this portal"

/** Who will be responsible, in words; ids never appear, only names or a count. */
export function responsibleSummary(
  choice: readonly string[] | null,
  options: Pick<PortalNewOptions, 'creatorIsEligible'>,
  creatorId: string,
  members: readonly PortalManagerName[],
): string {
  const ids = choice ?? (options.creatorIsEligible ? [creatorId] : [])
  if (ids.length === 0) return 'No one will be responsible yet'
  const others = ids.filter((id) => id !== creatorId)
  if (others.length === 0) return CREATOR_SENTENCE
  const names = describeManagers(others, members).description
  const who = ids.includes(creatorId) ? `You and ${names}` : names
  return `${who} will be responsible`
}
