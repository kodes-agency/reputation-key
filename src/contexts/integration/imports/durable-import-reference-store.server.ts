import type { Database } from '#/shared/db'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { GoogleImportReferenceStore } from './durable-import-reference-store.port.server'
import { createDurableImportReferenceAccounts } from './durable-import-reference-accounts.server'
import { createDurableImportReferenceCandidates } from './durable-import-reference-candidates.server'
import { createDurableImportReferenceClaims } from './durable-import-reference-claims.server'
import { durableImportAuthorizationSchema } from './durable-import-reference-codec.server'
import { createDurableImportReferenceInvalidation } from './durable-import-reference-invalidation.server'
import { createDurableImportReferenceKeys } from './durable-import-reference-keys.server'
import {
  createDurableImportReferencePublisher,
  durableImportLeaseFailure,
} from './durable-import-reference-publication.server'
import { createDurableImportReferenceReader } from './durable-import-reference-reader.server'

/**
 * PostgreSQL-backed pre-confirmation discovery handoff. Unlike the legacy
 * Redis page index, record count grows linearly and has no fleet-size cap;
 * each page is an atomic checkpoint and an authorized browser may resume it
 * for up to 24 hours. Confirmation still claims at most 100 rows at a time.
 */
export const createDurableGoogleImportReferenceStore = (
  deps: Readonly<{
    db: Database
    leasePrincipalKeys: VersionedHmacKeyring
    leases: ProviderAuthorizationLeaseService
    clock: () => Date
    random?: (bytes: number) => Buffer
  }>,
): GoogleImportReferenceStore => {
  const keys = createDurableImportReferenceKeys({
    ...(deps.random ? { random: deps.random } : {}),
  })
  const reader = createDurableImportReferenceReader({
    db: deps.db,
    keys,
    clock: deps.clock,
  })
  const publisher = createDurableImportReferencePublisher({
    db: deps.db,
    keys,
    leasePrincipalKeys: deps.leasePrincipalKeys,
    leases: deps.leases,
    clock: deps.clock,
  })
  const accounts = createDurableImportReferenceAccounts({ publisher, reader })
  const candidates = createDurableImportReferenceCandidates({
    publisher,
    reader,
    ...(deps.random ? { random: deps.random } : {}),
  })
  const claims = createDurableImportReferenceClaims({
    db: deps.db,
    keys,
    clock: deps.clock,
  })
  const invalidation = createDurableImportReferenceInvalidation({
    db: deps.db,
    keys,
    clock: deps.clock,
  })

  return Object.freeze({
    ...accounts,
    ...candidates,
    ...claims,
    ...invalidation,
    renewLease: async (input) => {
      const authorization = durableImportAuthorizationSchema.safeParse(
        input.authorization,
      )
      if (!authorization.success) return { ok: false, code: 'malformed' }
      const renewed = await deps.leases.renew({
        leaseRef: input.leaseRef,
        ...publisher.binding(authorization.data),
        nowMs: deps.clock().getTime(),
      })
      return renewed.ok
        ? { ok: true, lease: renewed.lease }
        : durableImportLeaseFailure(renewed.code)
    },
  })
}
