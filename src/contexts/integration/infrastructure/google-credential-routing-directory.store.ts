import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { dataCellById } from '#/shared/domain/data-cell-catalogue'
import { parseSignedGoogleCredentialRoutingDirectory } from '#/shared/routing/google-credential-routing'
import type {
  GoogleCredentialRoutingDirectoryFacts,
  GoogleCredentialRoutingDirectoryPublicationStore,
} from '../application/google-credential-routing-directory-publisher'

function positiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Google credential routing ${label} is invalid`)
  }
  return parsed
}

/**
 * Durable monotonic publisher state. The callback signs before any revision is
 * committed; a signing/validation error rolls the transaction back.
 */
export const createGoogleCredentialRoutingDirectoryPublicationStore = (
  db: Database,
): GoogleCredentialRoutingDirectoryPublicationStore => {
  return Object.freeze({
    publishNext: (build) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('google-credential-routing-directory', 0))`,
        )
        await tx.execute(sql`
          INSERT INTO google_credential_routing_directory_state (
            singleton, current_revision, updated_at
          ) VALUES (TRUE, 0, NOW())
          ON CONFLICT (singleton) DO NOTHING
        `)
        const state = await tx.execute(sql`
          SELECT current_revision::text AS current_revision
          FROM google_credential_routing_directory_state
          WHERE singleton = TRUE
          FOR UPDATE
        `)
        const currentRaw = state.rows[0]?.current_revision
        const current =
          currentRaw === '0' ? 0 : positiveSafeInteger(currentRaw, 'revision')
        if (current >= Number.MAX_SAFE_INTEGER) {
          throw new Error('Google credential routing revision is exhausted')
        }
        const revision = current + 1

        const organizationRows = await tx.execute(sql`
          SELECT organization_id, home_cell_id, authority_generation
          FROM google_organization_credential_homes
          WHERE superseded_at IS NULL
          ORDER BY organization_id
        `)
        const connectionRows = await tx.execute(sql`
          SELECT c.organization_id, c.id::text AS connection_id,
                 c.credential_home_cell_id AS home_cell_id,
                 c.credential_home_authority_generation AS authority_generation
          FROM google_connections c
          JOIN google_organization_credential_homes h
           ON h.organization_id = c.organization_id
           AND h.authority_generation = c.credential_home_authority_generation
           AND h.home_cell_id = c.credential_home_cell_id
           AND h.catalogue_policy_version = c.credential_home_policy_version
           AND h.superseded_at IS NULL
          WHERE c.credential_use_state = 'active'
          ORDER BY c.organization_id, c.id
        `)
        const propertyRows = await tx.execute(sql`
          SELECT p.organization_id, p.google_connection_id::text AS connection_id,
                 p.id::text AS property_id, p.data_cell_id AS target_cell_id
          FROM properties p
          JOIN google_connections c
            ON c.organization_id = p.organization_id
           AND c.id = p.google_connection_id
           AND c.credential_use_state = 'active'
          JOIN google_organization_credential_homes h
            ON h.organization_id = c.organization_id
           AND h.authority_generation = c.credential_home_authority_generation
           AND h.home_cell_id = c.credential_home_cell_id
           AND h.catalogue_policy_version = c.credential_home_policy_version
           AND h.superseded_at IS NULL
          WHERE p.deleted_at IS NULL
            AND p.lifecycle_state = 'active'
            AND p.google_binding_state = 'active'
            AND p.data_cell_id IS NOT NULL
          ORDER BY p.organization_id, p.google_connection_id, p.id
        `)
        const gapRows = await tx.execute(sql`
          SELECT
            count(*) FILTER (
              WHERE c.credential_use_state = 'active'
                AND (
                  c.credential_home_cell_id IS NULL
                  OR c.credential_home_policy_version IS NULL
                  OR c.credential_home_authority_generation IS NULL
                  OR h.organization_id IS NULL
                )
            )::int AS unhomed_active_connection_count,
            count(*) FILTER (
              WHERE c.credential_use_state = 'active'
                AND c.credential_home_cell_id IS NOT NULL
                AND c.credential_home_policy_version IS NOT NULL
                AND c.credential_home_authority_generation IS NOT NULL
                AND h.organization_id IS NULL
            )::int AS authority_conflict_count
          FROM google_connections c
          LEFT JOIN google_organization_credential_homes h
            ON h.organization_id = c.organization_id
           AND h.authority_generation = c.credential_home_authority_generation
           AND h.home_cell_id = c.credential_home_cell_id
           AND h.catalogue_policy_version = c.credential_home_policy_version
           AND h.superseded_at IS NULL
        `)
        const propertyGapRows = await tx.execute(sql`
          SELECT count(*)::int AS unroutable_active_property_count
          FROM properties p
          JOIN google_connections c
            ON c.organization_id = p.organization_id
           AND c.id = p.google_connection_id
           AND c.credential_use_state = 'active'
          WHERE p.deleted_at IS NULL
            AND p.lifecycle_state = 'active'
            AND p.google_binding_state = 'active'
            AND p.data_cell_id IS NULL
        `)

        const organizationHomes: GoogleCredentialRoutingDirectoryFacts['organizationHomes'] =
          organizationRows.rows.map((row) => {
            if (
              typeof row.organization_id !== 'string' ||
              typeof row.home_cell_id !== 'string' ||
              typeof row.authority_generation !== 'number' ||
              !Number.isSafeInteger(row.authority_generation) ||
              row.authority_generation < 1
            ) {
              throw new Error('Google credential routing Organization row is invalid')
            }
            const cell = dataCellById(row.home_cell_id)?.id
            if (!cell) throw new Error('Google credential routing home cell is invalid')
            return {
              organizationId: row.organization_id,
              homeCellId: cell,
              authorityGeneration: row.authority_generation,
            }
          })
        const connectionHomes: GoogleCredentialRoutingDirectoryFacts['connectionHomes'] =
          connectionRows.rows.map((row) => {
            if (
              typeof row.organization_id !== 'string' ||
              typeof row.connection_id !== 'string' ||
              typeof row.home_cell_id !== 'string' ||
              typeof row.authority_generation !== 'number' ||
              !Number.isSafeInteger(row.authority_generation) ||
              row.authority_generation < 1
            ) {
              throw new Error('Google credential routing connection row is invalid')
            }
            const cell = dataCellById(row.home_cell_id)?.id
            if (!cell) throw new Error('Google credential routing home cell is invalid')
            return {
              organizationId: row.organization_id,
              connectionId: row.connection_id,
              homeCellId: cell,
              authorityGeneration: row.authority_generation,
            }
          })
        const propertyTargets: GoogleCredentialRoutingDirectoryFacts['propertyTargets'] =
          propertyRows.rows.map((row) => {
            if (
              typeof row.organization_id !== 'string' ||
              typeof row.connection_id !== 'string' ||
              typeof row.property_id !== 'string' ||
              typeof row.target_cell_id !== 'string'
            ) {
              throw new Error('Google credential routing Property row is invalid')
            }
            const cell = dataCellById(row.target_cell_id)?.id
            if (!cell) throw new Error('Google credential routing target cell is invalid')
            return {
              organizationId: row.organization_id,
              connectionId: row.connection_id,
              propertyId: row.property_id,
              targetCellId: cell,
            }
          })
        const gap = gapRows.rows[0]
        const propertyGap = propertyGapRows.rows[0]
        const facts: GoogleCredentialRoutingDirectoryFacts = {
          revision,
          organizationHomes,
          connectionHomes,
          propertyTargets,
          unhomedActiveConnectionCount: Number(
            gap?.unhomed_active_connection_count ?? Number.NaN,
          ),
          authorityConflictCount: Number(gap?.authority_conflict_count ?? Number.NaN),
          unroutableActivePropertyCount: Number(
            propertyGap?.unroutable_active_property_count ?? Number.NaN,
          ),
        }
        const directory = build(facts)
        await tx.execute(sql`
          INSERT INTO google_credential_routing_directory_snapshots (
            revision, catalogue_policy_version, issued_at, expires_at,
            digest_sha256, signature_key_version, signature, directory,
            created_at
          ) VALUES (
            ${directory.revision}, ${directory.cataloguePolicyVersion},
            ${new Date(directory.issuedAtMs)}, ${new Date(directory.expiresAtMs)},
            ${directory.digestSha256}, ${directory.signatureKeyVersion},
            ${directory.signature}, ${JSON.stringify(directory)}::jsonb, NOW()
          )
        `)
        const advanced = await tx.execute(sql`
          UPDATE google_credential_routing_directory_state
          SET current_revision = ${directory.revision}, updated_at = NOW()
          WHERE singleton = TRUE AND current_revision = ${current}
          RETURNING singleton
        `)
        if (advanced.rows.length !== 1) {
          throw new Error('Google credential routing revision CAS failed')
        }
        return directory
      }),
    loadCurrent: async () => {
      const result = await db.execute(sql`
        SELECT s.directory
        FROM google_credential_routing_directory_state d
        JOIN google_credential_routing_directory_snapshots s
          ON s.revision = d.current_revision
        WHERE d.singleton = TRUE
      `)
      if (result.rows.length === 0) return null
      if (result.rows.length !== 1) {
        throw new Error('Google credential routing current snapshot is ambiguous')
      }
      return parseSignedGoogleCredentialRoutingDirectory(result.rows[0]?.directory)
    },
  })
}
