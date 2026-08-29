import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  applySingleUsDataCellCutoverBatch,
  createSingleUsDataCellCutoverReport,
  DataCellCredentialCutoverError,
  readCompletedSingleUsDataCellCutover,
  type DataCellCutoverReport,
} from '#/shared/db/single-us-data-cell-cutover'
import { bindSingleUsDataCellCutoverTarget } from '#/shared/db/single-us-data-cell-target-binding'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const db = getDb()
const TEST_ORG_PREFIX = 'org-single-us-cutover-'
const RAILWAY_TARGET = Object.freeze({
  projectId: 'railway-project-us-test',
  environmentId: 'railway-environment-us-test',
})
const TARGET_BINDING = Object.freeze({
  targetProjectId: RAILWAY_TARGET.projectId,
  targetEnvironmentId: RAILWAY_TARGET.environmentId,
})

async function resetControl(client: PoolClient): Promise<void> {
  await client.query(`
    UPDATE data_cell_topology_cutovers
    SET state = 'open', phase = 'properties', property_checkpoint = NULL,
        organization_checkpoint = NULL,
        credential_active_organization_id = NULL,
        credential_connection_checkpoint = NULL,
        target_project_id = NULL, target_environment_id = NULL,
        properties_processed = 0, credential_homes_processed = 0,
        credential_connections_processed = 0, error_count = 0,
        last_error_code = NULL, last_report_digest_sha256 = NULL,
        completion_digest_sha256 = NULL, operator_id = NULL,
        change_ticket = NULL, correlation_id = NULL, fenced_at = NULL,
        completed_at = NULL, updated_at = now()
    WHERE singleton = TRUE
  `)
}

/**
 * Every count the report produces covers the WHOLE database, and an apply
 * refuses to touch anything while a single workflow admission is in flight
 * anywhere. One `admitted` execution permit another integration file left
 * behind therefore turns every apply in this suite into `blocked`. Draining
 * those admissions is what the operator runbook does before the fence goes
 * up; here it is the only way the suite can assert cutover behaviour on a
 * database it does not own alone. Terminal states are used wherever a row is
 * referenced by others, so nothing is deleted out from under a foreign key.
 */
async function drainWorkflowAdmissions(client: PoolClient): Promise<void> {
  await client.query(
    `DELETE FROM region_moves WHERE state NOT IN ('completed', 'rolled_back')`,
  )
  await client.query(
    `DELETE FROM gbp_import_request_items
     WHERE status IN ('pending', 'processing')
        OR outcome_code = 'temporarily_unavailable'`,
  )
  await client.query(
    `DELETE FROM gbp_import_requests WHERE status IN ('queued', 'processing')`,
  )
  await client.query(
    `DELETE FROM gbp_import_jobs WHERE status IN ('queued', 'in_progress')`,
  )
  await client.query(`DELETE FROM legacy_import_effect_leases WHERE state = 'active'`)
  await client.query(
    `DELETE FROM credential_revoke_permits
     WHERE state IN ('dormant', 'active', 'dispatching', 'cleanup_ambiguous')`,
  )
  await client.query(
    `DELETE FROM google_credential_broker_replay
     WHERE state = 'issued' AND expires_at > clock_timestamp()`,
  )
  await client.query(
    `UPDATE google_credential_source_operations
     SET state = 'terminal', terminal_at = now()
     WHERE state IN ('registered', 'provider_started', 'provider_outcome_ambiguous')`,
  )
  await client.query(
    `UPDATE google_subject_authority_guards
     SET state = 'drained', active_source_operation_id = NULL
     WHERE active_source_operation_id IS NOT NULL
        OR state IN ('source_active', 'cleanup_pending', 'provider_reset_required',
          'ambiguous')`,
  )
  await client.query(
    `UPDATE authorization_execution_permits
     SET state = 'fenced', fenced_at = now()
     WHERE state IN ('admitted', 'started')`,
  )
  await client.query(
    `UPDATE google_connections SET credential_use_state = 'none'
     WHERE credential_use_state = 'cleanup_only'`,
  )
}

/**
 * A credential batch takes candidate Organizations in id order, so an
 * Organization another integration file left an active connection for is
 * processed before this suite's fixture and swallows the invocation the
 * fixture's assertions are about. Parking the resume checkpoint on the last
 * candidate sorted below the fixture is the same checkpoint the batch itself
 * writes, so the fixture is picked first without any foreign row being
 * touched. Returns the checkpoint the control row now carries.
 */
