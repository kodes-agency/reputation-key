// Integration context — Google Business Profile API adapter
// Per architecture: factory function returning GbpApiPort.
// Handles account listing, location listing, fetching, and review retrieval.

import type { GbpApiPort, GbpAccount } from '../../application/ports/gbp-api.port'
import type { GbpLocation } from '../../domain/types'
import { createGbpApiError } from '../../domain/gbp-api-error'

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
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw createGbpApiError('listAccounts', response.status, errorText)
      }

      const data = await response.json()
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
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw createGbpApiError('listLocations', response.status, errorText)
      }

      const data = await response.json()
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
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw createGbpApiError('getLocation', response.status, errorText)
    }

    const location = await response.json()
    return mapGbpLocation(location)
  }

  const batchGetReviews = async (
    accessToken: string,
    accountName: string,
    locationNames: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>> => {
    const url = `${GBP_API_BASE}/accounts/${accountName}/locations:batchGetReviews`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationNames,
        pageSize: 100,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw createGbpApiError('batchGetReviews', response.status, errorText)
    }

    const data = await response.json()
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
    throw createGbpApiError('mapAccount', 500, 'Invalid GBP account data')
  }

  const acc = account as Record<string, unknown>
  const name = acc.name as string | undefined

  if (!name) {
    throw createGbpApiError('mapAccount', 500, 'GBP account missing required field: name')
  }

  const accountName = name.split('/')[1]
  if (!accountName) {
    throw createGbpApiError(
      'mapAccount',
      500,
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

function mapGbpLocation(location: unknown): GbpLocation {
  if (!location || typeof location !== 'object') {
    throw createGbpApiError('mapLocation', 500, 'Invalid GBP location data')
  }

  const loc = location as Record<string, unknown>
  const name = loc.name as string | undefined

  if (!name) {
    throw createGbpApiError(
      'mapLocation',
      500,
      'GBP location missing required field: name',
    )
  }

  const locationId = name.split('/').pop()
  if (!locationId) {
    throw createGbpApiError(
      'mapLocation',
      500,
      `GBP location has invalid name format: ${name}`,
    )
  }

  const storefrontAddress = loc.storefrontAddress as Record<string, unknown> | undefined
  const addressLines = storefrontAddress?.addressLines as
    | ReadonlyArray<string>
    | undefined
  const postalCode = storefrontAddress?.postalCode as string | undefined
  const locality = storefrontAddress?.locality as string | undefined
  const administrativeArea = storefrontAddress?.administrativeArea as string | undefined
  const categories = loc.categories as Record<string, unknown> | undefined
  const primaryCategory = categories?.primaryCategory as
    | Record<string, unknown>
    | undefined
  const categoryName = primaryCategory?.displayName as string | undefined

  const latlng = loc.latlng as Record<string, unknown> | undefined
  const latitude = latlng?.latitude as number | undefined
  const longitude = latlng?.longitude as number | undefined

  return {
    name,
    gbpPlaceId: locationId,
    businessName: loc.title as string,
    address:
      addressLines && addressLines.length > 0
        ? `${addressLines.join(', ')}, ${locality || ''} ${administrativeArea || ''} ${postalCode || ''}`.trim()
        : null,
    primaryCategory: categoryName || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  }
}
