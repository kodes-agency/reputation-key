// A single-item Inbox command answers "may you act on this Property?" before
// "is your copy of the item current?".
//
// The revision conflict carries the item's current revision and status, and
// the server function returns both to the caller. Asked first, it told a
// manager with no grant on the item's Property whether that item is open and
// how often it has changed; the bulk commands already decide scope first so
// that "unavailable" never says which of those it is.

import { describe, expect, it } from 'vitest'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItem, SourceType } from '../../domain/types'
import { isInboxError } from '../../domain/errors'
import { addInboxNote } from './add-inbox-note'
import { assignInboxItem } from './assign-inbox-item'
import { correctFeedbackHandlingOutcome } from './correct-feedback-handling-outcome'
import { escalateInboxItem } from './escalate-inbox-item'
import { markFeedbackHandled } from './mark-feedback-handled'
import { resolveEscalation } from './resolve-escalation'
import { updateInboxStatus } from './update-inbox-status'

const NOW = new Date('2026-10-13T09:00:00.000Z')
const ORG_ID = organizationId('org-scope-order')
const ITEM_ID = inboxItemId('92000000-0000-4000-8000-000000000001')
const ITEM_PROPERTY = propertyId('92000000-0000-4000-8000-000000000002')
const GRANTED_PROPERTY = propertyId('92000000-0000-4000-8000-000000000003')
const MANAGER = userId('manager-of-another-property')
const STORED_REVISION = 5
const STALE_REVISION = 1

/** Every permission the commands ask for, each limited to granted Properties. */
const managerOfAnotherProperty = createScopedAuthContext({
  organizationId: ORG_ID,
  userId: MANAGER,
  permissions: [
    ['inbox.write', 'assigned-properties'],
    ['inbox.manage', 'assigned-properties'],
    ['review.read', 'assigned-properties'],
    ['feedback.handle', 'assigned-properties'],
  ],
})

const grants: StaffPublicApi = {
  getAccessiblePropertyIds: async () => [GRANTED_PROPERTY],
  getAssignedPortals: async () => [],
}

const item = (sourceType: SourceType): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: ITEM_PROPERTY,
  sourceType,
  sourceId:
    sourceType === 'feedback'
      ? feedbackId('92000000-0000-4000-8000-000000000004')
      : reviewId('92000000-0000-4000-8000-000000000005'),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: NOW,
  platform: sourceType === 'review' ? 'google' : null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: STORED_REVISION,
  createdAt: NOW,
  updatedAt: NOW,
})

type Run = (repo: InboxRepository, ctx: AuthContext) => Promise<unknown>

/** Only the reads the guards make are real: a command that reaches a store
 * has already answered wrongly, and fails on the missing dependency. */
const guards = (repo: InboxRepository) => ({ repo, staffPublicApi: grants })
const feedbackExpectation = {
  commandRevision: STALE_REVISION,
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
}

const commands: ReadonlyArray<readonly [string, SourceType, Run]> = [
  [
    'updateInboxStatus',
    'review',
    (repo, ctx) =>
      updateInboxStatus(guards(repo) as never)(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          expectedCommandRevision: STALE_REVISION,
        },
        ctx,
      ),
  ],
  [
    'escalateInboxItem',
    'review',
    (repo, ctx) =>
      escalateInboxItem(guards(repo) as never)(
        { inboxItemId: ITEM_ID, expectedCommandRevision: STALE_REVISION },
        ctx,
      ),
  ],
  [
    'resolveEscalation',
    'review',
    (repo, ctx) =>
      resolveEscalation(guards(repo) as never)(
        { inboxItemId: ITEM_ID, expectedCommandRevision: STALE_REVISION },
        ctx,
      ),
  ],
  [
    'assignInboxItem',
    'review',
    (repo, ctx) =>
      assignInboxItem(guards(repo) as never)(
        {
          inboxItemId: ITEM_ID,
          assignedToUserId: MANAGER,
          expectedCommandRevision: STALE_REVISION,
        },
        ctx,
      ),
  ],
  [
    'addInboxNote',
    'review',
    (repo, ctx) =>
      addInboxNote(guards(repo) as never)(
        {
          inboxItemId: ITEM_ID,
          text: 'A note',
          expectedCommandRevision: STALE_REVISION,
        },
        ctx,
      ),
  ],
  [
    'markFeedbackHandled',
    'feedback',
    (repo, ctx) =>
      markFeedbackHandled(guards(repo) as never)(
        {
          inboxItemId: ITEM_ID,
          expected: feedbackExpectation,
          outcome: 'guest_contacted',
          internalNote: null,
        } as never,
        ctx,
      ),
  ],
  [
    'correctFeedbackHandlingOutcome',
    'feedback',
    (repo, ctx) =>
      correctFeedbackHandlingOutcome(guards(repo) as never)(
        {
          inboxItemId: ITEM_ID,
          expected: feedbackExpectation,
          outcome: 'guest_contacted',
          internalNote: null,
        } as never,
        ctx,
      ),
  ],
]

describe('single-item Inbox commands decide Property scope before the revision', () => {
  it.each(commands)(
    '%s answers a manager with no grant on the Property with forbidden, and says nothing about the item',
    async (_name, sourceType, run) => {
      const repo = createInMemoryInboxRepo()
      repo.items.push(item(sourceType))

      const refusal: unknown = await run(repo, managerOfAnotherProperty).then(
        () => null,
        (error: unknown) => error,
      )

      expect(isInboxError(refusal) ? refusal.code : refusal).toBe('forbidden')
      expect(isInboxError(refusal) ? refusal.context : refusal).toEqual({
        propertyId: ITEM_PROPERTY,
      })
    },
  )

  it.each(commands)(
    '%s still tells a manager who holds the Property that their copy is stale',
    async (_name, sourceType, run) => {
      const repo = createInMemoryInboxRepo()
      repo.items.push({ ...item(sourceType), propertyId: GRANTED_PROPERTY })

      const refusal: unknown = await run(repo, managerOfAnotherProperty).then(
        () => null,
        (error: unknown) => error,
      )

      expect(isInboxError(refusal) ? refusal.code : refusal).toBe('revision_conflict')
      expect(isInboxError(refusal) ? refusal.context : refusal).toMatchObject({
        expectedCommandRevision: STALE_REVISION,
        currentCommandRevision: STORED_REVISION,
        currentStatus: 'open',
      })
    },
  )
})
