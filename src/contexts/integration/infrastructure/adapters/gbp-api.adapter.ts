// Integration context — Google Business Profile API adapter
// Per architecture: factory function returning GbpApiPort.
// Handles location listing, fetching, and review retrieval.

import type { GbpApiPort } from '../../application/ports/gbp-api.port'
import type { GbpLocation } from '../../domain/types'

const GBP_API_BASE = 'https://mybusiness.googleapis.com/v4'

export const createGbpApiAdapter = (): GbpApiPort => {
  const listLocations = async (
    accessToken: string,
    accountName: string,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    const url = `${GBP_API_BASE}/${accountName}/locations?pageSize=100`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GBP API listLocations failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const locations = data.locations || []

    return locations.map(mapGbpLocation)
  }

  const getLocation = async (
    accessToken: string,
    _accountName: string,
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
      throw new Error(`GBP API getLocation failed: ${response.status} ${errorText}`)
    }

    const location = await response.json()
    return mapGbpLocation(location)
  }

  const batchGetReviews = async (
    accessToken: string,
    accountName: string,
    locationNames: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>> => {
    const url = `${GBP_API_BASE}/${accountName}/locations:batchGetReviews`
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
      throw new Error(`GBP API batchGetReviews failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const reviewResponses = data.locationReviews || []

    return reviewResponses.map((rr: { name: string; reviews: unknown }) => ({
      locationName: rr.name,
      reviews: rr.reviews,
    }))
  }

  return {
    listLocations,
    getLocation,
    batchGetReviews,
  }
}

function mapGbpLocation(location: unknown): GbpLocation {
  if (!location || typeof location !== 'object') {
    throw new Error('Invalid GBP location data')
  }

  const loc = location as Record<string, unknown>
  const name = loc.name as string | undefined
  const storeCode = loc.storeCode as string | undefined

  if (!name || !storeCode) {
    throw new Error('GBP location missing required fields: name or storeCode')
  }

  const locationInfo = loc.locationInfo as Record<string, unknown> | undefined
  const address = locationInfo?.addressLines as ReadonlyArray<string> | undefined
  const postalCode = locationInfo?.postalCode as string | undefined
  const locality = locationInfo?.locality as string | undefined
  const administrativeArea = locationInfo?.administrativeArea as string | undefined
  const primaryCategory = loc.primaryCategory as Record<string, unknown> | undefined
  const categoryName = primaryCategory?.displayName as string | undefined

  const latlng = loc.latlng as Record<string, unknown> | undefined
  const latitude = latlng?.latitude as number | undefined
  const longitude = latlng?.longitude as number | undefined

  return {
    name,
    gbpPlaceId: storeCode,
    businessName: loc.title as string,
    address:
      address && address.length > 0
        ? `${address.join(', ')}, ${locality || ''} ${administrativeArea || ''} ${postalCode || ''}`.trim()
        : null,
    primaryCategory: categoryName || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  }
}
