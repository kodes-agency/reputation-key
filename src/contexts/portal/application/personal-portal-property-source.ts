import { assertPersonalPortalPublicText } from '../domain/personal-portal-public-text'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import { resolveNewPortalLocales } from '../domain/portal-new-locales'
import {
  resolvePortalPublication,
  type PortalPublicationSource,
} from '../domain/portal-publication-source'
import { portalError } from '../domain/errors'
import type { CreatePortalDeps } from './use-cases/create-portal'

/** Resolve exactly the wording, languages and time zone a new Property copy publishes. */
export async function assertPersonalPropertySource(
  deps: Pick<CreatePortalDeps, 'experienceRepo' | 'propertyApi'>,
  ctx: AuthContext,
  propertyId: PropertyId,
  displayNames: readonly string[] = [],
) {
  const [{ profile, content }, timezones] = await Promise.all([
    deps.experienceRepo.getPropertyExperience(ctx.organizationId, propertyId),
    deps.propertyApi.getPropertyTimezones(ctx.organizationId, [propertyId]),
  ])
  if (!profile?.displayName)
    throw portalError('brand_profile_missing', 'Set this property’s public name first.')
  if (profile.displayName.length > 100)
    throw portalError(
      'invalid_name',
      'Shorten this property’s public name to 100 characters.',
    )
  const locales = resolveNewPortalLocales({
    propertyDefaults: profile.defaultGuestLocales,
  })
  assertPersonalPublicationReady(
    {
      organizationId: ctx.organizationId,
      propertyId,
      portal: { id: '', name: profile.displayName, slug: '' },
      privateFeedbackThreshold: 3,
      skipPrivateRating: false,
      primaryGuestLocale: locales.primary,
      localeSet: [locales.primary, ...locales.additional],
      linktreeEnabled: true,
      timeZone: timezones.find((row) => row.id === propertyId)?.timezone ?? null,
      look: null,
      wording: Object.fromEntries(
        content.map((row) => [
          row.locale,
          {
            title: row.title,
            shortDescription: row.shortDescription,
            heroAlt: row.heroAltText,
            linktreeTitle: null,
          },
        ]),
      ),
      links: [],
    },
    displayNames,
  )
}

export function assertPersonalPublicationReady(
  source: PortalPublicationSource,
  displayNames: readonly string[] = [],
): void {
  const { blockers, content: publication } = resolvePortalPublication(source)
  const blocker = blockers[0]
  if (!blocker) {
    for (const name of displayNames)
      assertPersonalPortalPublicText({ kind: 'personal', name }, publication)
    return
  }
  if (blocker.code === 'primary_text_missing')
    throw portalError(
      'guest_wording_missing',
      'Write this property’s guest title and description before adding staff.',
    )
  if (blocker.code === 'language_pack_missing')
    throw portalError(
      'language_pack_missing',
      'This guest language is unavailable. Ask an account admin to choose another language.',
    )
  throw portalError(
    'time_zone_invalid',
    'Set a valid time zone in Property settings before adding staff.',
  )
}
