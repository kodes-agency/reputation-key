// In-memory GbpApiPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type {
  GbpApiPort,
  GbpApiAccount,
} from '#/contexts/integration/application/ports/gbp-api.port'
import type { GbpApiError } from '#/contexts/integration/domain/gbp-api-error'

export type InMemoryGbpApiPort = GbpApiPort &
  Readonly<{
    setAccounts: (accounts: ReadonlyArray<GbpApiAccount>) => void
    setError: (operation: string, error: Error | GbpApiError) => void
  }>

export const createInMemoryGbpApiPort = (): InMemoryGbpApiPort => {
  let accounts: ReadonlyArray<GbpApiAccount> = []
  const errors = new Map<string, Error | GbpApiError>()

  return {
    listAccounts: async (_accessToken) => {
      const err = errors.get('listAccounts')
      if (err) throw err
      return accounts
    },

    // ── Test-only helpers ───────────────────────────────────────────

    setAccounts: (a) => {
      accounts = a
    },

    setError: (operation, error) => {
      errors.set(operation, error)
    },
  }
}
