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
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'
import type { InboxItem } from '../../domain/types'
import type { NewCounterPort } from '../ports/new-counter.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

// ── Test data factory (typed, no `any`) ─────────────────────────────
const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

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

const allAccessStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
}

const scopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (staffApi: StaffPublicApi = allAccessStaffApi) => {
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
    decrementBy: async () => {},
    invalidate: async () => {},
  }

  const deps = {
    newCounter,
    repo,
    logger: createMockLogger(),
    staffPublicApi: staffApi,
  }
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

    const count = await useCase({}, ctxFor('AccountAdmin'))

    expect(count).toBe(5)
  })

  it('falls back to repo count when counter throws', async () => {
    const { useCase, repo, setCounterThrow } = setup()
    setCounterThrow(true)

    repo.items.push(
      makeItem({ id: 'ii-1', rating: 4 }),
      makeItem({ id: 'ii-2', rating: 3 }),
    )

    const count = await useCase({}, ctxFor('AccountAdmin'))

    expect(count).toBe(2)
  })

  it('falls back to repo count when counter returns 0', async () => {
    const { useCase, repo, setCounterValue } = setup()
    setCounterValue(0)

    repo.items.push(makeItem({ id: 'ii-1', rating: 4 }))

    const count = await useCase({}, ctxFor('AccountAdmin'))

    expect(count).toBe(1)
  })

  it('returns 0 when counter and repo have no items', async () => {
    const { useCase, setCounterValue } = setup()
    setCounterValue(0)

    const count = await useCase({}, ctxFor('AccountAdmin'))

    expect(count).toBe(0)
  })

  it('scopes PropertyManager to assigned properties on DB fallback (PM is NOT org-wide)', async () => {
    // PM is never org-wide, so it always uses the scoped DB count (the counter
    // is AccountAdmin-only — see the warm-counter-bypass test below).
    const { useCase, repo, setCounterValue } = setup(scopedStaffApi(['prop-1']))
    setCounterValue(0)
    repo.items.push(makeItem({ id: 'ii-1' })) // prop-1 (assigned)
    repo.items.push(makeItem({ id: 'ii-2', propertyId: propertyId('prop-2') }))

    const count = await useCase({}, ctxFor('PropertyManager'))

    expect(count).toBe(1) // only the assigned property's new item
  })

  it('ignores the warm org-wide counter for PropertyManager (scopes to assigned)', async () => {
    // Regression: a warm org-wide counter used to overcount PM/Staff. PM/Staff
    // now bypass the counter and always read the scoped DB count.
    const { useCase, repo, setCounterValue } = setup(scopedStaffApi(['prop-1']))
    setCounterValue(5) // warm org-wide counter — must be ignored for PM
    repo.items.push(makeItem({ id: 'ii-1' })) // prop-1 (assigned)
    repo.items.push(makeItem({ id: 'ii-2', propertyId: propertyId('prop-2') }))

    const count = await useCase({}, ctxFor('PropertyManager'))

    expect(count).toBe(1) // scoped, not the org-wide 5
  })

  it('returns 0 for PropertyManager with no assignments on DB fallback', async () => {
    const { useCase, repo, setCounterValue } = setup(scopedStaffApi([]))
    setCounterValue(0)
    repo.items.push(makeItem({ id: 'ii-1' }))

    const count = await useCase({}, ctxFor('PropertyManager'))

    expect(count).toBe(0)
  })

  it('scopes Staff to assigned properties on DB fallback', async () => {
    const { useCase, repo, setCounterValue } = setup(scopedStaffApi(['prop-1']))
    setCounterValue(0)
    repo.items.push(makeItem({ id: 'ii-1' }))
    repo.items.push(makeItem({ id: 'ii-2', propertyId: propertyId('prop-2') }))

    const count = await useCase({}, ctxFor('Staff'))

    expect(count).toBe(1)
  })
})
