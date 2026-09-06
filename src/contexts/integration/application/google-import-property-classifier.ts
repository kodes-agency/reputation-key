import type { AuthContext } from '#/shared/domain/auth-context'
import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GbpLocationCandidate } from './google-provider-contract'
import type { ImportCandidateEligibility } from './google-import-v2-contract'
import type { ImportDiscoveryCandidate } from './ports/google-import-reference-store.port'
import type { GoogleImportPropertyClassifier } from './google-import-discovery'

const GOOGLE_PROVIDER_LOCATION_PAGE_SIZE = 100

export type GoogleImportPropertyDiscoveryView = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: 'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  connectionId: GoogleConnectionId | null
  accountId: string | null
  locationId: string | null
  sourceEpoch: number
  profileVersion: number
  name: string
  address: string | null
  countryCode: string | null
  timezone: string
  lifecycleState: string
  deletedAt: Date | null
}>

export type GoogleImportPropertyDiscoveryReader = (
  organizationId: OrganizationId,
  locationIds: readonly string[],
) => Promise<readonly GoogleImportPropertyDiscoveryView[]>

export type GoogleImportPropertyActionAuthorizer = (
  input: Readonly<{
    actor: AuthContext
    action: 'property.create' | 'property.read' | 'property.update'
    propertyId: PropertyId | null
  }>,
) => Promise<boolean>

function classificationFailure(): Error {
  return new Error('Google import Property classification failed')
}

function resultBase(candidate: GbpLocationCandidate) {
  return {
    accountId: candidate.binding.accountId,
    locationId: candidate.binding.locationId,
    accountDisplayName: candidate.accountDisplayName,
    businessName: candidate.businessName,
    address: candidate.address,
    primaryCategory: candidate.primaryCategory,
    countryCode: candidate.countryCode,
    googleReviewUri: candidate.googleReviewUri ?? null,
  }
}

/**
 * Eligibility for a location that maps to no existing Property. A listing
 * without Voice of Merchant serves neither reviews nor performance data, so a
 * Property created from it could only ever look broken.
 */
function creationEligibility(
  candidate: GbpLocationCandidate,
  canCreate: boolean,
): ImportCandidateEligibility {
  if (!canCreate) return { kind: 'unavailable' }
  if (candidate.verification === 'unverified') return { kind: 'verification_required' }
  return { kind: 'create' }
}

export function createGoogleImportPropertyClassifier(
  deps: Readonly<{
    readByLocationIds: GoogleImportPropertyDiscoveryReader
    isAllowed: GoogleImportPropertyActionAuthorizer
  }>,
): GoogleImportPropertyClassifier {
  return async (input) => {
    if (input.candidates.length > GOOGLE_PROVIDER_LOCATION_PAGE_SIZE) {
      throw classificationFailure()
    }
    // An account with no locations is a legitimate empty page. The binding
    // reader rejects an empty id list as an invalid binding, so classifying it
    // would surface "Locations unavailable" instead of an empty result.
    if (input.candidates.length === 0) return []
    const locationIds = input.candidates.map((candidate) => candidate.binding.locationId)
    if (new Set(locationIds).size !== locationIds.length) throw classificationFailure()

    const existing = await deps.readByLocationIds(input.actor.organizationId, locationIds)
    const byLocation = new Map<string, GoogleImportPropertyDiscoveryView>()
    for (const property of existing) {
      if (
        property.organizationId !== input.actor.organizationId ||
        property.deletedAt !== null ||
        property.locationId === null ||
        byLocation.has(property.locationId) ||
        !locationIds.includes(property.locationId)
      ) {
        throw classificationFailure()
      }
      byLocation.set(property.locationId, property)
    }

    const canCreate = await deps.isAllowed({
      actor: input.actor,
      action: 'property.create',
      propertyId: null,
    })

    return Promise.all(
      input.candidates.map(async (candidate): Promise<ImportDiscoveryCandidate> => {
        const base = resultBase(candidate)
        const property = byLocation.get(candidate.binding.locationId)
        if (!property) {
          return {
            ...base,
            eligibility: creationEligibility(candidate, canCreate),
            expectedSourceEpoch: null,
            expectedProfileVersion: null,
            affectedPropertyId: null,
          }
        }

        const protectedFacts = {
          expectedSourceEpoch: property.sourceEpoch,
          expectedProfileVersion: property.profileVersion,
          affectedPropertyId: property.propertyId,
        }
        if (
          property.lifecycleState !== 'active' ||
          property.state === 'unbound' ||
          property.state === 'account_confirmation_required'
        ) {
          return {
            ...base,
            eligibility: { kind: 'unavailable' },
            ...protectedFacts,
          }
        }

        const canRead = await deps.isAllowed({
          actor: input.actor,
          action: 'property.read',
          propertyId: property.propertyId,
        })
        if (!canRead) {
          return {
            ...base,
            eligibility: { kind: 'unavailable' },
            ...protectedFacts,
          }
        }

        if (property.state === 'active') {
          const sameBinding =
            property.connectionId === input.connectionId &&
            property.accountId === candidate.binding.accountId
          return {
            ...base,
            eligibility: sameBinding
              ? { kind: 'already_imported', propertyId: property.propertyId }
              : { kind: 'active_binding_conflict' },
            ...protectedFacts,
          }
        }

        const canUpdate = await deps.isAllowed({
          actor: input.actor,
          action: 'property.update',
          propertyId: property.propertyId,
        })
        return {
          ...base,
          eligibility: canUpdate
            ? {
                kind: 'relink',
                propertyId: property.propertyId,
                profile: {
                  name: property.name,
                  address: property.address,
                  countryCode: property.countryCode,
                  timezone: property.timezone,
                  profileVersion: property.profileVersion,
                },
              }
            : { kind: 'unavailable' },
          ...protectedFacts,
        }
      }),
    )
  }
}
