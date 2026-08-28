import { timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  DurableGoogleCredentialBrokerReplayStore,
  GoogleCredentialBrokerLookupCandidate,
  GoogleCredentialBrokerReplayIssue,
  GoogleCredentialBrokerReplayRedeemInput,
} from '#/shared/google-provider-control/credential-broker-durable-state'

function safeEqual(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  try {
    return (
      leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
    )
  } finally {
    leftBytes.fill(0)
    rightBytes.fill(0)
  }
}

function exactInteger(value: unknown, expected: number): boolean {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed === expected
}

function exactTimestamp(value: unknown, expectedMs: number): boolean {
  if (value instanceof Date) return value.getTime() === expectedMs
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed === expectedMs
}

function validateCandidates(
  candidates: readonly GoogleCredentialBrokerLookupCandidate[],
): void {
  if (candidates.length < 1 || candidates.length > 2) {
    throw new Error('Google credential broker lookup candidate count is invalid')
  }
  if (
    new Set(candidates.map((entry) => entry.lookupKeyVersion)).size !==
      candidates.length ||
    candidates.some(
      (entry) =>
        !/^[a-z][a-z0-9_-]{0,31}$/u.test(entry.lookupKeyVersion) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(entry.grantIdHmac) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(entry.oneUseNonceHmac),
    )
  ) {
    throw new Error('Google credential broker lookup candidate is invalid')
  }
}

function exactStoredIssue(
  row: Record<string, unknown>,
  input: GoogleCredentialBrokerReplayIssue,
): boolean {
  return (
    row.organization_id === input.organizationId &&
    row.connection_id === input.connectionId &&
    row.property_id === input.propertyId &&
    row.home_cell_id === input.homeCellId &&
    row.target_cell_id === input.targetCellId &&
    row.target_gateway_identity === input.targetGatewayIdentity &&
    row.route_key === input.routeKey &&
    exactInteger(
      row.credential_home_authority_generation,
      input.authorization.credentialHomeAuthorityGeneration,
    ) &&
    exactInteger(
      row.connection_lifecycle_version,
      input.authorization.connectionLifecycleVersion,
    ) &&
    exactInteger(
      row.connection_access_version,
      input.authorization.connectionAccessVersion,
    ) &&
    exactInteger(row.credential_generation, input.authorization.credentialGeneration) &&
    exactInteger(row.property_source_epoch, input.authorization.propertySourceEpoch) &&
    row.request_digest_sha256 === input.requestDigestSha256 &&
    row.credential_binding_sha256 === input.credentialBindingSha256 &&
    exactInteger(row.routing_directory_revision, input.routingDirectoryRevision) &&
    exactInteger(row.routing_policy_version, input.routingPolicyVersion) &&
    row.material_locator === input.materialReference.locator &&
    row.material_encryption_key_id === input.materialReference.encryptionKeyId &&
    row.material_binding_sha256 === input.materialReference.bindingSha256 &&
    exactTimestamp(row.issued_at, input.issuedAtMs) &&
    exactTimestamp(row.expires_at, input.expiresAtMs) &&
    safeEqual(row.one_use_nonce_hmac, input.oneUseNonceHmac)
  )
}

function exactRedeemBinding(
  row: Record<string, unknown>,
  input: GoogleCredentialBrokerReplayRedeemInput,
): boolean {
  const expected = input.expected
  return (
    row.organization_id === input.organizationId &&
    row.organization_id === expected.organizationId &&
    row.connection_id === expected.connectionId &&
    row.property_id === expected.propertyId &&
    row.home_cell_id === expected.homeCellId &&
    row.target_cell_id === expected.targetCellId &&
    row.target_gateway_identity === expected.targetGatewayIdentity &&
    row.route_key === expected.routeKey &&
    exactInteger(
      row.credential_home_authority_generation,
      expected.authorization.credentialHomeAuthorityGeneration,
    ) &&
    exactInteger(
      row.connection_lifecycle_version,
      expected.authorization.connectionLifecycleVersion,
    ) &&
    exactInteger(
      row.connection_access_version,
      expected.authorization.connectionAccessVersion,
    ) &&
    exactInteger(
      row.credential_generation,
      expected.authorization.credentialGeneration,
    ) &&
    exactInteger(row.property_source_epoch, expected.authorization.propertySourceEpoch) &&
    row.request_digest_sha256 === expected.requestDigestSha256 &&
    row.credential_binding_sha256 === expected.credentialBindingSha256 &&
    exactInteger(row.routing_directory_revision, expected.routingDirectoryRevision) &&
    exactInteger(row.routing_policy_version, expected.routingPolicyVersion)
  )
}

