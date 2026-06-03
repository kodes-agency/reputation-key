import { describe, it, expect } from 'vitest'
import { getNewCount } from './get-new-count'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  organizationId,
  inboxItemId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { NewCounterPort } from '../ports/new-counter.port'

// ── Test data factory (typed, no `any`) ─────────────────────────────
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

const makeItem = ({
  id,
  ...overrides
}: Partial<Omit<InboxItem, 'id'>> & { id: string }): InboxItem =>
  ({
    id: inboxItemId(id),
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review',
    sourceId: reviewId(`source-${id}`),
    status: 'new',
    rating: 4,
    sourceDate: new Date('2025-01-01'),
    platform: null,
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }) satisfies InboxItem

const setup = () => {
  const repo = createInMemoryInboxRepo()

  let counterValue = 0
  let counterShouldThrow = false

  const newCounter: NewCounterPort = {
    getCount: async () => {
      if (counterShouldThrow) throw new Error('Redis unavailable')
      return counterValue
    },
    setCount: async () => {},
    increment: async () => {},
    decrement: async () => {},
    invalidate: async () => {},
  }

  const deps = { newCounter, repo, logger: createMockLogger() }
  const useCase = getNewCount(deps)

  return {
    useCase,
    repo,
    setCounterValue: (v: number) => {
      counterValue = v
    },
    setCounterThrow: (v: boolean) => {
      counterShouldThrow = v
    },
  }
}

describe('getNewCount', () => {
  it('returns counter value when available', async () => {
    const { useCase, setCounterValue } = setup()
    setCounterValue(5)

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(count).toBe(5)
  })

  it('falls back to repo count when counter throws', async () => {
    const { useCase, repo, setCounterThrow } = setup()
    setCounterThrow(true)

    repo.items.push(
      makeItem({ id: 'ii-1', rating: 4 }),
      makeItem({ id: 'ii-2', rating: 3 }),
    )

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(count).toBe(2)
  })

  it('falls back to repo count when counter returns 0', async () => {
    const { useCase, repo, setCounterValue } = setup()
    setCounterValue(0)

    repo.items.push(makeItem({ id: 'ii-1', rating: 4 }))

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(count).toBe(1)
  })

  it('returns 0 when counter and repo have no items', async () => {
    const { useCase, setCounterValue } = setup()
    setCounterValue(0)

    const count = await useCase({
      organizationId: ORG_ID,
      userId: USER_ID,
      role: 'AccountAdmin',
    })

    expect(count).toBe(0)
  })
})
