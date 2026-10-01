// Test-only sealed-address store. The in-memory Portal command store writes it
// where the PostgreSQL store writes `portal_tokens.encrypted_raw_token`, so an
// application test can walk issue, reveal, rotate and revoke without a database.

import type {
  AddressDownloadPurpose,
  PortalAddressRepository,
  RevealableAddress,
} from '#/contexts/portal/application/ports/portal-address.repository'
import { unbrand } from '#/shared/domain/ids'

export type RecordedAddressDownload = Readonly<{
  organizationId: string
  portalId: string
  tokenId: string
  downloadedBy: string
  purpose: AddressDownloadPurpose
  at: Date
}>

export type InMemoryPortalAddressRepo = PortalAddressRepository &
  Readonly<{
    /** What the command store does on issue and rotate. */
    store: (
      scope: Readonly<{ organizationId: string; portalId: string }>,
      address: RevealableAddress,
    ) => void
    /** What the command store does on rotate, revoke and delete. */
    clear: (scope: Readonly<{ organizationId: string; portalId: string }>) => void
    downloads: () => readonly RecordedAddressDownload[]
    sealedCount: () => number
  }>

const keyOf = (scope: Readonly<{ organizationId: string; portalId: string }>): string =>
  `${scope.organizationId}/${scope.portalId}`

export function createInMemoryPortalAddressRepo(): InMemoryPortalAddressRepo {
  const live = new Map<string, RevealableAddress>()
  const recorded: RecordedAddressDownload[] = []
  return {
    store: (scope, address) => {
      live.set(keyOf(scope), address)
    },
    clear: (scope) => {
      live.delete(keyOf(scope))
    },
    downloads: () => [...recorded],
    sealedCount: () => live.size,
    findRevealable: async (organizationId, portalId) =>
      live.get(
        keyOf({ organizationId: unbrand(organizationId), portalId: unbrand(portalId) }),
      ) ?? null,
    recordDownload: async (input) => {
      const scope = {
        organizationId: unbrand(input.organizationId),
        portalId: unbrand(input.portalId),
      }
      if (live.get(keyOf(scope))?.tokenId !== input.tokenId) return false
      recorded.push({
        ...scope,
        tokenId: input.tokenId,
        downloadedBy: unbrand(input.downloadedBy),
        purpose: input.purpose,
        at: input.at,
      })
      return true
    },
  }
}
