// Six CHECK constraints compare a deadline with `timestamptz + interval 'N days'`
// (`rg "interval '[0-9]+ days'" src/shared/db/schema`), and the application
// computes those deadlines in fixed milliseconds. PostgreSQL adds days in the
// session's time zone, so the two agree only where a day is always 24 hours. In
// a zone that observes daylight saving they differ by an hour across a change,
// and every insert in that week is refused.
//
// The pool pins each session to UTC. This suite connects the way a server whose
// default zone is Europe/Sofia would answer (`PGOPTIONS` is the startup
// parameter node-postgres sends), and writes a Network Pressure record whose
// seven days cross the end of summer time on 25 October 2026.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { closePool, getPool as getApplicationPool } from './pool'

const DST_ZONE = 'Europe/Sofia'
process.env.PGOPTIONS = `-c TimeZone=${DST_ZONE}`

const ORG_A = organizationId('org-pool-session-time-zone-a')
const ORG_B = organizationId('org-pool-session-time-zone-b')
const PROPERTY_ID = '83000000-0000-4000-8000-000000000010'
const PORTAL_ID = '83000000-0000-4000-8000-000000000011'
const OBSERVED_AT = new Date('2026-10-20T12:00:00.000Z')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['guest_network_pressure_records', 'portals', 'properties'],
})

beforeEach(async () => {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Time zone', 'pool-session-time-zone', 'UTC')`,
    [PROPERTY_ID, ORG_A],
  )
  await getPool().query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES ($1, $2, $3, 'property', $4, 'Portal', 'pool-session-tz', 'published')`,
    [PORTAL_ID, ORG_A, PROPERTY_ID, PROPERTY_ID],
  )
})

afterAll(async () => {
  delete process.env.PGOPTIONS
  await closePool()
})

describe.sequential('pool session time zone (PostgreSQL)', () => {
  it('connects, in this suite, to a session whose default zone adds a 25-hour day', async () => {
    // The fixture pool applies no session guards, so it shows the hazard itself.
    const zone = await getPool().query<{ TimeZone: string }>('SHOW TimeZone')
    const sevenDays = await getPool().query<{ equal: boolean }>(
      `SELECT $1::timestamptz + interval '7 days' = $2::timestamptz AS equal`,
      [OBSERVED_AT, new Date(OBSERVED_AT.getTime() + SEVEN_DAYS_MS)],
    )

    expect(zone.rows).toEqual([{ TimeZone: DST_ZONE }])
    expect(sevenDays.rows).toEqual([{ equal: false }])
  })

  it('pins every application session to UTC whatever the server default is', async () => {
    const zone = await getApplicationPool().query<{ TimeZone: string }>('SHOW TimeZone')

    expect(zone.rows).toEqual([{ TimeZone: 'UTC' }])
  })

  it('stores a deadline counted in hours across a daylight-saving change', async () => {
    // What the Guest store writes: `expires_at` is `observed_at` plus a fixed
    // 168 hours (GUEST_NETWORK_PRESSURE_RETENTION_MS), checked against
    // `observed_at + interval '7 days'`.
    const expiresAt = new Date(OBSERVED_AT.getTime() + SEVEN_DAYS_MS)

    await getApplicationPool().query(
      `INSERT INTO guest_network_pressure_records (
         id, organization_id, property_id, portal_id, pseudonym, action,
         observed_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'rating', $6, $7)`,
      [
        randomUUID(),
        ORG_A,
        PROPERTY_ID,
        PORTAL_ID,
        'b'.repeat(64),
        OBSERVED_AT,
        expiresAt,
      ],
    )

    await expect(
      getPool().query(
        `SELECT expires_at FROM guest_network_pressure_records
          WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, PORTAL_ID],
      ),
    ).resolves.toMatchObject({ rows: [{ expires_at: expiresAt }] })
  })
})
