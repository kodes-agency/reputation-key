// The Google rights executor against real PostgreSQL, driven the way
// scripts/ops/rights-request.ts drives it: parse, plan, run the executors.
// Two tenants are seeded so every case proves the other one is untouched.
// Property-level erasure is in google-rights-executor.property.integration.test.ts.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { watchTenants } from '#/shared/db/testing/rights-tenant-snapshot'
import { GOOGLE_RIGHTS_EXPORT_PATH } from './google-rights-executor'
import {
  MARKERS,
  apply,
  harness,
  rowCount,
  runScript,
  seed,
  snapshot,
  useGoogleRightsHarness,
} from '#/shared/testing/google-rights-executor.test-fixtures'

describe.sequential('Google rights executor through the rights-request command', () => {
  useGoogleRightsHarness((pool) => drizzle(pool) as Database)

  it('exports only the allowlisted lifecycle status of the asked-for tenant', async () => {
    const asked = await seed({ live: true })
    const other = await seed({ live: true })

    const result = await runScript([
      'access',
      '--org',
      asked.organizationId,
      'out=/export',
    ])

    expect(result.exit).toBe(0)
    const file = result.files.get(`/export/${GOOGLE_RIGHTS_EXPORT_PATH}`)
    expect(file).toBeDefined()
    const payload = JSON.parse(file ?? '{}')
    expect(payload.organizationId).toBe(asked.organizationId)
    expect(payload.googleConnections.map((row: { id: string }) => row.id)).toEqual([
      asked.connectionId,
    ])
    expect(payload.importItemStateCounts.length).toBeGreaterThan(0)
    expect(payload.imports.map((row: { id: string }) => row.id)).toEqual([asked.importId])
    expect(
      payload.importItemStateCounts.some(
        (row: { import_job_id: string }) => row.import_job_id === asked.importId,
      ),
    ).toBe(true)
    for (const secret of Object.values(MARKERS)) expect(file).not.toContain(secret)
    expect(file).not.toContain(other.organizationId)
    expect(file).not.toContain(other.connectionId)
  })

  it('refuses a closure while a credential is live and changes nothing for either tenant', async () => {
    const asked = await seed({ live: true })
    const other = await seed({ live: true })
    const tenants = await watchTenants(snapshot, [
      asked.organizationId,
      other.organizationId,
    ])

    const result = await runScript(apply(asked.organizationId))

    expect(result.exit).toBe(1)
    expect(result.err.join('\n')).toContain('live_connections=1')
    expect(result.err.join('\n')).toContain('Disconnect Google')
    await tenants.expectUnchanged()
  })

  it('closes a disconnected tenant, leaves the other one byte-identical, and converges on replay', async () => {
    const asked = await seed({ live: false })
    const other = await seed({ live: false })
    const otherBefore = await snapshot(other.organizationId)

    const first = await runScript(apply(asked.organizationId))
    expect(first.exit).toBe(0)

    for (const table of ['google_import_items', 'google_imports']) {
      expect(await rowCount(table, asked.organizationId)).toBe(0)
    }
    const connection = await harness.lease.pool.query(
      `SELECT connected_by, status_reason, google_subject, encrypted_refresh_token
       FROM google_connections WHERE organization_id = $1`,
      [asked.organizationId],
    )
    expect(connection.rows).toEqual([
      {
        connected_by: 'purged',
        status_reason: 'organization_purged',
        google_subject: null,
        encrypted_refresh_token: 'redacted',
      },
    ])
    expect(await snapshot(other.organizationId)).toBe(otherBefore)

    const afterFirst = await snapshot(asked.organizationId)
    const second = await runScript(apply(asked.organizationId))
    expect(second.exit).toBe(0)
    expect(await snapshot(asked.organizationId)).toBe(afterFirst)
    expect(await snapshot(other.organizationId)).toBe(otherBefore)
  })

  it('reports a tenant without changing it, and refuses an unknown Organization', async () => {
    const asked = await seed({ live: true })
    const before = await snapshot(asked.organizationId)

    const report = await runScript(['organization', '--org', asked.organizationId])
    expect(report.exit).toBe(0)
    expect(report.out.join('\n')).toContain('google-integration: connections=1')
    expect(report.out.join('\n')).toContain('live_connections=1')
    expect(report.out.join('\n')).toContain('imports=1')
    expect(await snapshot(asked.organizationId)).toBe(before)

    const unknown = `rights-missing-${randomUUID()}`
    const refused = await runScript(apply(unknown))
    expect(refused.exit).toBe(1)
    expect(refused.err.join('\n')).toContain('organization not found')
  })

  it('refuses --property on an access request and writes nothing', async () => {
    const asked = await seed({ live: false })

    const result = await runScript([
      'access',
      '--org',
      asked.organizationId,
      '--property',
      asked.propertyId,
      'out=/export',
    ])

    expect(result.exit).toBe(1)
    expect(result.err.join('\n')).toContain('--property is not accepted for access')
    expect(result.files.size).toBe(0)
  })
})
