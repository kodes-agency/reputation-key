import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Pool } from 'pg'
import { getInboxQueueCounts } from './get-inbox-queue-counts'
import { getEnv } from '#/shared/config/env'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import {
  clearInboxOrganization,
  createInboxUseCaseDatabase,
  dropInboxOrganization,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'

const ORG_ID = organizationId('org-inbox-queue-counts-test')
const PROP_1 = propertyId('94a50000-0000-4000-8000-0000000000a1')
const PROP_2 = propertyId('94a50000-0000-4000-8000-0000000000a2')
const VIEWER = userId('user-1')
const AWAITING = reviewId('94a51000-0000-4000-8000-000000000001')
const WAITING = reviewId('94a51000-0000-4000-8000-000000000002')

const allAccessStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const scopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
})

const makeItem = ({
  id,
  ...overrides
}: Partial<Omit<InboxItem, 'id'>> & { id: string }): InboxItem => ({
  id: inboxItemId(`94a54000-0000-4000-8000-${id.padStart(12, '0')}`),
  organizationId: ORG_ID,
  propertyId: PROP_1,
  sourceType: 'review',
  sourceId: reviewId(`94a52000-0000-4000-8000-${id.padStart(12, '0')}`),
  status: 'open',
  rating: null,
  sourceDate: new Date('2026-09-01T10:00:00Z'),
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
  commandRevision: 1,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
  ...overrides,
})

function replyLookup(
  findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] })),
): ReplyLookupPort {
  return {
    getEffectiveReplyByReviewId: async () => null,
    getReplyMilestonesByReviewIds: async () => new Map(),
    getGoogleReplyHeadsByReviewIds: async () => new Map(),
    getReplyStatesByReviewIds: async () => new Map(),
    findReviewIdsByReplyStage: findStages,
  }
}

let pool: Pool
let repo: ReturnType<typeof createInboxUseCaseDatabase>['repo']
let seed: ReturnType<typeof createInboxUseCaseDatabase>['seed']

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  ;({ repo, seed } = createInboxUseCaseDatabase(
    pool,
    () => new Date('2026-09-02T10:00:00Z'),
  ))
  await seedInboxOrganization(pool, ORG_ID, [PROP_1, PROP_2])
})

beforeEach(() => clearInboxOrganization(pool, ORG_ID))

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  await dropInboxOrganization(pool, ORG_ID)
  await pool.end()
})

const manager: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'AccountAdmin',
}

const reader: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'Member',
  effectivePermissions: new Set(['inbox.read', 'review.read', 'feedback.read']),
  scopeByPermission: new Map([
    ['inbox.read', 'organization'],
    ['review.read', 'organization'],
    ['feedback.read', 'organization'],
  ]),
}

async function seedQueueCases() {
  await seed(
    makeItem({ id: '1' }),
    makeItem({ id: '2', sourceId: AWAITING }),
    makeItem({ id: '3', sourceId: WAITING }),
    makeItem({
      id: '4',
      sourceType: 'feedback',
      sourceId: feedbackId('94a53000-0000-4000-8000-000000000004'),
    }),
    makeItem({ id: '5', assignedTo: VIEWER }),
    makeItem({ id: '6', status: 'closed', isEscalated: true }),
    makeItem({ id: '7', isEscalated: true }),
  )
}

