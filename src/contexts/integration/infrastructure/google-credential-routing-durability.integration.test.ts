import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createGoogleCredentialRoutingDirectoryPublisher } from '../application/google-credential-routing-directory-publisher'
import { createOrganizationGoogleCredentialHomeBackfillStore } from './organization-google-credential-home-backfill.store'
import { applyOrganizationGoogleCredentialHome } from './organization-google-credential-home-command'
import { createOrganizationGoogleCredentialHomeAuthority } from './organization-google-credential-home-authority'
import { createGoogleCredentialRoutingDirectoryPublicationStore } from './google-credential-routing-directory.store'
import { createDurableGoogleCredentialBrokerReplayStore } from './google-credential-broker-replay.store'
import type { GoogleCredentialBrokerReplayIssue } from '#/shared/google-provider-control/credential-broker-durable-state'

const ORG = organizationId('org-reg-credential-b-durability')
const OTHER_ORG = organizationId('org-reg-credential-b-distractor')
const ACTOR = userId('operator-reg-credential-b')
const CONNECTION_A = googleConnectionId('71000000-0000-4000-8000-000000000001')
const CONNECTION_B = googleConnectionId('71000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-08-27T12:00:00Z')
const BACKFILL_NOW = new Date('2026-08-27T12:34:56.789Z')

let pool: Pool
let lease: TestLease
let db: Database

async function clearRows(): Promise<void> {
  await pool.query(
    'DELETE FROM google_credential_broker_replay WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM google_connections WHERE organization_id = ANY($1)', [
    [ORG, OTHER_ORG],
  ])
  await pool.query(
    'DELETE FROM google_organization_credential_homes WHERE organization_id = ANY($1)',
    [[ORG, OTHER_ORG]],
  )
}

async function seedAuthority(
  homeCellId: 'us' | 'europe',
  generation = 1,
  organization = ORG,
): Promise<void> {
  await pool.query(
    `INSERT INTO google_organization_credential_homes (
       organization_id, authority_generation, home_cell_id,
       catalogue_policy_version, transition_reason, changed_by,
       effective_from, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'legacy_backfill', $5, $6, $6, $6)`,
    [
      organization,
      generation,
      homeCellId,
      DATA_CELL_CATALOGUE_POLICY_VERSION,
      ACTOR,
      NOW,
    ],
  )
}

type RoutingDirectoryBaseline =
  | Readonly<{ present: false; currentRevision: 0; updatedAt: null }>
  | Readonly<{ present: true; currentRevision: number; updatedAt: Date }>

async function captureRoutingDirectoryBaseline(): Promise<RoutingDirectoryBaseline> {
  const result = await pool.query(
    `SELECT current_revision::text AS current_revision, updated_at
     FROM google_credential_routing_directory_state
     WHERE singleton = TRUE`,
  )
  const row = result.rows[0]
  if (!row) return { present: false, currentRevision: 0, updatedAt: null }
  const currentRevision = Number(row.current_revision)
  if (!Number.isSafeInteger(currentRevision) || !(row.updated_at instanceof Date)) {
    throw new Error('Google credential routing fixture baseline is invalid')
  }
  return { present: true, currentRevision, updatedAt: row.updated_at }
}

