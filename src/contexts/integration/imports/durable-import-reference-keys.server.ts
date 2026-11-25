import { createHash } from 'node:crypto'
import type { ImportDiscoveryAuthorization } from './durable-import-reference-store.port.server'

export type DurableImportReferenceAudience =
  'account_selection' | 'accounts_cursor' | 'locations_cursor' | 'import_candidate'

export type DurableImportInvalidationScope = Readonly<{
  kind: 'organization' | 'user' | 'user_connection' | 'connection' | 'property'
  value: string
}>

/** Stored in `key_version` for server-issued random identifiers. */
export const SERVER_ID_VERSION = 'server'
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

export const isHandle = (handle: string): boolean => SERVER_ID.test(handle)

/**
 * The browser holds the random identifier itself; the row is bound to the
 * organization, user and connection, and every redemption re-checks them.
 */
export const newHandle = (random: (bytes: number) => Buffer): string | null => {
  const bytes = random(32)
  return Buffer.isBuffer(bytes) && bytes.byteLength === 32
    ? bytes.toString('base64url')
    : null
}

export const invalidationDigest = (target: DurableImportInvalidationScope): string =>
  createHash('sha256')
    .update(`google-import-reference-invalidation:${target.kind}\0${target.value}`)
    .digest('base64url')