describe.sequential('getInboxQueueCounts', () => {
  it('counts every queue with the exact list predicates and one stage lookup', async () => {
    await seedQueueCases()
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({}, manager)).resolves.toEqual({
      reply: 3,
      approval: 1,
      waiting: 1,
      feedback: 1,
      escalated: 2,
      mine: 1,
      open: 6,
      // The closed folders are archives, not work: they carry no badge (ADR 0057,
      // amended 2026-10-28), so nothing is counted for them.
      replied: null,
      handled: null,
      closed: null,
      replyStages: true,
    })
    expect(findStages).toHaveBeenCalledOnce()
    expect(findStages).toHaveBeenCalledWith(ORG_ID, undefined)
  })

  it('runs seven count queries for a manager, none for the closed folders', async () => {
    await seedQueueCases()
    const countFiltered = vi.spyOn(repo, 'countFiltered')
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await useCase({}, manager)

    expect(countFiltered).toHaveBeenCalledTimes(7)
    const statuses = countFiltered.mock.calls.map(([filters]) => filters.status)
    expect(statuses.filter((status) => status === 'closed')).toEqual([])
  })

  it.each([
    ['replied', { status: 'closed', sourceType: 'review' }, 1],
    ['handled', { status: 'closed', sourceType: 'feedback' }, 1],
  ] as const)(
    'would count %s to the list total, were it counted (ADR 0057 d6)',
    async (_queue, filters, expected) => {
      await seed(
        makeItem({ id: '1', status: 'closed' }),
        makeItem({
          id: '2',
          status: 'closed',
          sourceType: 'feedback',
          sourceId: feedbackId('94a53000-0000-4000-8000-000000000002'),
        }),
        makeItem({ id: '3' }),
      )

      const [page, count] = await Promise.all([
        repo.findFilteredPaginated(filters, ORG_ID),
        repo.countFiltered(filters, ORG_ID),
      ])

      expect(count).toBe(expected)
      expect(count).toBe(page.totalCount)
    },
  )

  it('withholds reply-stage counts and their lookup without reply.manage', async () => {
    await seedQueueCases()
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    // `reply` is then the rail's "Open": every open Review, and it is counted
    // as the list would total it. Only the stages that need reply.manage are withheld.
    await expect(useCase({}, reader)).resolves.toEqual({
      reply: 5,
      approval: null,
      waiting: null,
      feedback: 1,
      escalated: 2,
      mine: 1,
      open: 6,
      replied: null,
      handled: null,
      closed: null,
      replyStages: false,
    })
    expect(findStages).not.toHaveBeenCalled()
  })

  it('withholds reply-stage counts when reply publication is disabled', async () => {
    await seedQueueCases()
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({ replyQueuesEnabled: false }, manager)).resolves.toEqual({
      reply: 5,
      approval: null,
      waiting: null,
      feedback: 1,
      escalated: 2,
      mine: 1,
      open: 6,
      replied: null,
      handled: null,
      closed: null,
      replyStages: false,
    })
    expect(findStages).not.toHaveBeenCalled()
  })

  // The browser draws the rail's labels from this answer, not from its own
  // permissions, so it must be true to what the counts above were decided with.
  it.each([
    ['a manager', manager, undefined, true],
    ['a manager the boundary withholds the stages from', manager, false, false],
    ['a reader without reply.manage', reader, undefined, false],
    // Never true on the boundary's word alone: the role still has to hold it.
    ['a reader the boundary says may use the stages', reader, true, false],
  ] as const)(
    'says whether reply stages are available to %s',
    async (_who, ctx, replyQueuesEnabled, expected) => {
      await seedQueueCases()
      const useCase = getInboxQueueCounts({
        repo,
        staffPublicApi: allAccessStaffApi,
        replyLookup: replyLookup(),
      })

      const counts = await useCase({ replyQueuesEnabled }, ctx)

      expect(counts.replyStages).toBe(expected)
      // The stage counts are present exactly when the stages are.
      expect(counts.approval !== null).toBe(expected)
      expect(counts.waiting !== null).toBe(expected)
    },
  )

  it('says so for a scope that holds no rows at all', async () => {
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: scopedStaffApi([]),
      replyLookup: replyLookup(),
    })
    const propertyManager = { ...manager, role: 'PropertyManager' as const }

    await expect(useCase({}, propertyManager)).resolves.toMatchObject({
      reply: 0,
      approval: 0,
      replyStages: true,
    })
    await expect(
      useCase({ replyQueuesEnabled: false }, propertyManager),
    ).resolves.toMatchObject({ reply: 0, approval: null, replyStages: false })
  })

  it('runs five count queries without reply stages', async () => {
    await seedQueueCases()
    const countFiltered = vi.spyOn(repo, 'countFiltered')
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await useCase({ replyQueuesEnabled: false }, manager)

    expect(countFiltered).toHaveBeenCalledTimes(5)
  })

  it('narrows all counts and the stage lookup to an accessible property', async () => {
    await seed(
      makeItem({ id: '1', propertyId: PROP_1 }),
      makeItem({ id: '2', propertyId: PROP_2 }),
    )
    const findStages = vi.fn(async () => ({ awaiting: [], waiting: [] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: scopedStaffApi([PROP_1, PROP_2]),
      replyLookup: replyLookup(findStages),
    })
    const propertyManager = { ...manager, role: 'PropertyManager' as const }

    const counts = await useCase({ propertyId: PROP_2 }, propertyManager)

    expect(counts.open).toBe(1)
    expect(counts.reply).toBe(1)
    expect(findStages).toHaveBeenCalledWith(ORG_ID, [PROP_2])
  })

  it('refuses an inaccessible property', async () => {
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: scopedStaffApi([PROP_1]),
      replyLookup: replyLookup(),
    })

    await expect(
      useCase({ propertyId: PROP_2 }, { ...manager, role: 'PropertyManager' }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })
  })

  it('rejects a caller without inbox.read', async () => {
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await expect(
      useCase({}, { ...reader, effectivePermissions: new Set() }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })
  })
})
