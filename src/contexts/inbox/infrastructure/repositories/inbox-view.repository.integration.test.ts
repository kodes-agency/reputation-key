import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, userId } from '#/shared/domain/ids'
import { createInboxViewRepository } from './inbox-view.repository'

const ORG_ID = organizationId('org-inbox-view-cutoff-test')
const USER_ID = userId('user-inbox-view-cutoff-test')
const EARLIER = new Date('2026-08-27T12:00:00.000Z')
const LATER = new Date('2026-08-27T12:00:10.000Z')

describe.sequential('Inbox view cutoff repository', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  })

  beforeEach(async () => {
    await pool.query(
      'DELETE FROM inbox_user_views WHERE organization_id = $1 AND user_id = $2',
      [ORG_ID, USER_ID],
    )
  })

  afterAll(async () => {
    await pool.query(
      'DELETE FROM inbox_user_views WHERE organization_id = $1 AND user_id = $2',
      [ORG_ID, USER_ID],
    )
    await pool.end()
  })

  it('never lets an older, slower page response move the watermark backward', async () => {
    const repo = createInboxViewRepository(
      getDb(),
      () => new Date('2026-06-01T12:00:00.000Z'),
    )

    await expect(repo.stampLastInboxView(ORG_ID, USER_ID, LATER)).resolves.toEqual(LATER)
    await expect(repo.stampLastInboxView(ORG_ID, USER_ID, EARLIER)).resolves.toEqual(
      LATER,
    )
    await expect(repo.getLastInboxView(ORG_ID, USER_ID)).resolves.toEqual(LATER)
  })
})
