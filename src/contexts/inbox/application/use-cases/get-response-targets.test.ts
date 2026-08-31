import { describe, expect, it, vi } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem } from '../../domain/types'
import type { ResponseTargetStore } from '../ports/response-target.store'
import type { ResponseTargetPolicyStore } from '../ports/response-target-policy.store'
import {
  getGoogleReviewTargetAnalytics,
  getInboxResponseTarget,
  getPrivateFeedbackTargetAnalytics,
  getResponseTargetPolicySettings,
} from './get-response-targets'

const NOW = new Date('2026-08-30T12:00:00.000Z')
const ORG = organizationId('org-response-target-read')
const USER = userId('user-response-target-read')
const PROPERTY = propertyId('78000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('78000000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('78000000-0000-4000-8000-000000000003')

const feedbackItem: InboxItem = {
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'feedback',
  sourceId: feedbackId('78000000-0000-4000-8000-000000000004'),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: NOW,
  platform: null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const ctx = createScopedAuthContext({
  organizationId: ORG,
  userId: USER,
  permissions: [
    ['inbox.read', 'assigned-properties'],
    ['feedback.read', 'assigned-properties'],
  ],
})

const store = (): ResponseTargetStore => ({
  getCycleTarget: vi.fn(async () => null),
  getPrivateFeedbackAnalytics: vi.fn(async () => ({
    targetKind: 'private_feedback_handling' as const,
    measuredCycleCount: 0,
    activeCount: 0,
    currentOverdueCount: 0,
    handledOnTimeCount: 0,
    handledLateCount: 0,
    reopenCount: 0,
    averageTimeToFirstHandlingMinutes: null,
  })),
  getGoogleReviewAnalytics: vi.fn(async () => ({
    targetKind: 'google_review_response' as const,
    measuredCycleCount: 0,
    activeCount: 0,
    currentOverdueCount: 0,
    respondedOnTimeCount: 0,
    respondedLateCount: 0,
    reopenCount: 0,
    historicalOnboardingExcludedCount: 0,
    legacyUnknownExcludedCount: 0,
    averageTimeToResponseMinutes: null,
  })),
  releaseDueReminders: vi.fn(async () => ({ released: 0 })),
})

const staffApi = (ids: readonly (typeof PROPERTY)[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids,
  getAssignedPortals: async () => [],
})

describe('Response Target manager reads', () => {
  it('reads one target only through current Inbox + source Property access', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(feedbackItem)
    const targetStore = store()
    const execute = getInboxResponseTarget({
      repo,
      targetStore,
      staffPublicApi: staffApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({ inboxItemId: ITEM }, ctx)

    expect(targetStore.getCycleTarget).toHaveBeenCalledWith(ITEM, ORG, NOW)
  })

  it('rejects a target outside the manager’s assigned Property', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(feedbackItem)
    const targetStore = store()

    await expect(
      getInboxResponseTarget({
        repo,
        targetStore,
        staffPublicApi: staffApi([OTHER_PROPERTY] as never),
        clock: () => NOW,
      })({ inboxItemId: ITEM }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(targetStore.getCycleTarget).not.toHaveBeenCalled()
  })

  it('passes only the feedback-read Property intersection to private analytics', async () => {
    const targetStore = store()
    const execute = getPrivateFeedbackTargetAnalytics({
      targetStore,
      staffPublicApi: staffApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({}, ctx)

    expect(targetStore.getPrivateFeedbackAnalytics).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyIds: [PROPERTY],
      now: NOW,
    })
  })

  it('keeps Google response analytics separate and Property-scoped', async () => {
    const targetStore = store()
    const reviewCtx = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [
        ['inbox.read', 'assigned-properties'],
        ['review.read', 'assigned-properties'],
      ],
    })
    const execute = getGoogleReviewTargetAnalytics({
      targetStore,
      staffPublicApi: staffApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({}, reviewCtx)

    expect(targetStore.getGoogleReviewAnalytics).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyIds: [PROPERTY],
      now: NOW,
    })
    expect(targetStore.getPrivateFeedbackAnalytics).not.toHaveBeenCalled()
  })

  it('lets only an Organization administrator read policy versions for safe compare-and-set edits', async () => {
    const getPolicySettings = vi.fn(async () => ({
      organization: {
        googleReviewResponse: {
          targetKind: 'google_review_response' as const,
          durationMinutes: 2_880,
          policySource: 'builtin_default' as const,
          policyVersion: null,
        },
        privateFeedbackHandling: {
          targetKind: 'private_feedback_handling' as const,
          durationMinutes: 1_440,
          policySource: 'organization_policy' as const,
          policyVersion: 3,
        },
      },
      privateFeedbackPropertyOverride: null,
    }))
    const policyStore = { getPolicySettings } as unknown as ResponseTargetPolicyStore
    const execute = getResponseTargetPolicySettings({ policyStore })
    const admin = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [['organization.update', 'organization']],
    })

    await expect(execute({}, admin)).resolves.toMatchObject({
      organization: { privateFeedbackHandling: { policyVersion: 3 } },
    })
    expect(getPolicySettings).toHaveBeenCalledWith(ORG, undefined)
    await expect(execute({}, ctx)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
