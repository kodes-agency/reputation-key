// Integration context — Google Business Profile API adapter
// Per architecture: factory function returning GbpApiPort.
// Handles account listing, location listing, fetching, and review retrieval.

import { z } from 'zod'
import type { GbpApiPort, GbpAccount } from '../../application/ports/gbp-api.port'
import type { GbpLocation } from '../../domain/types'
import { createGbpApiError } from '../../domain/gbp-api-error'
import type { GbpApiErrorKind } from '../../domain/gbp-api-error'
import { trace } from '#/shared/observability/trace'

/**
 * Classifies a raw GBP HTTP status into a domain-level error kind.
 * The HTTP status never crosses into the domain/application layers (cc-errors §13).
 * 401 → auth_failed, 403 → permission_denied, 429 → rate_limited, everything else
 * (5xx, unexpected 4xx) → upstream_error. `parse_error` is produced separately when
 * a response body fails schema validation.
 */
const classifyHttpStatus = (status: number): GbpApiErrorKind => {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

// GBP API response schemas — validate at the external boundary
const gbpListAccountsResponseSchema = z.object({
  accounts: z.array(z.record(z.string(), z.unknown())).default([]),
  nextPageToken: z.string().optional(),
})
const gbpListLocationsResponseSchema = z.object({
  locations: z.array(z.record(z.string(), z.unknown())).default([]),
  nextPageToken: z.string().optional(),
})
const gbpLocationResponseSchema = z.record(z.string(), z.unknown())
const gbpBatchGetReviewsResponseSchema = z.object({
  locationReviews: z
    .array(z.object({ name: z.string(), reviews: z.unknown() }))
    .default([]),
  nextPageToken: z.string().optional(),
})

const GBP_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'

export const createGbpApiAdapter = (): GbpApiPort => {
  const listAccounts = async (
    accessToken: string,
  ): Promise<ReadonlyArray<GbpAccount>> => {
    const allAccounts: GbpAccount[] = []
    let nextPageToken: string | undefined

    do {
      const params = new URLSearchParams({ pageSize: '100' })
      if (nextPageToken) params.set('pageToken', nextPageToken)

      const url = `${GBP_API_BASE}/accounts?${params.toString()}`
      const response = await trace('gbpApi.listAccounts', () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      )
      if (!response.ok) {
        const errorText = await response.text()
        throw createGbpApiError(
          'listAccounts',
          classifyHttpStatus(response.status),
          errorText,
        )
      }

      const data = gbpListAccountsResponseSchema.parse(await response.json())
      const accounts = data.accounts || []
      allAccounts.push(...accounts.map(mapGbpAccount))
      nextPageToken = data.nextPageToken || undefined
    } while (nextPageToken)

    return allAccounts
  }

  const listLocations = async (
    accessToken: string,
    accountName: string,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    const allLocations: GbpLocation[] = []
    let nextPageToken: string | undefined

    do {
      const params = new URLSearchParams({
        pageSize: '100',
        readMask: 'name,title,storefrontAddress,categories,latlng',
      })
      if (nextPageToken) params.set('pageToken', nextPageToken)

      const url = `${GBP_API_BASE}/accounts/${accountName}/locations?${params.toString()}`
      const response = await trace('gbpApi.listLocations', () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      )
      if (!response.ok) {
        const errorText = await response.text()
        throw createGbpApiError(
          'listLocations',
          classifyHttpStatus(response.status),
          errorText,
        )
      }

      const data = gbpListLocationsResponseSchema.parse(await response.json())
      const locations = data.locations || []
      allLocations.push(...locations.map(mapGbpLocation))
      nextPageToken = data.nextPageToken || undefined
    } while (nextPageToken)

    return allLocations
  }

  const getLocation = async (
    accessToken: string,
    locationName: string,
  ): Promise<GbpLocation> => {
    const url = `${GBP_API_BASE}/${locationName}`
    const response = await trace('gbpApi.getLocation', () =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    )
    if (!response.ok) {
      const errorText = await response.text()
      throw createGbpApiError(
        'getLocation',
        classifyHttpStatus(response.status),
        errorText,
      )
    }

    const location = gbpLocationResponseSchema.parse(await response.json())
    return mapGbpLocation(location)
  }

  const batchGetReviews = async (
    accessToken: string,
    accountName: string,
    locationNames: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>> => {
    const url = `${GBP_API_BASE}/accounts/${accountName}/locations:batchGetReviews`
    const response = await trace('gbpApi.batchGetReviews', () =>
      fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationNames,
          pageSize: 100,
        }),
      }),
    )
    if (!response.ok) {
      const errorText = await response.text()
      throw createGbpApiError(
        'batchGetReviews',
        classifyHttpStatus(response.status),
        errorText,
      )
    }

    const data = gbpBatchGetReviewsResponseSchema.parse(await response.json())
    const reviewResponses = data.locationReviews || []

    return reviewResponses.map((rr: { name: string; reviews: unknown }) => ({
      locationName: rr.name,
      reviews: rr.reviews,
    }))
  }

  return {
    listAccounts,
    listLocations,
    getLocation,
    batchGetReviews,
  }
}

