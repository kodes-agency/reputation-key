import type { Database } from '#/shared/db'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import {
  createProviderAuthorizationPrincipalBinding,
  providerAuthorizationFenceSha256,
} from '#/shared/provider-ephemeral/authorization-binding'
import type {
  ProviderAuthorizationLeaseRejection,
  ProviderAuthorizationLeaseService,
} from '#/shared/provider-ephemeral/authorization-lease'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type {
  ImportDiscoveryAuthorization,
  ImportReferenceResult,
} from '../application/ports/google-import-reference-store.port'
import { durableImportAuthorizationSchema } from './durable-import-reference-codec'
import {
  invalidationScopesFor,
  type DurableImportReferenceAudience,
  type DurableImportReferenceKeys,
} from './durable-import-reference-keys'
import {
  DurableImportReferenceCollision,
  DurableImportReferenceInvalidated,
  insertDurableImportRecords,
  type DurableImportRecord,
} from './durable-import-reference-persistence'

const DURABLE_GOOGLE_IMPORT_DISCOVERY_TTL_MS = 24 * 60 * 60_000
const MAX_PAGE_BYTES = 1024 * 1024
const MAX_PUBLICATION_ATTEMPTS = 3

export const durableImportLeaseFailure = (
  code: ProviderAuthorizationLeaseRejection,
): ImportReferenceResult<never> => {
  if (code === 'malformed') return { ok: false, code: 'malformed' }
  if (code === 'not_found') return { ok: false, code: 'not_found' }
  if (code === 'expired') return { ok: false, code: 'expired' }
  if (
    code === 'principal_mismatch' ||
    code === 'authorization_denied' ||
    code === 'authorization_changed'
  ) {
    return { ok: false, code: 'binding_mismatch' }
  }
  return { ok: false, code: 'runtime_unavailable' }
}

export type DurableReferenceDraft = Readonly<{
  handle: string
  record: DurableImportRecord
}>

export const createDurableImportReferencePublisher = (
  deps: Readonly<{
    db: Database
    keys: DurableImportReferenceKeys
    leasePrincipalKeys: VersionedHmacKeyring
    leases: ProviderAuthorizationLeaseService
    clock: () => Date
  }>,
) => {
  const binding = (authorization: ImportDiscoveryAuthorization) => ({
    ...createProviderAuthorizationPrincipalBinding({
      keys: deps.leasePrincipalKeys,
      audience: 'google-import-authorization-lease-principal-v1',
      organizationId: authorization.organizationId,
      userId: authorization.userId,
      connectionId: authorization.connectionId,
    }),
    authorizationFenceSha256: providerAuthorizationFenceSha256(authorization),
  })

  const publish = async <T>(
    input: Readonly<{
      authorization: ImportDiscoveryAuthorization
      contentDeadlineMs: number
      propertyIds?: readonly string[]
      build: (
        input: Readonly<{
          lease: ProviderContentLeaseDto
          issuedAt: Date
          expiresAt: Date
          createRecord: (
            audience: DurableImportReferenceAudience,
            payload: Readonly<Record<string, unknown>>,
            affectedPropertyId?: string | null,
            remainingRedemptions?: number | null,
          ) => DurableReferenceDraft | null
        }>,
      ) => Readonly<{ records: readonly DurableReferenceDraft[]; value: T }> | null
    }>,
  ): Promise<ImportReferenceResult<{ value: T }>> => {
    const authorization = durableImportAuthorizationSchema.safeParse(input.authorization)
    const issuedAt = deps.clock()
    const expiresAt = new Date(input.contentDeadlineMs)
    if (
      !authorization.success ||
      expiresAt <= issuedAt ||
      expiresAt.getTime() > issuedAt.getTime() + DURABLE_GOOGLE_IMPORT_DISCOVERY_TTL_MS
    ) {
      return { ok: false, code: 'capacity_exceeded' }
    }
    const lease = await deps.leases.issue({
      audience: 'import',
      capability: 'property.import_gbp_v2',
      organizationId: authorization.data.organizationId,
      initiatorUserId: authorization.data.userId,
      propertyId: null,
      connectionId: authorization.data.connectionId,
      ...binding(authorization.data),
      absoluteDeadlineMs: expiresAt.getTime(),
      nowMs: issuedAt.getTime(),
    })
    if (!lease.ok) return durableImportLeaseFailure(lease.code)
    let committed = false
    try {
      for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
        const createRecord = (
          audience: DurableImportReferenceAudience,
          payload: Readonly<Record<string, unknown>>,
          affectedPropertyId: string | null = null,
          remainingRedemptions: number | null = null,
        ): DurableReferenceDraft | null => {
          const reference = deps.keys.issue(audience)
          return reference
            ? {
                handle: reference.handle,
                record: {
                  referenceKey: reference.key,
                  keyVersion: reference.keyVersion,
                  audience,
                  authorization: authorization.data,
                  payload,
                  affectedPropertyId,
                  remainingRedemptions,
                  claimRequestId: null,
                  claimedAt: null,
                  issuedAt,
                  expiresAt,
                },
              }
            : null
        }
        const built = input.build({
          lease: lease.lease,
          issuedAt,
          expiresAt,
          createRecord,
        })
        if (!built || Buffer.byteLength(JSON.stringify(built.value)) > MAX_PAGE_BYTES) {
          return { ok: false, code: 'capacity_exceeded' }
        }
        try {
          await insertDurableImportRecords(
            deps.db,
            deps.keys,
            built.records.map((record) => record.record),
            invalidationScopesFor(authorization.data, input.propertyIds),
            issuedAt,
          )
          committed = true
          return { ok: true, value: built.value }
        } catch (error) {
          if (error instanceof DurableImportReferenceInvalidated) {
            return { ok: false, code: 'binding_mismatch' }
          }
          if (!(error instanceof DurableImportReferenceCollision)) throw error
        }
      }
      return { ok: false, code: 'runtime_unavailable' }
    } catch {
      return { ok: false, code: 'runtime_unavailable' }
    } finally {
      if (!committed) await deps.leases.invalidate(lease.lease.leaseRef).catch(() => {})
    }
  }

  return Object.freeze({ publish, binding })
}