async function resumeCredentialPhaseBefore(
  client: PoolClient,
  organizationId: string,
): Promise<string | null> {
  const result = await client.query<{ organization_checkpoint: string | null }>(
    `UPDATE data_cell_topology_cutovers
     SET organization_checkpoint = (
       SELECT max(organization_id) FROM (
         SELECT organization_id FROM google_connections
         WHERE credential_use_state = 'active'
         UNION
         SELECT organization_id FROM google_organization_credential_homes
         WHERE superseded_at IS NULL
       ) candidate
       WHERE organization_id < $1
     ), updated_at = now()
     WHERE singleton = TRUE
     RETURNING organization_checkpoint`,
    [organizationId],
  )
  return result.rows[0]?.organization_checkpoint ?? null
}

/**
 * An upper bound on the batchSize-1 invocations a report still needs: one per
 * remaining Property, one per remaining credential connection, one more for
 * each Organization whose authority moves without any connection changing,
 * and one for each of the three phase advances. Rows other files left behind
 * are drained by the same batches, so the bound has to come from the live
 * report rather than from the number of fixtures the test inserted.
 */
async function singleRowInvocationBound(
  pool: Pool,
  report: DataCellCutoverReport,
): Promise<number> {
  const connections = await pool.query<{ count: string }>(
    `SELECT count(*) FROM google_connections WHERE credential_use_state = 'active'`,
  )
  return (
    report.remaining.properties +
    report.remaining.credentialHomes +
    Number(connections.rows[0]!.count) +
    3
  )
}

async function clearFixtures(client: PoolClient): Promise<void> {
  await client.query(`DELETE FROM region_moves WHERE organization_id LIKE $1`, [
    `${TEST_ORG_PREFIX}%`,
  ])
  await client.query(`DELETE FROM google_connections WHERE organization_id LIKE $1`, [
    `${TEST_ORG_PREFIX}%`,
  ])
  await client.query(
    `DELETE FROM google_organization_credential_homes
     WHERE organization_id LIKE $1`,
    [`${TEST_ORG_PREFIX}%`],
  )
  await client.query(`DELETE FROM properties WHERE organization_id LIKE $1`, [
    `${TEST_ORG_PREFIX}%`,
  ])
  await drainWorkflowAdmissions(client)
  await resetControl(client)
}

