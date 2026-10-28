// The in-memory Inbox repository's Priority filter agrees with PostgreSQL's
// (ADR 0071). It runs the fixture of the repository's partition test
// (`inbox.repository.test.ts`, "the four levels plus Not set partition the
// list"): there `attention` is what the AI id gate answers, here it is the
// seeded suggestion. A level a person set wins, feedback matches only through a
// set level, and the counts add up to the list.

import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { createInMemoryInboxRepo } from './in-memory-inbox-repo'

const ORG = organizationId('org-priority-fixture')
const AT = new Date('2026-10-28T09:00:00Z')

function item(
  id: string,
  sourceType: InboxItem['sourceType'],
  priority: Pick<InboxItem, 'attention' | 'managerPriority'>,
): InboxItem {
  return {
    id: inboxItemId(id),
    organizationId: ORG,
    propertyId: propertyId('prop-1'),
    sourceType,
    sourceId: sourceType === 'review' ? reviewId(`r-${id}`) : feedbackId(`f-${id}`),
    status: 'open',
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    rating: null,
    sourceDate: AT,
    platform: null,
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: AT,
    updatedAt: AT,
    managerPrioritySetBy: priority.managerPriority ? userId('manager') : null,
    managerPrioritySetAt: priority.managerPriority ? AT : null,
    ...priority,
  }
}

function seeded() {
  const repo = createInMemoryInboxRepo()
  repo.items.push(
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
  )
  return repo
}

const ids = async (
  repo: ReturnType<typeof seeded>,
  attention: ReadonlyArray<'urgent' | 'high' | 'medium' | 'low'>,
) => {
  const page = await repo.findFilteredPaginated({ attention }, ORG)
  expect(await repo.countFiltered({ attention }, ORG)).toBe(page.totalCount)
  return page.items.map((entry) => String(entry.id)).sort()
}

describe('in-memory Inbox repository: the Priority filter', () => {
  it('matches the effective level, a set level winning over the suggestion', async () => {
    const repo = seeded()

    expect(await ids(repo, ['urgent'])).toEqual(['ai-urgent'])
    expect(await ids(repo, ['high'])).toEqual([])
    expect(await ids(repo, ['medium'])).toEqual(['ai-high-set-medium'])
    expect(await ids(repo, ['low'])).toEqual(['feedback-low'])
    expect(await ids(repo, ['urgent', 'high'])).toEqual(['ai-urgent'])
  })

  it('partitions the list into the four levels and Not set', async () => {
    const repo = seeded()
    let matched = 0
    for (const level of ['urgent', 'high', 'medium', 'low'] as const) {
      matched += (await ids(repo, [level])).length
    }
    const total = await repo.countFiltered({}, ORG)

    // Not set: the unanalysed review and both feedback items with no level.
    expect(total - matched).toBe(3)
  })

  it('starts every created item with no level, as an insert does', async () => {
    const repo = createInMemoryInboxRepo()
    const created = await repo.create(
      item('new', 'review', { attention: null, managerPriority: 'urgent' }),
      ORG,
    )

    expect(created).toMatchObject({
      managerPriority: null,
      managerPrioritySetBy: null,
      managerPrioritySetAt: null,
    })
  })
})
