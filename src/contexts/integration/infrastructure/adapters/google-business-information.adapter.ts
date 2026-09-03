import { z } from 'zod/v4'
import type {
  GbpLocationCandidate,
  GbpLocationVerification,
  GoogleBusinessInformationPort,
} from '../../application/google-provider-contract'
import type { GoogleAuthorizedProviderExecutor } from '../../application/ports/google-authorized-provider-executor.port'
import { createGbpApiError } from '../../domain/gbp-api-error'
import { executeGoogleProviderJson } from './google-provider-adapter'
import {
  parseGoogleProviderResourceSuffix,
  validateGoogleProviderSuffix,
} from './google-resource-suffix'
import { normalizeGoogleReviewDestination } from '#/shared/domain/google-review-destination'

const boundedDisplayField = z.string().min(1).max(4_096)
const storefrontAddressSchema = z
  .object({
    addressLines: z.array(boundedDisplayField).max(10).optional(),
    locality: boundedDisplayField.optional(),
    administrativeArea: boundedDisplayField.optional(),
    postalCode: boundedDisplayField.optional(),
    regionCode: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
  })
  .passthrough()

const locationSchema = z
  .object({
    name: z.string().min(1).max(520),
    title: boundedDisplayField,
    storefrontAddress: storefrontAddressSchema.optional(),
    categories: z
      .object({
        primaryCategory: z
          .object({ displayName: boundedDisplayField })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    metadata: z
      .object({
        newReviewUri: z.string().min(1).max(2_048).optional(),
        hasVoiceOfMerchant: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const locationsPageSchema = z
  .object({
    locations: z.array(locationSchema).max(100).optional(),
    nextPageToken: z.string().min(1).max(2_048).optional(),
  })
  .passthrough()

function addressFrom(
  value: z.infer<typeof storefrontAddressSchema> | undefined,
): string | null {
  if (!value) return null
  const parts = [
    ...(value.addressLines ?? []),
    value.locality,
    value.administrativeArea,
    value.postalCode,
  ].filter((part): part is string => typeof part === 'string')
  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * Google omits `hasVoiceOfMerchant` entirely when a location does not have it,
 * exactly as it omits a zero review total — so an absent flag is indistinguishable
 * from a field this account is not served at all. Reading absence as a denial
 * would therefore risk withholding every location the moment Google changed what
 * it returns. A page only earns the right to call absence "unverified" once some
 * location on it proves the flag is being served.
 */
function pageVerificationIsObservable(
  raws: readonly z.infer<typeof locationSchema>[],
): boolean {
  return raws.some((raw) => raw.metadata?.hasVoiceOfMerchant === true)
}

function verificationOf(
  raw: z.infer<typeof locationSchema>,
  observable: boolean,
): GbpLocationVerification {
  if (raw.metadata?.hasVoiceOfMerchant === true) return 'verified'
  return observable ? 'unverified' : 'unknown'
}

function parseLocation(
  raw: z.infer<typeof locationSchema>,
  accountId: string,
  accountDisplayName: string,
  verification: GbpLocationVerification,
): GbpLocationCandidate | null {
  const locationId = parseGoogleProviderResourceSuffix(raw.name, 'locations/')
  if (!locationId) return null
  const googleReviewUri = raw.metadata?.newReviewUri
    ? normalizeGoogleReviewDestination(raw.metadata.newReviewUri)
    : null
  if (raw.metadata?.newReviewUri && !googleReviewUri) return null
  return Object.freeze({
    binding: Object.freeze({ accountId, locationId }),
    accountDisplayName,
    businessName: raw.title,
    address: addressFrom(raw.storefrontAddress),
    primaryCategory: raw.categories?.primaryCategory?.displayName ?? null,
    countryCode: raw.storefrontAddress?.regionCode?.toUpperCase() ?? null,
    googleReviewUri,
    verification,
  })
}

export const createGoogleBusinessInformationAdapter = (
  deps: Readonly<{
    executor: GoogleAuthorizedProviderExecutor
    nowMs?: () => number
  }>,
): GoogleBusinessInformationPort => {
  const nowMs = deps.nowMs ?? Date.now
  return Object.freeze({
    listLocations: async (input) => {
      if (
        !validateGoogleProviderSuffix(input.accountId) ||
        input.accountDisplayName.length < 1 ||
        input.accountDisplayName.length > 1_024
      ) {
        throw createGbpApiError('listLocations', 'parse_error')
      }
      const raw = await executeGoogleProviderJson({
        operation: 'listLocations',
        descriptor: {
          routeKey: 'business-information.locations.list',
          accessToken: input.accessToken,
          accountId: input.accountId,
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        },
        authorization: input.authorization,
        executor: deps.executor,
        nowMs,
        signal: input.signal,
      })
      const parsed = locationsPageSchema.safeParse(raw)
      if (!parsed.success) {
        throw createGbpApiError('listLocations', 'parse_error')
      }
      const items: GbpLocationCandidate[] = []
      const seen = new Set<string>()
      const rawLocations = parsed.data.locations ?? []
      const observable = pageVerificationIsObservable(rawLocations)
      for (const rawLocation of rawLocations) {
        const location = parseLocation(
          rawLocation,
          input.accountId,
          input.accountDisplayName,
          verificationOf(rawLocation, observable),
        )
        if (!location || seen.has(location.binding.locationId)) {
          throw createGbpApiError('listLocations', 'parse_error')
        }
        seen.add(location.binding.locationId)
        items.push(location)
      }
      return Object.freeze({
        items: Object.freeze(items),
        nextPageToken: parsed.data.nextPageToken ?? null,
      })
    },
  })
}
