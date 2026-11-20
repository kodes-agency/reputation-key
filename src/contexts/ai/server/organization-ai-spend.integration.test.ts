// Organization AI spend server function, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { ORGANIZATION_MONTHLY_CAP_MICROS } from '#/shared/db/ai/ai-budget'
import {
  setupServerFunctionHarness,
  type TestOrganization,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getOrganizationAiSpendFn } from './organization-ai-spend'

const NOW = new Date('2026-09-15T12:00:00Z')
const THIS_MONTH = Date.UTC(2026, 8, 1)
const MID_THIS_MONTH = NOW.getTime()
const MID_LAST_MONTH = Date.UTC(2026, 7, 15, 12)

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: ['ai_organization_cost_windows'],
})

/** Written in a UTC session: the table's CHECK cuts months in the session's zone, as the app's connections do. */
async function seedWindow(
  organization: TestOrganization,
  window: { start: number; reserved: number; settled: number; cap: number },
) {
  const client = await harness.pool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL TIME ZONE 'UTC'`)
    await client.query(
      `INSERT INTO ai_organization_cost_windows
         (id, organization_id, window_start, reserved_micros, settled_micros, cap_micros)
       VALUES (gen_random_uuid(), $1, date_trunc('month', $2::timestamptz), $3, $4, $5)`,
      [
        organization.id,
        new Date(window.start),
        window.reserved,
        window.settled,
        window.cap,
      ],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  return { organization, admin }
}

describe('getOrganizationAiSpendFn', () => {
  it('gives an AccountAdmin this month’s amounts against the cap', async () => {
    const { organization, admin } = await hotel()
    await seedWindow(organization, {
      start: MID_THIS_MONTH,
      reserved: 40_000,
      settled: 1_250_000,
      cap: 25_000_000,
    })

    const spend = await harness.callAs(admin, () => getOrganizationAiSpendFn())

    expect(spend).toEqual({
      capMicros: 25_000_000,
      monthStartEpochMillis: THIS_MONTH,
      reservedMicros: 40_000,
      settledMicros: 1_250_000,
    })
  })

  it('answers zero spend under the default cap when no window exists yet', async () => {
    const { admin } = await hotel()

    const spend = await harness.callAs(admin, () => getOrganizationAiSpendFn())

    expect(spend).toEqual({
      capMicros: ORGANIZATION_MONTHLY_CAP_MICROS,
      monthStartEpochMillis: THIS_MONTH,
      reservedMicros: 0,
      settledMicros: 0,
    })
  })

  it('does not count the previous month’s window against this month', async () => {
    const { organization, admin } = await hotel()
    await seedWindow(organization, {
      start: MID_LAST_MONTH,
      reserved: 0,
      settled: 9_000_000,
      cap: 25_000_000,
    })

    const spend = await harness.callAs(admin, () => getOrganizationAiSpendFn())

    expect(spend).toMatchObject({ settledMicros: 0, reservedMicros: 0 })
  })

  it('refuses a PropertyManager even with a Property grant', async () => {
    const { organization } = await hotel()
    const manager = await harness.seedMember(organization, 'PropertyManager')
    const property = await harness.seedProperty(organization)
    await harness.grantProperty(manager, property)

    await expect(
      harness.callAs(manager, () => getOrganizationAiSpendFn()),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => getOrganizationAiSpendFn()),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => getOrganizationAiSpendFn()),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('reads the session Organization when the client names another', async () => {
    const { organization, admin } = await hotel()
    const elsewhere = await harness.seedOrganization()
    await seedWindow(organization, {
      start: MID_THIS_MONTH,
      reserved: 0,
      settled: 111_000,
      cap: 25_000_000,
    })
    await seedWindow(elsewhere, {
      start: MID_THIS_MONTH,
      reserved: 0,
      settled: 777_000,
      cap: 25_000_000,
    })

    const spend = await harness.callAs(admin, () =>
      getOrganizationAiSpendFn({
        data: { organizationId: elsewhere.id },
      } as never),
    )

    expect(spend).toMatchObject({ settledMicros: 111_000 })
  })
})
