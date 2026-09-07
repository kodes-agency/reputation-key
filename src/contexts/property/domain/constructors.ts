// Property context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { Result, err, ok } from '#/shared/domain'
import { DEFAULT_PROPERTY_GOOGLE_PROFILE, type Property, type PropertyId } from './types'
import { propertyError, type PropertyError } from './errors'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
  normalizeCountryCode,
} from './rules'
import { isGoogleResourceSuffix } from './google-binding-contract'
import { verifiedGoogleReviewDestination } from './google-review-destination'

export type BuildPropertyInput = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  providedSlug?: string
  timezone: string
  defaultReplyLanguage?: string | null
  address?: string | null
  gbpLocationId?: string | null
  gbpAccountId?: string | null
  googleConnectionId?: GoogleConnectionId | null
  profileConfirmedAt?: Date | null
  profileConfirmedBy?: string | null
  googleReviewUri?: string | null
  /** Optional ISO country describing the Property's business location. */
  countryCode?: string | null
  countrySource?: string
  now: Date
}>

export const buildProperty = (
  input: BuildPropertyInput,
): Result<Property, PropertyError> => {
  const nameResult = validatePropertyName(input.name)
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const tz = validateTimezone(input.timezone)

  const countryResult =
    input.countryCode != null && input.countryCode !== ''
      ? normalizeCountryCode(input.countryCode)
      : ok<string | null, PropertyError>(null)

  const locationId = input.gbpLocationId ?? null
  const accountId = input.gbpAccountId ?? null
  const connectionId = input.googleConnectionId ?? null
  const validBinding =
    (locationId === null && accountId === null && connectionId === null) ||
    (locationId !== null &&
      isGoogleResourceSuffix(locationId) &&
      connectionId !== null &&
      (accountId === null || isGoogleResourceSuffix(accountId)))
  if (!validBinding) {
    return err(
      propertyError(
        'invalid_transition',
        'Google binding requires canonical bare account/location suffixes',
      ),
    )
  }
  const googleReviewDestination = input.googleReviewUri
    ? verifiedGoogleReviewDestination({
        uri: input.googleReviewUri,
        retrievedAt: input.now,
        sourceEpoch: 0,
        profileVersion: 1,
      })
    : DEFAULT_PROPERTY_GOOGLE_PROFILE.googleReviewDestination
  if (!googleReviewDestination) {
    return err(
      propertyError('invalid_transition', 'Google review destination is invalid'),
    )
  }

  return Result.combine([nameResult, slug, tz, countryResult]).map(
    ([validName, validSlug, validTz, countryCode]): Property => {
      return {
        id: input.id,
        organizationId: input.organizationId,
        name: validName,
        slug: validSlug,
        timezone: validTz,
        defaultReplyLanguage: input.defaultReplyLanguage ?? null,
        ...DEFAULT_PROPERTY_GOOGLE_PROFILE,
        address: input.address ?? null,
        gbpLocationId: locationId,
        gbpAccountId: accountId,
        googleConnectionId: connectionId,
        googleBindingState:
          connectionId === null
            ? 'unbound'
            : accountId === null
              ? 'account_confirmation_required'
              : 'active',
        profileSource:
          input.profileConfirmedAt && input.profileConfirmedBy
            ? 'tenant_confirmed'
            : 'legacy',
        profileConfirmedAt: input.profileConfirmedAt ?? null,
        profileConfirmedBy: input.profileConfirmedBy ?? null,
        googleReviewDestination,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
        lifecycleState: 'active',
        lifecycleReason: null,
        lifecycleStateChangedAt: input.now,
        purgeScheduledFor: null,
        lifecycleInitiatedBy: null,
        countryCode,
        countrySource:
          input.countrySource ?? (countryCode ? 'manual' : 'organization_default'),
        timezoneSource: 'legacy',
        timezoneResolvedAt: null,
        sourceEpoch: 0,
        responsibleManagerRevision: 1,
        // Property responsibility is explicit. Creation/access provenance is
        // not silently converted into a workflow-notification assignment.
        responsibilityNeededSince: input.now,
      }
    },
  )
}
