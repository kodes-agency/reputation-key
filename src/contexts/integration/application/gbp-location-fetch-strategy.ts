// Integration context — GbpLocationFetchStrategy
// Deep module: lists GBP locations for an access token. Callers no longer know about:
//   - account iteration and the accounts/ resource-name mangling
//   - gbpPlaceId dedupe across overlapping accounts
//   - the wildcard '-' account fallback (no accounts, or retryable failure)
//   - the retry decision table (decideFetchRecovery: error kind → propagate vs fallback)

import type { GbpApiPort, GbpAccount } from './ports/gbp-api.port'
import type { GbpLocation } from '../domain/types'
import { isGbpApiError, type GbpApiErrorKind } from '../domain/gbp-api-error'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type GbpLocationFetchDeps = Readonly<{
  gbpApi: GbpApiPort
  logger: LoggerPort
}>

/**
 * Observability context accepted by the fetch port. BQC-7.3: retained for
 * signature stability — tenant identifiers are never logged (the wildcard
 * failure warn is content-free).
 */
export type FetchLogContext = Readonly<{
  connectionId: string
  organizationId: string
}>

/** Wildcard account name — lists locations across all of the user's accounts. */
const WILDCARD_ACCOUNT = '-'

// ── Retry decision table (pure) ─────────────────────────────────
//
//   error kind                       → recovery
//   auth_failed (401)                → propagate
//   permission_denied (403)          → propagate
//   rate_limited (429)               → propagate
//   upstream_error (5xx)             → wildcard-fallback
//   parse_error (bad response shape) → wildcard-fallback
//   not a GbpApiError                → wildcard-fallback
//
// Kinds are classified at the adapter boundary, never the raw HTTP status
// (cc-errors §13).

const NON_RETRYABLE_KIND: Partial<Record<GbpApiErrorKind, true>> = {
  auth_failed: true,
  permission_denied: true,
  rate_limited: true,
}

export type FetchRecovery = 'propagate' | 'wildcard-fallback'

export function decideFetchRecovery(err: unknown): FetchRecovery {
  return isGbpApiError(err) && NON_RETRYABLE_KIND[err.kind]
    ? 'propagate'
    : 'wildcard-fallback'
}

// ── Strategy ────────────────────────────────────────────────────

export type GbpLocationFetchStrategy = Readonly<{
  fetchLocations: (
    accessToken: string,
    logContext: FetchLogContext,
  ) => Promise<ReadonlyArray<GbpLocation>>
}>

export const createGbpLocationFetchStrategy = (
  deps: GbpLocationFetchDeps,
): GbpLocationFetchStrategy => {
  /** Qualify a bare location resource name with its account prefix. */
  const qualifyLocationName = (loc: GbpLocation, accountName: string): GbpLocation => {
    const name = loc.name.startsWith('accounts/')
      ? loc.name
      : `accounts/${accountName}/${loc.name}`
    return { ...loc, name }
  }

  /** Query all accounts and merge — dedupe by gbpPlaceId (overlapping accounts share locations). */
  const mergeAccountLocations = async (
    accessToken: string,
    accounts: ReadonlyArray<GbpAccount>,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    const seen = new Map<string, GbpLocation>()
    for (const account of accounts) {
      const accountLocations = await deps.gbpApi.listLocations(
        accessToken,
        account.accountName,
      )
      for (const loc of accountLocations) {
        if (!seen.has(loc.gbpPlaceId)) {
          seen.set(loc.gbpPlaceId, qualifyLocationName(loc, account.accountName))
        }
      }
    }
    return [...seen.values()]
  }

  /** Account iteration path — wildcard when the user has no explicit accounts. */
  const fetchViaAccounts = async (
    accessToken: string,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    const accounts = await deps.gbpApi.listAccounts(accessToken)
    if (accounts.length === 0) {
      return deps.gbpApi.listLocations(accessToken, WILDCARD_ACCOUNT)
    }
    return mergeAccountLocations(accessToken, accounts)
  }

  /** Wildcard fallback — on failure, warn and rethrow the ORIGINAL error. */
  const fetchViaWildcard = async (
    accessToken: string,
    originalErr: unknown,
  ): Promise<ReadonlyArray<GbpLocation>> => {
    try {
      return await deps.gbpApi.listLocations(accessToken, WILDCARD_ACCOUNT)
    } catch (err) {
      deps.logger.warn({ err }, 'Wildcard GBP location listing also failed')
      throw originalErr
    }
  }

  return {
    // BQC-7.3: the log context (tenant identifiers) is accepted for signature
    // stability but never logged — the wildcard warn is content-free.
    fetchLocations: async (accessToken, _logContext) => {
      try {
        return await fetchViaAccounts(accessToken)
      } catch (originalErr) {
        if (decideFetchRecovery(originalErr) === 'propagate') {
          throw originalErr
        }
        return fetchViaWildcard(accessToken, originalErr)
      }
    },
  }
}
