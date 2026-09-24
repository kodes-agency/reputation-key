// The user-scoped access-removal read, against PostgreSQL.
//
// It is the one read in this context that is not organization-scoped, so what
// it must NOT do is as much the subject as what it must: it answers for the
// caller alone, from the one type that is about their own account, with an
// instant and nothing else.

import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createAccountAccessRemovalReader } from './account-access-removal.repository'

const ORG = organizationId('f3a20000-0000-4000-8000-000000000001')
const OTHER_ORG = organizationId('f3a20000-0000-4000-8000-000000000002')
const REMOVED = userId('user-access-removal-subject')
const SOMEONE_ELSE = userId('user-access-removal-bystander')

const EARLIER = new Date('2026-09-01T09:00:00.000Z')
const LATER = new Date('2026-09-20T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['notifications'],
})

const db = (): Database => drizzle(getPool()) as unknown as Database

async function seedNotice(
  input: Readonly<{
    id: string
    user: string
    organization: string
    type: string
    category: string
    createdAt: Date
  }>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority,
       status, resource_type, resource_id, event_id, title, body, payload,
       created_at, updated_at
     ) VALUES ($1::uuid, $2, $3, NULL, $4, $5, 'normal', 'unread', 'organization',
       $3, $6, 'Organization access removed', NULL, '{}'::jsonb, $7, $7)`,
    [
      input.id,
      input.user,
      input.organization,
      input.type,
      input.category,
      input.id,
      input.createdAt.toISOString(),
    ],
  )
}

describe('account access removal read', () => {
  it('answers with the most recent removal of the caller, across organizations', async () => {
    await seedNotice({
      id: 'f3a20000-0000-4000-8000-000000000010',
      user: REMOVED as string,
      organization: ORG as string,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      createdAt: EARLIER,
    })
    await seedNotice({
      id: 'f3a20000-0000-4000-8000-000000000011',
      user: REMOVED as string,
      organization: OTHER_ORG as string,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      createdAt: LATER,
    })

    await expect(
      createAccountAccessRemovalReader(db()).findLatestForUser(REMOVED),
    ).resolves.toEqual({ removedAt: LATER })
  })

  it('tells the caller nothing about the workspace beyond when it happened', async () => {
    await seedNotice({
      id: 'f3a20000-0000-4000-8000-000000000012',
      user: REMOVED as string,
      organization: ORG as string,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      createdAt: LATER,
    })

    const removal =
      await createAccountAccessRemovalReader(db()).findLatestForUser(REMOVED)

    expect(Object.keys(removal ?? {})).toEqual(['removedAt'])
  })

  it('never answers with somebody else’s removal, or with another kind of notice', async () => {
    await seedNotice({
      id: 'f3a20000-0000-4000-8000-000000000013',
      user: SOMEONE_ELSE as string,
      organization: ORG as string,
      type: 'account.organization_access_removed',
      category: 'mandatory',
      createdAt: LATER,
    })
    await seedNotice({
      id: 'f3a20000-0000-4000-8000-000000000014',
      user: REMOVED as string,
      organization: ORG as string,
      type: 'account.organization_role_changed',
      category: 'mandatory',
      createdAt: LATER,
    })

    await expect(
      createAccountAccessRemovalReader(db()).findLatestForUser(REMOVED),
    ).resolves.toBeNull()
  })
})
