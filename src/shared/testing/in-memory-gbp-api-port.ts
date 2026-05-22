// In-memory GbpApiPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GbpApiPort,
  GbpAccount,
} from '#/contexts/integration/application/ports/gbp-api.port'
import type { GbpLocation } from '#/contexts/integration/domain/types'
import type { GbpApiError } from '#/contexts/integration/domain/gbp-api-error'

// fallow-ignore-next-line unused-type
export type InMemoryGbpApiPort = GbpApiPort &
  Readonly<{
    setAccounts: (accounts: ReadonlyArray<GbpAccount>) => void
    setLocations: (accountName: string, locations: ReadonlyArray<GbpLocation>) => void
    setLocation: (locationName: string, location: GbpLocation) => void
    setError: (operation: string, error: Error | GbpApiError) => void
  }>

export const createInMemoryGbpApiPort = (): InMemoryGbpApiPort => {
  let accounts: ReadonlyArray<GbpAccount> = []
  const locationsByAccount = new Map<string, ReadonlyArray<GbpLocation>>()
  const locationsByName = new Map<string, GbpLocation>()
  const errors = new Map<string, Error | GbpApiError>()

  return {
    listAccounts: async (_accessToken) => {
      const err = errors.get('listAccounts')
      if (err) throw err
      return accounts
    },

    listLocations: async (_accessToken, accountName) => {
      const err = errors.get('listLocations')
      if (err) throw err
      if (accountName === '-') {
        return [...locationsByAccount.values()].flat()
      }
      return locationsByAccount.get(accountName) ?? []
    },

    getLocation: async (_accessToken, locationName) => {
      const err = errors.get('getLocation')
      if (err) throw err
      const location = locationsByName.get(locationName)
      if (!location) throw new Error(`Location not found: ${locationName}`)
      return location
    },

    batchGetReviews: async () => [],

    // ── Test-only helpers ───────────────────────────────────────────

    setAccounts: (a) => {
      accounts = a
    },

    setLocations: (accountName, locs) => {
      locationsByAccount.set(accountName, locs)
    },

    setLocation: (locationName, location) => {
      locationsByName.set(locationName, location)
    },

    setError: (operation, error) => {
      errors.set(operation, error)
    },
  }
}
