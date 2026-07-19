import { describe, it, expect } from 'vitest'
import { getInboxFolderCounts } from './get-folder-counts'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import {
  organizationId,
  inboxItemId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { isInboxError } from '../../domain/errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'

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
    status: 'open',
    rating: 4,
    sourceDate: new Date('2025-01-01'),
    platform: null,
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
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

const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (staffApi: StaffPublicApi = allAccessStaffApi) => {
  const repo = createInMemoryInboxRepo()
  const useCase = getInboxFolderCounts({ repo, staffPublicApi: staffApi })
  return { useCase, repo }
}

describe('getInboxFolderCounts', () => {
  it('returns 3-folder counts: open, escalated (active flag), closed', async () => {
    const { useCase, repo } = setup()

    repo.items.push(
      makeItem({ id: 'ii-1', status: 'open' }),
      makeItem({ id: 'ii-2', status: 'open' }),
      makeItem({ id: 'ii-3', status: 'open', isEscalated: true }),
      makeItem({ id: 'ii-4', status: 'closed' }),
      makeItem({ id: 'ii-5', status: 'closed', isEscalated: true }),
      // Resolved escalation — no longer counts in the Escalated folder
      makeItem({
        id: 'ii-6',
        status: 'open',
        isEscalated: false,
        escalationResolvedAt: new Date('2025-01-02'),
      }),
    )

    const counts = await useCase({}, ctxFor('AccountAdmin'))

    expect(counts).toEqual({
      open: 4,
      escalated: 2, // ii-3 (open+active) + ii-5 (closed+active); ii-6 resolved
      closed: 2,
    })
  })

  it('returns all zeros when organization has no items', async () => {
    const { useCase } = setup()

    const counts = await useCase({}, ctxFor('AccountAdmin'))

    expect(counts).toEqual({ open: 0, escalated: 0, closed: 0 })
  })

  it('throws forbidden when role lacks inbox.read permission', async () => {
    const { useCase } = setup()

    await expect(useCase({}, ctxFor('Guest' as unknown as Role))).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'forbidden',
    )
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const { useCase, repo } = setup(createScopedStaffApi(['prop-1']))
    repo.items.push(makeItem({ id: 'ii-1', status: 'open' }))
    repo.items.push(
      makeItem({ id: 'ii-2', status: 'open', propertyId: propertyId('prop-2') }),
    )

    const counts = await useCase({}, ctxFor('PropertyManager'))

    expect(counts.open).toBe(1)
  })

  it('counts zero for PropertyManager with no property assignments', async () => {
    const { useCase, repo } = setup(createScopedStaffApi([]))
    repo.items.push(makeItem({ id: 'ii-1', status: 'open' }))

    const counts = await useCase({}, ctxFor('PropertyManager'))

    expect(counts.open).toBe(0)
  })

  it('scopes Staff to assigned properties', async () => {
    const { useCase, repo } = setup(createScopedStaffApi(['prop-1']))
    repo.items.push(makeItem({ id: 'ii-1', status: 'open' }))
    repo.items.push(
      makeItem({ id: 'ii-2', status: 'open', propertyId: propertyId('prop-2') }),
    )

    const counts = await useCase({}, ctxFor('Staff'))

    expect(counts.open).toBe(1)
  })

  it('propertyId narrows counts to that property (org-wide role)', async () => {
    const { useCase, repo } = setup()
    repo.items.push(
      makeItem({ id: 'ii-1', status: 'open', propertyId: propertyId('prop-1') }),
      makeItem({
        id: 'ii-2',
        status: 'open',
        isEscalated: true,
        propertyId: propertyId('prop-1'),
      }),
      makeItem({ id: 'ii-3', status: 'closed', propertyId: propertyId('prop-1') }),
      makeItem({ id: 'ii-4', status: 'closed', propertyId: propertyId('prop-2') }),
      makeItem({ id: 'ii-5', status: 'closed', propertyId: propertyId('prop-2') }),
    )

    const counts = await useCase({ propertyId: 'prop-1' }, ctxFor('AccountAdmin'))

    expect(counts).toEqual({ open: 2, escalated: 1, closed: 1 })
  })

  it('propertyId narrows counts for a scoped role when the property is accessible', async () => {
    const { useCase, repo } = setup(createScopedStaffApi(['prop-1', 'prop-2']))
    repo.items.push(
      makeItem({ id: 'ii-1', status: 'open', propertyId: propertyId('prop-1') }),
    )
    repo.items.push(
      makeItem({ id: 'ii-2', status: 'open', propertyId: propertyId('prop-2') }),
    )

    const counts = await useCase({ propertyId: 'prop-2' }, ctxFor('PropertyManager'))

    expect(counts.open).toBe(1)
  })

  it('throws forbidden when a scoped role requests an inaccessible property', async () => {
    const { useCase } = setup(createScopedStaffApi(['prop-1']))

    await expect(
      useCase({ propertyId: 'prop-2' }, ctxFor('PropertyManager')),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isInboxError(e) &&
        e.code === 'forbidden' &&
        /No access to this property/.test(e.message),
    )
  })
})
