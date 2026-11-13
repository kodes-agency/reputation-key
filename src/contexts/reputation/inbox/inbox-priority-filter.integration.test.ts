// The Inbox Priority filter on PostgreSQL (ADR 0071). The fixture is that of
// the repository's partition test (`inbox.repository.test.ts`, "the four levels
// plus Not set partition the list"): there `attention` is what the AI id gate
// answers, here it is the seeded suggestion. A level a person set wins,
// feedback matches only through a set level, and the counts add up to the list.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { AiReviewInsightsPort } from '#/contexts/inbox/application/ports/ai-review-insights.port'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import {
  clearInboxOrganization,
  createInboxUseCaseDatabase,
  dropInboxOrganization,
  seedInboxOrganization,
  setStoredManagerPriority,
} from '#/contexts/inbox/infrastructure/inbox-database-fixtures'

const ORG = organizationId('org-priority-fixture')
const PROP = propertyId('94b10000-0000-4000-8000-0000000000a1')
const MANAGER = userId('manager')
const AT = new Date('2026-10-28T09:00:00Z')

type Level = NonNullable<InboxItem['managerPriority']>
type Fixture = Pick<InboxItem, 'attention' | 'managerPriority'>

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await seedInboxOrganization(pool, ORG, [PROP])
})

beforeEach(() => clearInboxOrganization(pool, ORG))

afterAll(async () => {
  await dropInboxOrganization(pool, ORG)
  await pool.end()
})

let sequence = 0

function item(
  name: string,
  sourceType: InboxItem['sourceType'],
  priority: Fixture,
): InboxItem {
  sequence += 1
  const suffix = String(sequence).padStart(12, '0')
  return {
    id: inboxItemId(`94b10000-0000-4000-8000-${suffix}`),
    organizationId: ORG,
    propertyId: PROP,
    sourceType,
    sourceId:
      sourceType === 'review'
        ? reviewId(`94b20000-0000-4000-8000-${suffix}`)
        : feedbackId(`94b30000-0000-4000-8000-${suffix}`),
    status: 'open',
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    rating: null,
    sourceDate: AT,
    platform: sourceType === 'review' ? 'google' : null,
    snippet: name,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: AT,
    updatedAt: AT,
    managerPrioritySetBy: priority.managerPriority ? MANAGER : null,
    managerPrioritySetAt: priority.managerPriority ? AT : null,
    ...priority,
  }
}

/** Reviews the AI suggests a level for, as the id lookup answers it. */
function insightsFor(suggested: ReadonlyArray<InboxItem>): AiReviewInsightsPort {
  return {
    readCurrentReviewAnalysis: async () => ({ status: 'none' }),
    findCurrentReviewIdsByAttention: async ({ attention }) =>
      suggested
        .filter(
          (entry) =>
            entry.sourceType === 'review' &&
            entry.attention != null &&
            attention.includes(entry.attention),
        )
        .map((entry) => entry.sourceId as ReturnType<typeof reviewId>),
    findCurrentReviewIdsByIssue: async () => [],
  }
}

async function seeded() {
  const items = [
    item('ai-urgent', 'review', { attention: 'urgent', managerPriority: null }),
    item('ai-high-set-medium', 'review', {
      attention: 'high',
      managerPriority: 'medium',
    }),
    item('unanalysed', 'review', { attention: null, managerPriority: null }),
    item('feedback-low', 'feedback', { attention: null, managerPriority: 'low' }),
    item('feedback-none', 'feedback', { attention: null, managerPriority: null }),
    // Feedback is never analysed: a seeded value there is not a suggestion.
    item('feedback-stray', 'feedback', { attention: 'urgent', managerPriority: null }),
  ]
  const { repo, seed } = createInboxUseCaseDatabase(pool, () => AT, insightsFor(items))
  await seed(...items)
  for (const entry of items) {
    if (!entry.managerPriority) continue
    await setStoredManagerPriority(pool, entry.id, entry.managerPriority, MANAGER, AT)
  }
  const nameOf = new Map(items.map((entry) => [entry.id, entry.snippet]))

  const ids = async (attention: ReadonlyArray<Level>) => {
    const page = await repo.findFilteredPaginated({ attention }, ORG)
    expect(await repo.countFiltered({ attention }, ORG)).toBe(page.totalCount)
    return page.items.map((entry) => nameOf.get(entry.id)).sort()
  }
  return { repo, ids }
}

describe.sequential('Inbox repository on PostgreSQL: the Priority filter', () => {
  it('matches the effective level, a set level winning over the suggestion', async () => {
    const { ids } = await seeded()

    expect(await ids(['urgent'])).toEqual(['ai-urgent'])
    expect(await ids(['high'])).toEqual([])
    expect(await ids(['medium'])).toEqual(['ai-high-set-medium'])
    expect(await ids(['low'])).toEqual(['feedback-low'])
    expect(await ids(['urgent', 'high'])).toEqual(['ai-urgent'])
  })

  it('partitions the list into the four levels and Not set', async () => {
    const { repo, ids } = await seeded()
    let matched = 0
    for (const level of ['urgent', 'high', 'medium', 'low'] as const) {
      matched += (await ids([level])).length
    }
    const total = await repo.countFiltered({}, ORG)

    // Not set: the unanalysed review and both feedback items with no level.
    expect(total - matched).toBe(3)
  })

  it('starts every created item with no level, as an insert does', async () => {
    const created = item('new', 'review', { attention: null, managerPriority: 'urgent' })
    const { repo, seed } = createInboxUseCaseDatabase(pool, () => AT)
    await seed(created)

    expect(await repo.findById(created.id, ORG)).toMatchObject({
      managerPriority: null,
      managerPrioritySetBy: null,
      managerPrioritySetAt: null,
    })
  })
})
