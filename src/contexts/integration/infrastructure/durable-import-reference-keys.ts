import { randomBytes } from 'node:crypto'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ImportDiscoveryAuthorization } from '../application/ports/google-import-reference-store.port'

export type DurableImportReferenceAudience =
  'account_selection' | 'accounts_cursor' | 'locations_cursor' | 'import_candidate'

export type DurableImportInvalidationScope = Readonly<{
  kind: 'organization' | 'user' | 'user_connection' | 'connection' | 'property'
  value: string
}>

const KEY_VERSION = /^[a-z][a-z0-9_-]{0,31}$/u
const NONCE = /^[A-Za-z0-9_-]{43}$/u

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
  keys: VersionedHmacKeyring
  random?: (bytes: number) => Buffer
}) => {
  const random = input.random ?? randomBytes
  const keyVersions = Object.freeze([
    input.keys.activeVersion,
    ...input.keys.retainedVersions,
  ])
  const recordKey = (
    audience: DurableImportReferenceAudience,
    handle: string,
  ): string | null => {
    const [version, nonce, extra] = handle.split('.')
    if (
      extra !== undefined ||
      !version ||
      !nonce ||
      !KEY_VERSION.test(version) ||
      !NONCE.test(nonce) ||
      !keyVersions.includes(version)
    ) {
      return null
    }
    return input.keys.derive(`google-import-reference:${audience}`, handle, version)
  }
  const issue = (
    audience: DurableImportReferenceAudience,
  ): Readonly<{ handle: string; key: string; keyVersion: string }> | null => {
    const bytes = random(32)
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 32) return null
    const handle = `${input.keys.activeVersion}.${bytes.toString('base64url')}`
    const key = recordKey(audience, handle)
    return key ? { handle, key, keyVersion: input.keys.activeVersion } : null
  }
  const invalidationKeys = (target: DurableImportInvalidationScope) =>
    keyVersions.flatMap((keyVersion) => {
      const key = input.keys.derive(
        `google-import-reference-invalidation:${target.kind}`,
        target.value,
        keyVersion,
      )
      return key ? [{ key, keyVersion, scopeKind: target.kind }] : []
    })

  return Object.freeze({ issue, recordKey, invalidationKeys, keyVersions })
}

export type DurableImportReferenceKeys = ReturnType<
  typeof createDurableImportReferenceKeys
>
