import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { ORGANIZATION_MONTHLY_CAP_MICROS } from '#/shared/db/ai/ai-budget'
import { organizationId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createAiOrganizationSpendAdapter } from './ai-organization-spend.adapter'

const ORGANIZATION = organizationId(`ai-spend-${randomUUID()}`)
const OTHER_ORGANIZATION = organizationId(`ai-spend-${randomUUID()}`)
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

describe.sequential('AI organization spend adapter (real PostgreSQL)', () => {
  const db = getDb()
  const spend = createAiOrganizationSpendAdapter(db)
  // The budget writer truncates to the month in the database session, so the
  // expected window start is read the same way rather than assumed to be UTC.
  let monthStart = 0

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES
        (${ORGANIZATION}, 'AI spend test', ${ORGANIZATION}, ${new Date(NOW)}),
        (${OTHER_ORGANIZATION}, 'Other AI spend test', ${OTHER_ORGANIZATION}, ${new Date(NOW)})
    `)
    const result = await db.execute(sql`
      SELECT date_trunc('month', ${new Date(NOW)}::timestamptz) AS start
    `)
    monthStart = new Date((result.rows[0] as { start: string | Date }).start).getTime()
  })

  afterAll(async () => {
    await db.execute(sql`
      DELETE FROM ai_organization_cost_windows
      WHERE organization_id IN (${ORGANIZATION}, ${OTHER_ORGANIZATION})
    `)
    await deleteTestOrganizations(db, [ORGANIZATION, OTHER_ORGANIZATION])
  })

  it('reports nothing spent under the default cap before the first admission', async () => {
    await expect(
      spend.readCurrentMonth({ organizationId: ORGANIZATION, nowEpochMillis: NOW }),
    ).resolves.toEqual({
      monthStartEpochMillis: monthStart,
      settledMicros: 0,
      reservedMicros: 0,
      capMicros: ORGANIZATION_MONTHLY_CAP_MICROS,
    })
  })

  it("reads the current month's window and ignores other months", async () => {
    const now = new Date(NOW)
    await db.execute(sql`
      INSERT INTO ai_organization_cost_windows
        (organization_id, window_start, settled_micros, reserved_micros, cap_micros)
      VALUES
        (${ORGANIZATION}, date_trunc('month', ${now}::timestamptz - interval '1 month'), 9000000, 0, 50000000),
        (${ORGANIZATION}, date_trunc('month', ${now}::timestamptz), 1250000, 30000, 50000000)
    `)

    await expect(
      spend.readCurrentMonth({ organizationId: ORGANIZATION, nowEpochMillis: NOW }),
    ).resolves.toEqual({
      monthStartEpochMillis: monthStart,
      settledMicros: 1_250_000,
      reservedMicros: 30_000,
      capMicros: 50_000_000,
    })
  })

  it('isolates two tenants in the same month, including an exhausted cap', async () => {
    await db.execute(sql`
      INSERT INTO ai_organization_cost_windows
        (organization_id, window_start, settled_micros, reserved_micros, cap_micros)
      VALUES
        (${OTHER_ORGANIZATION}, date_trunc('month', ${new Date(NOW)}::timestamptz),
          49990000, 10000, 50000000)
    `)
    const read = (id: typeof ORGANIZATION) =>
      spend.readCurrentMonth({ organizationId: id, nowEpochMillis: NOW })
    const first = await read(ORGANIZATION)

    await expect(read(OTHER_ORGANIZATION)).resolves.toEqual({
      monthStartEpochMillis: monthStart,
      settledMicros: 49_990_000,
      reservedMicros: 10_000,
      capMicros: 50_000_000,
    })
    await db.execute(sql`
      UPDATE ai_organization_cost_windows
      SET reserved_micros = 0, settled_micros = 50000000
      WHERE organization_id = ${OTHER_ORGANIZATION}
    `)

    await expect(read(ORGANIZATION)).resolves.toEqual(first)
    await expect(read(OTHER_ORGANIZATION)).resolves.toMatchObject({
      settledMicros: 50_000_000,
      reservedMicros: 0,
    })
  })
})