async function restoreRoutingDirectoryBaseline(
  baseline: RoutingDirectoryBaseline,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('google-credential-routing-directory', 0))",
    )
    const state = await client.query(
      `SELECT current_revision::text AS current_revision
       FROM google_credential_routing_directory_state
       WHERE singleton = TRUE
       FOR UPDATE`,
    )
    if (!state.rows[0]) {
      if (baseline.present) {
        throw new Error('Google credential routing fixture state disappeared')
      }
      await client.query('COMMIT')
      return
    }
    const currentRevision = Number(state.rows[0].current_revision)
    if (
      !Number.isSafeInteger(currentRevision) ||
      currentRevision < baseline.currentRevision ||
      currentRevision > baseline.currentRevision + 2
    ) {
      throw new Error('Google credential routing fixture state changed concurrently')
    }
    if (currentRevision === baseline.currentRevision) {
      await client.query('COMMIT')
      return
    }
    const restored = baseline.present
      ? await client.query(
          `UPDATE google_credential_routing_directory_state
           SET current_revision = $1, updated_at = $2
           WHERE singleton = TRUE AND current_revision = $3
           RETURNING singleton`,
          [baseline.currentRevision, baseline.updatedAt, currentRevision],
        )
      : await client.query(
          `DELETE FROM google_credential_routing_directory_state
           WHERE singleton = TRUE AND current_revision = $1
           RETURNING singleton`,
          [currentRevision],
        )
    if (restored.rowCount !== 1) {
      throw new Error('Google credential routing fixture restore lost its revision fence')
    }
    await client.query(
      `DELETE FROM google_credential_routing_directory_snapshots
       WHERE revision > $1 AND revision <= $2`,
      [baseline.currentRevision, currentRevision],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function seedConnection(
  input: Readonly<{
    id: string
    suffix: string
    homeCellId: 'us' | 'europe' | null
    authorityGeneration: number | null
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status, credential_use_state, lifecycle_version,
       access_version, credential_generation, credential_home_cell_id,
       credential_home_policy_version, credential_home_authority_generation,
       encryption_key_id, status_changed_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'encrypted-access', 'encrypted-refresh', $4,
       ARRAY['scope-a']::text[], $5, 'organization', 'active', 'active',
       1, 1, 1, $6, $8, $7, 'v1', $4, $4, $4
     )`,
    [
      input.id,
      ORG,
      `subject-${input.suffix}`,
      NOW,
      ACTOR,
      input.homeCellId,
      input.authorityGeneration,
      input.homeCellId === null ? null : DATA_CELL_CATALOGUE_POLICY_VERSION,
    ],
  )
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
  pool = lease.pool
  db = drizzle(pool) as unknown as Database
})

afterAll(async () => {
  await clearRows()
  await lease.release()
})

beforeEach(clearRows)

describe.sequential('regional credential routing durability (PostgreSQL)', () => {
  it('rehydrates persisted authority timestamps for every authority reader', async () => {
    await seedAuthority('us')
    await seedAuthority('europe', 1, OTHER_ORG)

    const inspected = await createOrganizationGoogleCredentialHomeAuthority(
      db,
    ).inspectForCredentialExchange({
      organizationId: ORG,
      targetConnectionId: null,
    })
    expect(inspected).toMatchObject({
      authority: {
        organizationId: ORG,
        homeCellId: 'us',
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        authorityGeneration: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
      otherActiveGrantCount: 0,
    })

    await expect(
      createOrganizationGoogleCredentialHomeBackfillStore(db, () => BACKFILL_NOW).report(
        ORG,
      ),
    ).resolves.toMatchObject({
      authorityPresent: true,
      activeGrantCount: 0,
    })
  })

  it('reserves one canonical home idempotently under concurrent first exchanges', async () => {
    const authority = createOrganizationGoogleCredentialHomeAuthority(db)
    const reservation = {
      organizationId: ORG,
      targetConnectionId: null,
      requested: {
        homeCellId: 'us' as const,
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        authorityGeneration: 1,
      },
      reason: 'new_grant' as const,
      changedBy: ACTOR,
      now: NOW,
    }

    await expect(
      Promise.all([
        authority.reserveForCredentialExchange(reservation),
        authority.reserveForCredentialExchange(reservation),
      ]),
    ).resolves.toEqual([undefined, undefined])
    await expect(
      authority.inspectForCredentialExchange({
        organizationId: ORG,
        targetConnectionId: null,
      }),
    ).resolves.toMatchObject({
      authority: {
        homeCellId: 'us',
        cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        authorityGeneration: 1,
      },
      otherActiveGrantCount: 0,
    })
    const rows = await pool.query(
      `SELECT count(*)::int AS count
       FROM google_organization_credential_homes
       WHERE organization_id = $1 AND superseded_at IS NULL`,
      [ORG],
    )
    expect(rows.rows[0]?.count).toBe(1)
  })

  it('applies a digest-fenced explicit legacy backfill atomically', async () => {
    await seedAuthority('europe', 1, OTHER_ORG)
    await seedConnection({
      id: CONNECTION_A,
      suffix: 'legacy',
      homeCellId: null,
      authorityGeneration: null,
    })
    const store = createOrganizationGoogleCredentialHomeBackfillStore(
      db,
      () => BACKFILL_NOW,
    )
    let report = await store.report(ORG)
    expect(report).toMatchObject({
      authorityPresent: false,
      activeGrantCount: 1,
      activeMissingHomeCount: 1,
    })

    await pool.query(
      "UPDATE google_connections SET credential_use_state = 'none' WHERE id = $1",
      [CONNECTION_A],
    )
    await expect(
      store.apply({
        organizationId: ORG,
        selectedHome: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        expectedReportDigestSha256: report.reportDigestSha256,
        operatorId: ACTOR,
        ticket: 'REG-credential-home-backfill-1',
      }),
    ).resolves.toEqual({ kind: 'stale_report' })
    await pool.query(
      "UPDATE google_connections SET credential_use_state = 'active' WHERE id = $1",
      [CONNECTION_A],
    )
    report = await store.report(ORG)
    await expect(
      store.apply({
        organizationId: ORG,
        selectedHome: {
          homeCellId: 'us',
          cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
        },
        expectedReportDigestSha256: report.reportDigestSha256,
        operatorId: ACTOR,
        ticket: 'REG-credential-home-backfill-1',
      }),
    ).resolves.toEqual({ kind: 'applied', updatedCount: 1 })

    const bound = await pool.query(
      `SELECT c.credential_home_authority_generation, h.authority_generation,
              c.updated_at AS connection_updated_at,
              h.effective_from, h.created_at, h.updated_at AS authority_updated_at
       FROM google_connections c
       JOIN google_organization_credential_homes h
         ON h.organization_id = c.organization_id
        AND h.authority_generation = c.credential_home_authority_generation
       WHERE c.id = $1 AND h.superseded_at IS NULL`,
      [CONNECTION_A],
    )
    expect(bound.rows).toEqual([
      {
        credential_home_authority_generation: 1,
        authority_generation: 1,
        connection_updated_at: BACKFILL_NOW,
        effective_from: BACKFILL_NOW,
        created_at: BACKFILL_NOW,
        authority_updated_at: BACKFILL_NOW,
      },
    ])
    const distractor = await pool.query(
      `SELECT authority_generation, home_cell_id
       FROM google_organization_credential_homes
       WHERE organization_id = $1 AND superseded_at IS NULL`,
      [OTHER_ORG],
    )
    expect(distractor.rows).toEqual([{ authority_generation: 1, home_cell_id: 'europe' }])
  })

  it('denies a home replacement while another active grant remains', async () => {
    await seedAuthority('europe')
    await seedConnection({
      id: CONNECTION_A,
      suffix: 'target',
      homeCellId: 'europe',
      authorityGeneration: 1,
    })
    await seedConnection({
      id: CONNECTION_B,
      suffix: 'other',
      homeCellId: 'europe',
      authorityGeneration: 1,
    })

    await expect(
      db.transaction((tx) =>
        applyOrganizationGoogleCredentialHome(tx, {
          organizationId: ORG,
          targetConnectionId: CONNECTION_A,
          requested: {
            homeCellId: 'us',
            cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
            authorityGeneration: 2,
          },
          reason: 'governed_reconnect',
          changedBy: ACTOR,
          changeTicket: 'REG-home-move-1',
          now: NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: 'oauth_failed' })
    const current = await pool.query(
      `SELECT authority_generation, home_cell_id
       FROM google_organization_credential_homes
       WHERE organization_id = $1 AND superseded_at IS NULL`,
      [ORG],
    )
    expect(current.rows).toEqual([{ authority_generation: 1, home_cell_id: 'europe' }])
  })

  it('enforces the exact authority generation foreign key on new grants', async () => {
    await seedAuthority('us')
    await expect(
      seedConnection({
        id: CONNECTION_A,
        suffix: 'stale-generation',
        homeCellId: 'us',
        authorityGeneration: 2,
      }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('publishes concurrent signed directory revisions monotonically', async () => {
    const baseline = await captureRoutingDirectoryBaseline()
    const keys = createVersionedHmacKeyring(`v1:${'55'.repeat(32)}`)
    try {
      const store = createGoogleCredentialRoutingDirectoryPublicationStore(db)
      const publish = createGoogleCredentialRoutingDirectoryPublisher({
        store,
        keys,
        nowMs: () => NOW.getTime(),
        ttlMs: 60_000,
      })
      const revisions = (await Promise.all([publish(), publish()]))
        .map((directory) => directory.revision)
        .sort((left, right) => left - right)
      expect(revisions).toEqual([
        baseline.currentRevision + 1,
        baseline.currentRevision + 2,
      ])
    } finally {
      keys.dispose()
      await restoreRoutingDirectoryBaseline(baseline)
    }
  })

  it('redeems one exact tenant-bound broker grant once under concurrency', async () => {
    const store = createDurableGoogleCredentialBrokerReplayStore(db)
    const issue: GoogleCredentialBrokerReplayIssue = {
      organizationId: ORG,
      lookupKeyVersion: 'v1',
      grantIdHmac: 'A'.repeat(43),
      oneUseNonceHmac: 'B'.repeat(43),
      connectionId: CONNECTION_A,
      propertyId: 'property-reg-b-1',
      homeCellId: 'us',
      targetCellId: 'europe',
      targetGatewayIdentity: 'spiffe://repkey/cell-europe/google-gateway',
      routeKey: 'reviews.list',
      authorization: {
        credentialHomeAuthorityGeneration: 3,
        connectionLifecycleVersion: 4,
        connectionAccessVersion: 5,
        credentialGeneration: 6,
        propertySourceEpoch: 7,
      },
      requestDigestSha256: 'a'.repeat(64),
      credentialBindingSha256: 'b'.repeat(64),
      routingDirectoryRevision: 8,
      routingPolicyVersion: 2,
      materialReference: {
        kind: 'sealed-credential-reference-v1',
        locator: 'vault:google/ephemeral/opaque-reg-b',
        encryptionKeyId: 'broker-envelope-v1',
        bindingSha256: 'b'.repeat(64),
      },
      issuedAtMs: NOW.getTime(),
      expiresAtMs: NOW.getTime() + 20_000,
    }
    expect((await Promise.all([store.issue(issue), store.issue(issue)])).sort()).toEqual([
      'duplicate',
      'issued',
    ])
    const {
      lookupKeyVersion,
      grantIdHmac,
      oneUseNonceHmac,
      materialReference: _material,
      issuedAtMs: _issued,
      expiresAtMs: _expires,
      ...expected
    } = issue
    const input = {
      organizationId: ORG,
      candidates: [{ lookupKeyVersion, grantIdHmac, oneUseNonceHmac }],
      expected,
      nowMs: NOW.getTime() + 1_000,
    }
    await expect(
      store.redeem({
        ...input,
        organizationId: 'org-reg-credential-b-other-tenant',
      }),
    ).resolves.toEqual({ kind: 'unknown' })
    await expect(
      store.redeem({
        ...input,
        expected: { ...expected, routeKey: 'reviews.get' },
      }),
    ).resolves.toEqual({ kind: 'mismatch' })
    const results = await Promise.all([store.redeem(input), store.redeem(input)])
    expect(results.map((result) => result.kind).sort()).toEqual(['redeemed', 'replayed'])
  })
})
