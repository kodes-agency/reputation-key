// "Not now" on the Overview's Monthly portal goal prompt, on PostgreSQL (ADR
// 0068, PLAN PG-16): one row per Property, moved only on. The rows are
// committed, so each test has a Property of its own in an Organization of its
// own.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createPortalGoalPromptDeferralStore } from './repositories/portal-goal-prompt-deferrals.repository'

describe.sequential('Monthly portal goal prompt deferrals (integration)', () => {
  let lease: TestLease
  const organizationId = `portal-goal-prompt-${randomUUID()}`

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function propertyFixture(): Promise<string> {
    const id = randomUUID()
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Seaview Hotel', $3, 'Europe/Sofia')`,
      [id, organizationId, `pg-prompt-${randomUUID()}`],
    )
    return id
  }

  const at = (iso: string) => new Date(iso)

  it('keeps one row per Property, and only moves its month on', async () => {
    const store = createPortalGoalPromptDeferralStore(getDb())
    const propertyId = await propertyFixture()
    const defer = (month: string, deferredBy: string, deferredAt: Date) =>
      store.defer({ organizationId, propertyId, month, deferredBy, deferredAt })

    await expect(store.deferredMonth(organizationId, propertyId)).resolves.toBeNull()

    await defer('2026-10', 'elena', at('2026-10-10T09:00:00.000Z'))
    await expect(store.deferredMonth(organizationId, propertyId)).resolves.toBe('2026-10')

    await defer('2026-11', 'ivan', at('2026-10-23T09:00:00.000Z'))
    // A tab left open since October puts off a month already gone: nothing moves back.
    await defer('2026-10', 'elena', at('2026-10-24T09:00:00.000Z'))
    await defer('2026-11', 'elena', at('2026-10-25T09:00:00.000Z'))

    const { rows } = await lease.pool.query<{
      month: string
      deferred_by: string
      deferred_at: Date
    }>(
      `SELECT month, deferred_by, deferred_at FROM portal_goal_prompt_deferrals
        WHERE property_id = $1`,
      [propertyId],
    )
    expect(rows).toEqual([
      {
        month: '2026-11',
        deferred_by: 'ivan',
        deferred_at: at('2026-10-23T09:00:00.000Z'),
      },
    ])
  })

  it("reads no other Organization's row, and writes none for a Property it does not hold", async () => {
    const store = createPortalGoalPromptDeferralStore(getDb())
    const propertyId = await propertyFixture()
    await store.defer({
      organizationId,
      propertyId,
      month: '2026-11',
      deferredBy: 'elena',
      deferredAt: at('2026-10-23T09:00:00.000Z'),
    })
    const other = `portal-goal-prompt-other-${randomUUID()}`

    await expect(store.deferredMonth(other, propertyId)).resolves.toBeNull()
    // The Property is not the other Organization's: its row is never written.
    await expect(
      store.defer({
        organizationId: other,
        propertyId,
        month: '2026-12',
        deferredBy: 'mallory',
        deferredAt: at('2026-10-23T10:00:00.000Z'),
      }),
    ).resolves.toBeUndefined()
    await expect(store.deferredMonth(organizationId, propertyId)).resolves.toBe('2026-11')
  })
})
