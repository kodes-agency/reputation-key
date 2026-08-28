import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import {
  MAX_GOOGLE_CREDENTIAL_ROUTING_TTL_MS,
  signGoogleCredentialRoutingDirectory,
  validateGoogleCredentialRoutingDirectory,
  type SignedGoogleCredentialRoutingDirectory,
} from '#/shared/routing/google-credential-routing'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'

export type GoogleCredentialRoutingDirectoryFacts = Readonly<{
  revision: number
  organizationHomes: ReadonlyArray<
    Readonly<{
      organizationId: string
      homeCellId: DataCellId
      authorityGeneration: number
    }>
  >
  connectionHomes: ReadonlyArray<
    Readonly<{
      organizationId: string
      connectionId: string
      homeCellId: DataCellId
      authorityGeneration: number
    }>
  >
  propertyTargets: ReadonlyArray<
    Readonly<{
      organizationId: string
      connectionId: string
      propertyId: string
      targetCellId: DataCellId
    }>
  >
  unhomedActiveConnectionCount: number
  unroutableActivePropertyCount: number
  authorityConflictCount: number
}>

/** The implementation must lock revision state and persist the built value atomically. */
export type GoogleCredentialRoutingDirectoryPublicationStore = Readonly<{
  publishNext(
    build: (
      facts: GoogleCredentialRoutingDirectoryFacts,
    ) => SignedGoogleCredentialRoutingDirectory,
  ): Promise<SignedGoogleCredentialRoutingDirectory>
  loadCurrent(): Promise<SignedGoogleCredentialRoutingDirectory | null>
}>

function sortBy<T>(entries: readonly T[], key: (entry: T) => string): T[] {
  return [...entries].sort((left, right) => key(left).localeCompare(key(right)))
}

export function createGoogleCredentialRoutingDirectoryPublisher(
  deps: Readonly<{
    store: GoogleCredentialRoutingDirectoryPublicationStore
    keys: VersionedHmacKeyring
    nowMs: () => number
    ttlMs: number
    isAcceptingCell?: (cellId: string) => boolean
  }>,
): () => Promise<SignedGoogleCredentialRoutingDirectory> {
  if (
    !Number.isSafeInteger(deps.ttlMs) ||
    deps.ttlMs < 1 ||
    deps.ttlMs > MAX_GOOGLE_CREDENTIAL_ROUTING_TTL_MS
  ) {
    throw new Error('Google credential routing TTL is invalid')
  }
  return async () => {
    const before = await deps.store.loadCurrent()
    const nowMs = deps.nowMs()
    const published = await deps.store.publishNext((facts) => {
      if (
        facts.unhomedActiveConnectionCount !== 0 ||
        facts.unroutableActivePropertyCount !== 0 ||
        facts.authorityConflictCount !== 0
      ) {
        throw new Error('Google credential routing facts are incomplete')
      }
      const signed = signGoogleCredentialRoutingDirectory(
        {
          contractVersion: 'v1',
          revision: facts.revision,
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
          issuedAtMs: nowMs,
          expiresAtMs: nowMs + deps.ttlMs,
          organizationHomes: sortBy(
            facts.organizationHomes,
            (entry) => entry.organizationId,
          ),
          connectionHomes: sortBy(
            facts.connectionHomes,
            (entry) => `${entry.organizationId}\0${entry.connectionId}`,
          ),
          propertyTargets: sortBy(
            facts.propertyTargets,
            (entry) =>
              `${entry.organizationId}\0${entry.connectionId}\0${entry.propertyId}`,
          ),
        },
        deps.keys,
      )
      const validation = validateGoogleCredentialRoutingDirectory(signed, {
        keys: deps.keys,
        nowMs,
        minimumRevision: facts.revision,
        isAcceptingCell: deps.isAcceptingCell ?? isDataCellAccepting,
      })
      if (!validation.ok) {
        throw new Error(
          `Google credential routing directory is invalid: ${validation.code}`,
        )
      }
      return signed
    })
    if (before && published.revision <= before.revision) {
      throw new Error('Google credential routing revision did not advance')
    }
    return published
  }
}