/** PostgreSQL one-use authority. Only keyed hashes and opaque sealed refs persist. */
export const createDurableGoogleCredentialBrokerReplayStore = (
  db: Database,
): DurableGoogleCredentialBrokerReplayStore => {
  return Object.freeze({
    issue: (input) =>
      db.transaction(async (tx) => {
        validateCandidates([input])
        const inserted = await tx.execute(sql`
          INSERT INTO google_credential_broker_replay (
            organization_id, lookup_key_version, grant_id_hmac,
            one_use_nonce_hmac, connection_id, property_id, home_cell_id,
            target_cell_id, target_gateway_identity, route_key,
            credential_home_authority_generation, connection_lifecycle_version,
            connection_access_version,
            credential_generation, property_source_epoch,
            request_digest_sha256, credential_binding_sha256,
            routing_directory_revision, routing_policy_version,
            material_locator, material_encryption_key_id, material_binding_sha256,
            issued_at, expires_at, state, created_at
          ) VALUES (
            ${input.organizationId}, ${input.lookupKeyVersion}, ${input.grantIdHmac},
            ${input.oneUseNonceHmac}, ${input.connectionId}, ${input.propertyId},
            ${input.homeCellId}, ${input.targetCellId},
            ${input.targetGatewayIdentity}, ${input.routeKey},
            ${input.authorization.credentialHomeAuthorityGeneration},
            ${input.authorization.connectionLifecycleVersion},
            ${input.authorization.connectionAccessVersion},
            ${input.authorization.credentialGeneration},
            ${input.authorization.propertySourceEpoch},
            ${input.requestDigestSha256}, ${input.credentialBindingSha256},
            ${input.routingDirectoryRevision}, ${input.routingPolicyVersion},
            ${input.materialReference.locator},
            ${input.materialReference.encryptionKeyId},
            ${input.materialReference.bindingSha256},
            ${new Date(input.issuedAtMs)}, ${new Date(input.expiresAtMs)},
            'issued', NOW()
          )
          ON CONFLICT (organization_id, lookup_key_version, grant_id_hmac)
          DO NOTHING
          RETURNING organization_id
        `)
        if (inserted.rows.length === 1) return 'issued'
        const existing = await tx.execute(sql`
          SELECT *
          FROM google_credential_broker_replay
          WHERE organization_id = ${input.organizationId}
            AND lookup_key_version = ${input.lookupKeyVersion}
            AND grant_id_hmac = ${input.grantIdHmac}
          FOR UPDATE
        `)
        if (existing.rows.length !== 1 || !exactStoredIssue(existing.rows[0]!, input)) {
          throw new Error('Google credential broker replay hash collision')
        }
        return 'duplicate'
      }),
    redeem: (input) =>
      db.transaction(async (tx) => {
        validateCandidates(input.candidates)
        const matches: Array<{
          row: Record<string, unknown>
          candidate: GoogleCredentialBrokerLookupCandidate
        }> = []
        for (const candidate of input.candidates) {
          const result = await tx.execute(sql`
            SELECT *
            FROM google_credential_broker_replay
            WHERE organization_id = ${input.organizationId}
              AND lookup_key_version = ${candidate.lookupKeyVersion}
              AND grant_id_hmac = ${candidate.grantIdHmac}
            FOR UPDATE
          `)
          if (result.rows.length > 1) {
            throw new Error('Google credential broker replay authority is ambiguous')
          }
          if (result.rows[0]) matches.push({ row: result.rows[0], candidate })
        }
        if (matches.length === 0) return { kind: 'unknown' as const }
        if (matches.length !== 1) {
          throw new Error('Google credential broker replay authority is ambiguous')
        }
        const { row, candidate } = matches[0]!
        if (
          !safeEqual(row.one_use_nonce_hmac, candidate.oneUseNonceHmac) ||
          !exactRedeemBinding(row, input)
        ) {
          return { kind: 'mismatch' as const }
        }
        const expiresAtMs =
          row.expires_at instanceof Date
            ? row.expires_at.getTime()
            : typeof row.expires_at === 'string'
              ? Date.parse(row.expires_at)
              : Number.NaN
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= input.nowMs) {
          return { kind: 'expired' as const }
        }
        if (row.state !== 'issued') return { kind: 'replayed' as const }
        const redeemed = await tx.execute(sql`
          UPDATE google_credential_broker_replay
          SET state = 'redeemed', redeemed_at = ${new Date(input.nowMs)}
          WHERE organization_id = ${input.organizationId}
            AND lookup_key_version = ${candidate.lookupKeyVersion}
            AND grant_id_hmac = ${candidate.grantIdHmac}
            AND state = 'issued'
          RETURNING organization_id
        `)
        if (redeemed.rows.length !== 1) return { kind: 'replayed' as const }
        if (
          typeof row.material_locator !== 'string' ||
          typeof row.material_encryption_key_id !== 'string' ||
          typeof row.material_binding_sha256 !== 'string'
        ) {
          throw new Error('Google credential broker material reference is invalid')
        }
        return {
          kind: 'redeemed' as const,
          materialReference: {
            kind: 'sealed-credential-reference-v1' as const,
            locator: row.material_locator,
            encryptionKeyId: row.material_encryption_key_id,
            bindingSha256: row.material_binding_sha256,
          },
        }
      }),
    purgeExpired: async ({ nowMs, limit }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new Error('Google credential broker purge limit is invalid')
      }
      const deleted = await db.execute(sql`
        WITH expired AS (
          SELECT organization_id, lookup_key_version, grant_id_hmac
          FROM google_credential_broker_replay
          WHERE expires_at <= ${new Date(nowMs)}
          ORDER BY expires_at, organization_id, lookup_key_version, grant_id_hmac
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM google_credential_broker_replay target
        USING expired
        WHERE target.organization_id = expired.organization_id
          AND target.lookup_key_version = expired.lookup_key_version
          AND target.grant_id_hmac = expired.grant_id_hmac
        RETURNING target.organization_id
      `)
      return deleted.rows.length
    },
    probe: async () => {
      try {
        const result = await db.execute(sql`
          SELECT to_regclass('google_credential_broker_replay')::text AS relation
        `)
        return result.rows[0]?.relation === 'google_credential_broker_replay'
      } catch {
        return false
      }
    },
  })
}