async function insertProperty(
  client: PoolClient,
  organizationId: string,
  region: 'us' | 'europe' | 'global' | 'unresolved',
  policyVersion: number,
  countryCode: string | null = null,
): Promise<string> {
  const id = randomUUID()
  await client.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, processing_region,
       data_cell_id, routing_policy_version, country_code
     ) VALUES ($1, $2, $3, $4, 'America/Los_Angeles', $5, $6, $7, $8)`,
    [
      id,
      organizationId,
      `Property ${id}`,
      `property-${id}`,
      region,
      region === 'unresolved' ? null : region,
      policyVersion,
      countryCode,
    ],
  )
  return id
}

async function waitForLockWait(observer: PoolClient, backendPid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const result = await observer.query<{ wait_event_type: string | null }>(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [backendPid],
    )
    if (result.rows[0]?.wait_event_type === 'Lock') return
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('fence transaction did not wait on the admission lock')
}

describe.sequential('0140 durable single-US beta cutover (PostgreSQL)', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  })

  beforeEach(async () => {
    const client = await lease.pool.connect()
    try {
      await clearFixtures(client)
    } finally {
      client.release()
    }
    await bindSingleUsDataCellCutoverTarget(db, RAILWAY_TARGET)
  })

  afterAll(async () => {
    const client = await lease.pool.connect()
    try {
      await clearFixtures(client)
    } finally {
      client.release()
      await lease.release()
    }
  })

  it('installs an enabled database fence for every preflight workflow family', async () => {
    const expected = [
      [
        'authorization_execution_permits',
        'authorization_execution_permits_topology_cutover_fence',
      ],
      ['credential_revoke_permits', 'credential_revoke_permits_topology_cutover_fence'],
      ['gbp_import_jobs', 'gbp_import_jobs_topology_cutover_fence'],
      [
        'gbp_import_request_items',
        'gbp_import_request_item_retries_topology_cutover_fence',
      ],
      ['gbp_import_request_items', 'gbp_import_request_items_topology_cutover_fence'],
      ['gbp_import_requests', 'gbp_import_requests_topology_cutover_fence'],
      ['google_connections', 'google_connections_cleanup_topology_cutover_fence'],
      [
        'google_credential_broker_replay',
        'google_credential_broker_replay_topology_cutover_fence',
      ],
      [
        'google_credential_source_operations',
        'google_credential_source_operations_topology_cutover_fence',
      ],
      [
        'google_subject_authority_guards',
        'google_subject_authority_guards_topology_cutover_fence',
      ],
      [
        'google_subject_authority_guards',
        'google_subject_authority_pointer_topology_cutover_fence',
      ],
      [
        'legacy_import_effect_leases',
        'legacy_import_effect_leases_topology_cutover_fence',
      ],
      ['region_moves', 'region_moves_topology_cutover_fence'],
    ]
    const result = await lease.pool.query<{
      table_name: string
      trigger_name: string
      function_name: string
      enabled: string
    }>(`
      SELECT relation.relname table_name, trigger.tgname trigger_name,
             procedure.proname function_name, trigger.tgenabled enabled
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
      WHERE trigger.tgname LIKE '%_topology_cutover_fence'
        AND procedure.proname = 'guard_data_cell_topology_cutover_work_v1'
      ORDER BY relation.relname, trigger.tgname
    `)
    expect(result.rows.map((row) => [row.table_name, row.trigger_name])).toEqual(expected)
    expect(result.rows.every((row) => row.enabled === 'O')).toBe(true)
  })

  it('keeps the exact Railway binding idempotent through every state and refuses retargeting', async () => {
    const resetClient = await lease.pool.connect()
    try {
      await resetControl(resetClient)
    } finally {
      resetClient.release()
    }
    await expect(bindSingleUsDataCellCutoverTarget(db, RAILWAY_TARGET)).resolves.toEqual(
      RAILWAY_TARGET,
    )
    await expect(bindSingleUsDataCellCutoverTarget(db, RAILWAY_TARGET)).resolves.toEqual(
      RAILWAY_TARGET,
    )

    const client = await lease.pool.connect()
    try {
      await client.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'fenced', fenced_at = now(), updated_at = now()
        WHERE singleton = TRUE
      `)
    } finally {
      client.release()
    }
    await expect(bindSingleUsDataCellCutoverTarget(db, RAILWAY_TARGET)).resolves.toEqual(
      RAILWAY_TARGET,
    )

    const completionClient = await lease.pool.connect()
    try {
      await completionClient.query(
        `UPDATE data_cell_topology_cutovers
         SET state = 'completed', phase = 'completed', completed_at = now(),
             completion_digest_sha256 = $1, updated_at = now()
         WHERE singleton = TRUE`,
        ['a'.repeat(64)],
      )
    } finally {
      completionClient.release()
    }
    await expect(bindSingleUsDataCellCutoverTarget(db, RAILWAY_TARGET)).resolves.toEqual(
      RAILWAY_TARGET,
    )
    await expect(
      bindSingleUsDataCellCutoverTarget(db, {
        projectId: RAILWAY_TARGET.projectId,
        environmentId: 'another-environment',
      }),
    ).rejects.toThrow('does not match its binding')

    const report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    expect(report).toMatchObject({
      state: 'completed',
      target: {
        cell: 'us',
        policyVersion: 3,
        projectId: RAILWAY_TARGET.projectId,
        environmentId: RAILWAY_TARGET.environmentId,
      },
    })
  })

  it('refuses to start the cutover when deploy migration target binding is absent', async () => {
    const client = await lease.pool.connect()
    try {
      await resetControl(client)
    } finally {
      client.release()
    }
    const report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    await expect(
      applySingleUsDataCellCutoverBatch(db, {
        ...TARGET_BINDING,
        expectedReportDigestSha256: report.digestSha256,
        batchSize: 1,
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-unbound-target',
        now: new Date(),
      }),
    ).rejects.toThrow('must be bound by the deploy migration before apply')
  })

  it('orders a concurrent workflow admission before the fence and refuses the next one', async () => {
    const setup = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}concurrency`
    let propertyId: string
    try {
      propertyId = await insertProperty(setup, organizationId, 'us', 3)
    } finally {
      setup.release()
    }

    const admission = await lease.pool.connect()
    const fence = await lease.pool.connect()
    const observer = await lease.pool.connect()
    try {
      await admission.query('BEGIN')
      await admission.query(
        `INSERT INTO region_moves (
           id, property_id, organization_id, from_region, to_region,
           state, requested_by
         ) VALUES ($1, $2, $3, 'us', 'europe', 'requested', 'fixture')`,
        [randomUUID(), propertyId, organizationId],
      )

      await fence.query('BEGIN')
      const fencePid = (await fence.query<{ pid: number }>('SELECT pg_backend_pid() pid'))
        .rows[0]!.pid
      const fenceUpdate = fence.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'fenced', fenced_at = now(),
            target_project_id = 'railway-project-us-test',
            target_environment_id = 'railway-environment-us-test',
            updated_at = now()
        WHERE singleton = TRUE
      `)
      await waitForLockWait(observer, fencePid)

      await admission.query('COMMIT')
      await fenceUpdate
      await fence.query('COMMIT')

      await expect(
        observer.query(
          `INSERT INTO region_moves (
             id, property_id, organization_id, from_region, to_region,
             state, requested_by
           ) VALUES ($1, $2, $3, 'us', 'europe', 'requested', 'fixture')`,
          [randomUUID(), propertyId, organizationId],
        ),
      ).rejects.toThrow('Data Cell topology cutover admission is fenced')
    } finally {
      await admission.query('ROLLBACK').catch(() => undefined)
      await fence.query('ROLLBACK').catch(() => undefined)
      admission.release()
      fence.release()
      observer.release()
    }
  })

  it('pins resolved Property writes to US policy 3 after completion', async () => {
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}completed`
    try {
      const legacyId = await insertProperty(client, organizationId, 'europe', 2)
      await client.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'completed', phase = 'completed', fenced_at = now(),
            completed_at = now(), completion_digest_sha256 = repeat('a', 64),
            target_project_id = 'railway-project-us-test',
            target_environment_id = 'railway-environment-us-test',
            updated_at = now()
        WHERE singleton = TRUE
      `)
      await expect(insertProperty(client, organizationId, 'europe', 3)).rejects.toThrow(
        'Data Cell topology cutover admission is fenced',
      )
      await expect(
        client.query(`UPDATE properties SET processing_region = 'europe' WHERE id = $1`, [
          legacyId,
        ]),
      ).rejects.toThrow('Data Cell topology cutover admission is fenced')
      await expect(insertProperty(client, organizationId, 'us', 3)).resolves.toEqual(
        expect.any(String),
      )
      await expect(
        insertProperty(client, organizationId, 'unresolved', 1),
      ).resolves.toEqual(expect.any(String))

      await expect(
        client.query(
          `INSERT INTO google_organization_credential_homes (
             organization_id, authority_generation, home_cell_id,
             catalogue_policy_version, transition_reason, changed_by,
             effective_from
           ) VALUES ($1, 1, 'us', 3, 'new_grant', 'fixture',
             now() + interval '1 hour')`,
          [`${organizationId}-future`],
        ),
      ).rejects.toThrow('Data Cell topology cutover admission is fenced')

      const connectionInsert = `INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by,
        credential_use_state, credential_home_cell_id,
        credential_home_policy_version, credential_home_authority_generation
      ) VALUES ($1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
        ARRAY['scope']::text[], 'fixture', 'active', $4, $5, $6)`
      await expect(
        client.query(connectionInsert, [
          randomUUID(),
          `${organizationId}-null`,
          `subject-${randomUUID()}`,
          null,
          null,
          null,
        ]),
      ).rejects.toThrow('Data Cell topology cutover admission is fenced')
      await expect(
        client.query(connectionInsert, [
          randomUUID(),
          `${organizationId}-bogus`,
          `subject-${randomUUID()}`,
          'us',
          3,
          99,
        ]),
      ).rejects.toThrow('Data Cell topology cutover admission is fenced')

      const exactOrganizationId = `${organizationId}-exact`
      await client.query(
        `INSERT INTO google_organization_credential_homes (
           organization_id, authority_generation, home_cell_id,
           catalogue_policy_version, transition_reason, changed_by,
           effective_from
         ) VALUES ($1, 1, 'us', 3, 'new_grant', 'fixture',
           now() - interval '1 second')`,
        [exactOrganizationId],
      )
      await expect(
        client.query(connectionInsert, [
          randomUUID(),
          exactOrganizationId,
          `subject-${randomUUID()}`,
          'us',
          3,
          1,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 })
    } finally {
      client.release()
    }
  })

  it('converges a supported-country unresolved Property but leaves invalid country data for review', async () => {
    const baseline = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}supported-country`
    let supportedPropertyId: string
    let invalidPropertyId: string
    try {
      supportedPropertyId = await insertProperty(
        client,
        organizationId,
        'unresolved',
        1,
        'BG',
      )
      invalidPropertyId = await insertProperty(
        client,
        organizationId,
        'unresolved',
        1,
        'ZZ',
      )
    } finally {
      client.release()
    }

    let report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    expect(report.remaining).toEqual({
      properties: baseline.remaining.properties + 1,
      resolvableProperties: baseline.remaining.resolvableProperties + 1,
      credentialHomes: baseline.remaining.credentialHomes,
      unresolvedProperties: baseline.remaining.unresolvedProperties + 1,
    })
    const activated = await applySingleUsDataCellCutoverBatch(db, {
      ...TARGET_BINDING,
      expectedReportDigestSha256: report.digestSha256,
      batchSize: 1,
      operatorId: 'operator@example.com',
      changeTicket: 'OPS-57',
      correlationId: 'correlation-supported-country',
      now: new Date(),
    })
    report = activated.report
    // A batch converges one Property per invocation over the whole table, so
    // the supported-country fixture converges in the invocation that reaches
    // it — the first one only when no other file left a resolvable Property.
    const propertyInvocations = report.remaining.properties
    for (let step = 0; step < propertyInvocations; step++) {
      const converged = await applySingleUsDataCellCutoverBatch(db, {
        ...TARGET_BINDING,
        expectedReportDigestSha256: report.digestSha256,
        batchSize: 1,
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-supported-country',
        now: new Date(Date.now() + step),
      })
      expect(converged, JSON.stringify(converged.report, null, 2)).toMatchObject({
        outcome: 'properties_processed',
        processed: 1,
      })
      report = converged.report
    }
    expect(report.remaining).toMatchObject({
      properties: 0,
      unresolvedProperties: baseline.remaining.unresolvedProperties + 1,
    })

    const rows = await lease.pool.query<{
      id: string
      data_cell_id: string | null
      processing_region: string
      routing_policy_version: number
    }>(
      `SELECT id, data_cell_id, processing_region, routing_policy_version
       FROM properties WHERE id IN ($1, $2) ORDER BY id`,
      [supportedPropertyId, invalidPropertyId],
    )
    expect(rows.rows.find((row) => row.id === supportedPropertyId)).toMatchObject({
      data_cell_id: 'us',
      processing_region: 'us',
      routing_policy_version: 3,
    })
    expect(rows.rows.find((row) => row.id === invalidPropertyId)).toMatchObject({
      data_cell_id: null,
      processing_region: 'unresolved',
      routing_policy_version: 1,
    })

    const bound = await singleRowInvocationBound(lease.pool, report)
    for (let step = 0; step < bound && report.state !== 'completed'; step++) {
      const result = await applySingleUsDataCellCutoverBatch(db, {
        ...TARGET_BINDING,
        expectedReportDigestSha256: report.digestSha256,
        batchSize: 1,
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-supported-country',
        now: new Date(Date.now() + step + 1),
      })
      report = result.report
    }
    expect(report).toMatchObject({
      state: 'completed',
      remaining: {
        properties: 0,
        unresolvedProperties: baseline.remaining.unresolvedProperties + 1,
      },
    })
  })

  it('limits one credential invocation to the requested number of active connection rows and resumes', async () => {
    const baseline = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}row-bounded`
    try {
      for (let index = 0; index < 3; index++) {
        await client.query(
          `INSERT INTO google_connections (
             id, organization_id, google_subject, encrypted_access_token,
             encrypted_refresh_token, token_expires_at, scopes, connected_by,
             credential_use_state, credential_home_cell_id,
             credential_home_policy_version,
             credential_home_authority_generation
           ) VALUES ($1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
             ARRAY['scope']::text[], 'fixture', 'active', NULL, NULL, NULL)`,
          [randomUUID(), organizationId, `subject-${randomUUID()}`],
        )
      }
      await client.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'fenced', phase = 'credential_homes', fenced_at = now(),
            target_project_id = 'railway-project-us-test',
            target_environment_id = 'railway-environment-us-test',
            operator_id = 'operator@example.com', change_ticket = 'OPS-57',
            correlation_id = 'correlation-row-bounded', updated_at = now()
        WHERE singleton = TRUE
      `)
      await resumeCredentialPhaseBefore(client, organizationId)
    } finally {
      client.release()
    }

    let report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    for (let expectedUpdated = 1; expectedUpdated <= 3; expectedUpdated++) {
      const result = await applySingleUsDataCellCutoverBatch(db, {
        ...TARGET_BINDING,
        expectedReportDigestSha256: report.digestSha256,
        batchSize: 1,
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-row-bounded',
        now: new Date(Date.now() + expectedUpdated),
      })
      expect(result).toMatchObject({
        outcome: 'credential_homes_processed',
        processed: 1,
        report: {
          progress: { credentialConnectionsProcessed: expectedUpdated },
        },
      })
      const updated = await lease.pool.query<{ count: string }>(
        `SELECT count(*) FROM google_connections
         WHERE organization_id = $1
           AND credential_home_cell_id = 'us'
           AND credential_home_policy_version = 3`,
        [organizationId],
      )
      expect(Number(updated.rows[0]!.count)).toBe(expectedUpdated)
      if (expectedUpdated < 3) {
        expect(result.report).toMatchObject({
          checkpoints: {
            activeCredentialOrganizationId: organizationId,
            credentialConnectionId: expect.any(String),
          },
          progress: { credentialHomesProcessed: 0 },
          remaining: { credentialHomes: baseline.remaining.credentialHomes + 1 },
        })
      } else {
        expect(result.report).toMatchObject({
          checkpoints: {
            organizationId,
            activeCredentialOrganizationId: null,
            credentialConnectionId: null,
          },
          progress: { credentialHomesProcessed: 1 },
          remaining: { credentialHomes: baseline.remaining.credentialHomes },
        })
      }
      report = result.report
    }
  })

  it('rolls back authority, connection, and checkpoint mutations when a credential write fails', async () => {
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}rollback`
    let resumeCheckpoint: string | null
    try {
      await client.query(
        `INSERT INTO google_organization_credential_homes (
           organization_id, authority_generation, home_cell_id,
           catalogue_policy_version, transition_reason, changed_by,
           effective_from
         ) VALUES ($1, 1, 'europe', 2, 'new_grant', 'fixture',
           now() - interval '1 day')`,
        [organizationId],
      )
      for (let index = 0; index < 2; index++) {
        await client.query(
          `INSERT INTO google_connections (
             id, organization_id, google_subject, encrypted_access_token,
             encrypted_refresh_token, token_expires_at, scopes, connected_by,
             credential_use_state, credential_home_cell_id,
             credential_home_policy_version,
             credential_home_authority_generation
           ) VALUES ($1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
             ARRAY['scope']::text[], 'fixture', 'active', 'europe', 2, 1)`,
          [randomUUID(), organizationId, `subject-${randomUUID()}`],
        )
      }
      await client.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'fenced', phase = 'credential_homes', fenced_at = now(),
            target_project_id = 'railway-project-us-test',
            target_environment_id = 'railway-environment-us-test',
            operator_id = 'operator@example.com', change_ticket = 'OPS-57',
            correlation_id = 'correlation-rollback', updated_at = now()
        WHERE singleton = TRUE
      `)
      resumeCheckpoint = await resumeCredentialPhaseBefore(client, organizationId)
      await client.query(`
        CREATE OR REPLACE FUNCTION test_single_us_cutover_connection_failure()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.organization_id = 'org-single-us-cutover-rollback' THEN
            RAISE EXCEPTION 'injected credential update failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `)
      await client.query(`
        CREATE TRIGGER test_single_us_cutover_connection_failure
        BEFORE UPDATE ON google_connections
        FOR EACH ROW EXECUTE FUNCTION test_single_us_cutover_connection_failure()
      `)
    } finally {
      client.release()
    }

    try {
      const report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
      let failure: unknown
      try {
        await applySingleUsDataCellCutoverBatch(db, {
          ...TARGET_BINDING,
          expectedReportDigestSha256: report.digestSha256,
          batchSize: 2,
          operatorId: 'operator@example.com',
          changeTicket: 'OPS-57',
          correlationId: 'correlation-rollback',
          now: new Date(),
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DataCellCredentialCutoverError)
      expect(failure).toMatchObject({ code: 'credential_batch_mutation_failed' })

      const authority = await lease.pool.query<{
        authority_generation: number
        home_cell_id: string
        superseded_at: Date | null
      }>(
        `SELECT authority_generation, home_cell_id, superseded_at
         FROM google_organization_credential_homes
         WHERE organization_id = $1 ORDER BY authority_generation`,
        [organizationId],
      )
      expect(authority.rows).toEqual([
        { authority_generation: 1, home_cell_id: 'europe', superseded_at: null },
      ])
      const connections = await lease.pool.query<{
        credential_home_cell_id: string
        access_version: number
        credential_generation: number
      }>(
        `SELECT credential_home_cell_id, access_version, credential_generation
         FROM google_connections WHERE organization_id = $1 ORDER BY id`,
        [organizationId],
      )
      expect(connections.rows).toEqual([
        {
          credential_home_cell_id: 'europe',
          access_version: 1,
          credential_generation: 1,
        },
        {
          credential_home_cell_id: 'europe',
          access_version: 1,
          credential_generation: 1,
        },
      ])
      const progress = await lease.pool.query<{
        organization_checkpoint: string | null
        credential_active_organization_id: string | null
        credential_connection_checkpoint: string | null
        credential_homes_processed: string
        credential_connections_processed: string
      }>(`
        SELECT organization_checkpoint, credential_active_organization_id,
               credential_connection_checkpoint, credential_homes_processed,
               credential_connections_processed
        FROM data_cell_topology_cutovers WHERE singleton = TRUE
      `)
      expect(progress.rows[0]).toEqual({
        // The resume checkpoint the setup parked here is the one the failed
        // invocation must leave untouched.
        organization_checkpoint: resumeCheckpoint,
        credential_active_organization_id: null,
        credential_connection_checkpoint: null,
        credential_homes_processed: '0',
        credential_connections_processed: '0',
      })
    } finally {
      await lease.pool.query(
        'DROP TRIGGER IF EXISTS test_single_us_cutover_connection_failure ON google_connections',
      )
      await lease.pool.query(
        'DROP FUNCTION IF EXISTS test_single_us_cutover_connection_failure()',
      )
    }
  })

  it('processes one bounded batch at a time, resumes, verifies, and reruns safely', async () => {
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}operator-a`
    const secondOrganizationId = `${TEST_ORG_PREFIX}operator-b`
    try {
      for (let index = 0; index < 3; index++) {
        await insertProperty(client, organizationId, 'europe', 2)
      }
      await client.query(
        `INSERT INTO google_organization_credential_homes (
           organization_id, authority_generation, home_cell_id,
           catalogue_policy_version, transition_reason, changed_by,
           change_ticket, effective_from
         ) VALUES ($1, 1, 'europe', 2, 'new_grant', 'fixture', 'fixture',
           now() - interval '1 day')`,
        [organizationId],
      )
      for (const [org, generation] of [
        [organizationId, 1],
        [secondOrganizationId, null],
      ] as const) {
        await client.query(
          `INSERT INTO google_connections (
             id, organization_id, google_subject, encrypted_access_token,
             encrypted_refresh_token, token_expires_at, scopes, connected_by,
             credential_use_state, credential_home_cell_id,
             credential_home_policy_version,
             credential_home_authority_generation
           ) VALUES (
             $1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
             ARRAY['scope']::text[], 'fixture', 'active',
             $4, $5, $6
           )`,
          [
            randomUUID(),
            org,
            `subject-${randomUUID()}`,
            generation === null ? null : 'europe',
            generation === null ? null : 2,
            generation,
          ],
        )
      }
    } finally {
      client.release()
    }

    const firstReport = await db.transaction((tx) =>
      createSingleUsDataCellCutoverReport(tx),
    )
    expect(firstReport.totalBlockers, JSON.stringify(firstReport, null, 2)).toBe(0)
    // FLOOR. Every count below is baseline-relative, which is what makes this
    // suite order-independent — and would also let it pass vacuously if the
    // report's predicate and the batch predicate ever stopped seeing the
    // fixtures TOGETHER: `[]` equals `[]` and `0` equals `0`. This pins the
    // three Properties and two credential-home candidates the setup above
    // actually inserted, so "converged everything the report counted" cannot
    // quietly become "converged nothing".
    expect(firstReport.remaining.properties).toBeGreaterThanOrEqual(3)
    expect(firstReport.remaining.credentialHomes).toBeGreaterThanOrEqual(2)
    const activated = await applySingleUsDataCellCutoverBatch(db, {
      ...TARGET_BINDING,
      expectedReportDigestSha256: firstReport.digestSha256,
      batchSize: 1,
      operatorId: 'operator@example.com',
      changeTicket: 'OPS-57',
      correlationId: 'correlation-57',
      now: new Date(),
    })
    expect(activated.outcome).toBe('fence_activated')

    const propertyBatchSizes: number[] = []
    const fixtureCredentialBatchSizes: number[] = []
    let finalReport = activated.report
    const bound = await singleRowInvocationBound(lease.pool, finalReport)
    for (let step = 0; step < bound && finalReport.state !== 'completed'; step++) {
      const result = await applySingleUsDataCellCutoverBatch(db, {
        ...TARGET_BINDING,
        expectedReportDigestSha256: finalReport.digestSha256,
        batchSize: 1,
        operatorId: 'operator@example.com',
        changeTicket: 'OPS-57',
        correlationId: 'correlation-57',
        now: new Date(Date.now() + step + 1),
      })
      if (result.outcome === 'properties_processed') {
        propertyBatchSizes.push(result.processed)
      }
      if (result.outcome === 'credential_homes_processed') {
        // An invocation names the Organization it worked: the active one while
        // its connections are still draining, the checkpointed one once it is
        // closed. Rows other files left behind are drained by the same run, so
        // only the fixtures' invocations carry the row-bounded claim.
        const worked =
          result.report.checkpoints.activeCredentialOrganizationId ??
          result.report.checkpoints.organizationId
        if (worked === organizationId || worked === secondOrganizationId) {
          fixtureCredentialBatchSizes.push(result.processed)
        }
      }
      expect(result.outcome, JSON.stringify(result.report, null, 2)).not.toBe('blocked')
      finalReport = result.report
    }

    // Every Property the report counted converges, one per invocation, and
    // every candidate Organization is closed exactly once — fixtures and
    // foreign leftovers alike, which is why both counts come from the report.
    expect(propertyBatchSizes).toEqual(
      Array.from({ length: firstReport.remaining.properties }, () => 1),
    )
    expect(fixtureCredentialBatchSizes).toEqual([1, 1])
    expect(finalReport).toMatchObject({
      state: 'completed',
      phase: 'completed',
      progress: {
        propertiesProcessed: firstReport.remaining.properties,
        credentialHomesProcessed: firstReport.remaining.credentialHomes,
        errorCount: 0,
      },
      remaining: { properties: 0, credentialHomes: 0 },
      totalBlockers: 0,
    })

    const rerun = await applySingleUsDataCellCutoverBatch(db, {
      ...TARGET_BINDING,
      expectedReportDigestSha256: finalReport.digestSha256,
      batchSize: 1,
      operatorId: 'operator@example.com',
      changeTicket: 'OPS-57',
      correlationId: 'correlation-57',
      now: new Date(),
    })
    expect(rerun).toMatchObject({ outcome: 'already_completed', processed: 0 })

    const postCompletion = await lease.pool.connect()
    try {
      const property = await postCompletion.query<{ id: string }>(
        `SELECT id FROM properties WHERE organization_id = $1 LIMIT 1`,
        [organizationId],
      )
      await postCompletion.query(
        `INSERT INTO region_moves (
           id, property_id, organization_id, from_region, to_region,
           state, requested_by
         ) VALUES ($1, $2, $3, 'us', 'europe', 'requested', 'fixture')`,
        [randomUUID(), property.rows[0]!.id, organizationId],
      )
    } finally {
      postCompletion.release()
    }
    await expect(readCompletedSingleUsDataCellCutover(db)).resolves.toMatchObject({
      errorCount: 0,
      propertiesProcessed: firstReport.remaining.properties,
      credentialHomesProcessed: firstReport.remaining.credentialHomes,
      verification: {
        remainingProperties: 0,
        resolvablePropertiesRemaining: 0,
        remainingCredentialHomes: 0,
        activeWorkflowBlockers: 1,
        routingConflicts: 0,
      },
    })
  })

  it('retries after a recorded row error and clears it only on a successful batch', async () => {
    const client = await lease.pool.connect()
    const organizationId = `${TEST_ORG_PREFIX}error-recovery`
    try {
      await client.query(
        `INSERT INTO google_organization_credential_homes (
           organization_id, authority_generation, home_cell_id,
           catalogue_policy_version, transition_reason, changed_by,
           effective_from
         ) VALUES ($1, 1, 'europe', 2, 'new_grant', 'fixture',
           now() - interval '1 day')`,
        [organizationId],
      )
      await client.query(
        `INSERT INTO google_connections (
           id, organization_id, google_subject, encrypted_access_token,
           encrypted_refresh_token, token_expires_at, scopes, connected_by,
           credential_use_state, credential_home_cell_id,
           credential_home_policy_version,
           credential_home_authority_generation
         ) VALUES ($1, $2, $3, 'access', 'refresh', now() + interval '1 hour',
           ARRAY['scope']::text[], 'fixture', 'active', 'europe', 2, 1)`,
        [randomUUID(), organizationId, `subject-${randomUUID()}`],
      )
      await client.query(`
        UPDATE data_cell_topology_cutovers
        SET state = 'fenced', phase = 'credential_homes', fenced_at = now(),
            target_project_id = 'railway-project-us-test',
            target_environment_id = 'railway-environment-us-test',
            error_count = 1, last_error_code = 'previous_row_error',
            operator_id = 'operator@example.com', change_ticket = 'OPS-57',
            correlation_id = 'correlation-57', updated_at = now()
        WHERE singleton = TRUE
      `)
      await resumeCredentialPhaseBefore(client, organizationId)
    } finally {
      client.release()
    }

    const report = await db.transaction((tx) => createSingleUsDataCellCutoverReport(tx))
    expect(report).toMatchObject({
      totalBlockers: 0,
      progress: { errorCount: 1, lastErrorCode: 'previous_row_error' },
    })
    const recovered = await applySingleUsDataCellCutoverBatch(db, {
      ...TARGET_BINDING,
      expectedReportDigestSha256: report.digestSha256,
      batchSize: 1,
      operatorId: 'operator@example.com',
      changeTicket: 'OPS-57',
      correlationId: 'correlation-57',
      now: new Date(),
    })
    expect(recovered).toMatchObject({
      outcome: 'credential_homes_processed',
      processed: 1,
      report: { progress: { errorCount: 0, lastErrorCode: null } },
    })
  })
})
