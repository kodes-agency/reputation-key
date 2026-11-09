import { createHash, randomBytes } from 'node:crypto'
import type { ImportDiscoveryAuthorization } from '../application/ports/google-import-reference-store.port'

export type DurableImportReferenceAudience =
  'account_selection' | 'accounts_cursor' | 'locations_cursor' | 'import_candidate'

export type DurableImportInvalidationScope = Readonly<{
  kind: 'organization' | 'user' | 'user_connection' | 'connection' | 'property'
  value: string
}>

/** Stored in `key_version` for server-issued random identifiers. */
const SERVER_ID_VERSION = 'server'
const SERVER_ID = /^[A-Za-z0-9_-]{43}$/u

const scope = (
  kind: DurableImportInvalidationScope['kind'],
  parts: readonly string[],
): DurableImportInvalidationScope => ({ kind, value: parts.join('\0') })

export const invalidationScopesFor = (
  authorization: Pick<
    ImportDiscoveryAuthorization,
    'organizationId' | 'userId' | 'connectionId'
  >,
  propertyIds: readonly string[] = [],
): readonly DurableImportInvalidationScope[] => [
  scope('organization', [authorization.organizationId]),
  scope('user', [authorization.organizationId, authorization.userId]),
  scope('user_connection', [
    authorization.organizationId,
    authorization.userId,
    authorization.connectionId,
  ]),
  scope('connection', [authorization.organizationId, authorization.connectionId]),
  ...[...new Set(propertyIds)].map((propertyId) =>
    scope('property', [authorization.organizationId, propertyId]),
  ),
]

export const invalidationScopeFor = (
  kind: DurableImportInvalidationScope['kind'],
  parts: readonly string[],
): DurableImportInvalidationScope => scope(kind, parts)

export const createDurableImportReferenceKeys = (input: {
  random?: (bytes: number) => Buffer
}) => {
  const random = input.random ?? randomBytes
  // The browser holds the random identifier itself; the row is bound to the
  // organization, user and connection, and every redemption re-checks them.
  const recordKey = (
    _audience: DurableImportReferenceAudience,
    handle: string,
  ): string | null => (SERVER_ID.test(handle) ? handle : null)
  const issue = (
    audience: DurableImportReferenceAudience,
  ): Readonly<{ handle: string; key: string; keyVersion: string }> | null => {
    const bytes = random(32)
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 32) return null
    const handle = bytes.toString('base64url')
    const key = recordKey(audience, handle)
    return key ? { handle, key, keyVersion: SERVER_ID_VERSION } : null
  }
  const invalidationKeys = (target: DurableImportInvalidationScope) => [
    {
      key: createHash('sha256')
        .update(`google-import-reference-invalidation:${target.kind}\0${target.value}`)
        .digest('base64url'),
      keyVersion: SERVER_ID_VERSION,
      scopeKind: target.kind,
    },
  ]

  return Object.freeze({
    issue,
    recordKey,
    invalidationKeys,
    keyVersion: SERVER_ID_VERSION,
  })
}

export type DurableImportReferenceKeys = ReturnType<
  typeof createDurableImportReferenceKeys
>