function mapGbpAccount(account: unknown): GbpAccount {
  if (!account || typeof account !== 'object') {
    throw createGbpApiError('mapAccount', 'parse_error', 'Invalid GBP account data')
  }

  const acc = account as Record<string, unknown>
  const name = acc.name as string | undefined

  if (!name) {
    throw createGbpApiError(
      'mapAccount',
      'parse_error',
      'GBP account missing required field: name',
    )
  }

  const accountName = name.split('/')[1]
  if (!accountName) {
    throw createGbpApiError(
      'mapAccount',
      'parse_error',
      `GBP account has invalid name format: ${name}`,
    )
  }

  const roleInfo = acc.roleInfo as Record<string, unknown> | undefined
  return {
    name,
    accountName,
    type: acc.type as string,
    role: (roleInfo?.name as string | undefined) ?? null,
  }
}

function parseLocationName(loc: Record<string, unknown>): {
  name: string
  gbpPlaceId: string
} {
  const name = loc.name as string | undefined
  if (!name) {
    throw createGbpApiError(
      'mapLocation',
      'parse_error',
      'GBP location missing required field: name',
    )
  }
  const gbpPlaceId = name.split('/').pop()
  if (!gbpPlaceId) {
    throw createGbpApiError(
      'mapLocation',
      'parse_error',
      `GBP location has invalid name format: ${name}`,
    )
  }
  return { name, gbpPlaceId }
}

function parseAddress(loc: Record<string, unknown>): string | null {
  const storefrontAddress = loc.storefrontAddress as Record<string, unknown> | undefined
  const addressLines = storefrontAddress?.addressLines as
    | ReadonlyArray<string>
    | undefined
  if (!addressLines || addressLines.length === 0) return null

  const postalCode = (storefrontAddress?.postalCode as string | undefined) ?? ''
  const locality = (storefrontAddress?.locality as string | undefined) ?? ''
  const administrativeArea =
    (storefrontAddress?.administrativeArea as string | undefined) ?? ''

  return `${addressLines.join(', ')}, ${locality} ${administrativeArea} ${postalCode}`.trim()
}

/** ISO country from GBP storefrontAddress.regionCode (CLDR/ISO 3166-1 alpha-2). */
function parseCountryCode(loc: Record<string, unknown>): string | null {
  const storefrontAddress = loc.storefrontAddress as Record<string, unknown> | undefined
  const raw = storefrontAddress?.regionCode
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

function parseCoordinates(loc: Record<string, unknown>): {
  latitude: number | null
  longitude: number | null
} {
  const latlng = loc.latlng as Record<string, unknown> | undefined
  return {
    latitude: (latlng?.latitude as number | undefined) ?? null,
    longitude: (latlng?.longitude as number | undefined) ?? null,
  }
}

function mapGbpLocation(location: unknown): GbpLocation {
  if (!location || typeof location !== 'object') {
    throw createGbpApiError('mapLocation', 'parse_error', 'Invalid GBP location data')
  }

  const loc = location as Record<string, unknown>
  const { name, gbpPlaceId } = parseLocationName(loc)
  const { latitude, longitude } = parseCoordinates(loc)

  const categories = loc.categories as Record<string, unknown> | undefined
  const primaryCategory = categories?.primaryCategory as
    | Record<string, unknown>
    | undefined

  return {
    name,
    gbpPlaceId,
    businessName: loc.title as string,
    address: parseAddress(loc),
    primaryCategory: (primaryCategory?.displayName as string | undefined) ?? null,
    latitude,
    longitude,
    countryCode: parseCountryCode(loc),
  }
}
