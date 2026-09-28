// Who hears that an approved reply went back to draft before it reached
// Google: its author, and the people who can approve it again — the same
// people an approval request asks (I5.3), not every AccountAdmin.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { unbrand } from '#/shared/domain/ids'
import { handleWorkflowNotificationEvent } from './workflow-outbox-consumers'
import { NOTIF_TEST_IDS } from './notification-consumer-test-fixtures'
import {
  makeWorkflowDeps,
  queuedJobs,
  workflowEvent,
} from './workflow-consumer-test-harness'

// BQC-3.8 kept this fact's identifiers strictly UUID.
const REPLY = '31000000-0000-4000-8000-0000000000c1'
const REVIEW = '31000000-0000-4000-8000-0000000000c2'
const PROPERTY = '31000000-0000-4000-8000-0000000000c3'

const cancelled = (
  cause: 'disconnect' | 'policy' | 'source_changed' | 'provider_truth',
  authorId: string | null = unbrand(NOTIF_TEST_IDS.authorId),
) =>
  workflowEvent(
    'review.reply.publication_cancelled',
    { replyId: REPLY, reviewId: REVIEW, propertyId: PROPERTY, authorId, cause },
    { propertyId: PROPERTY },
  )

const recipients = (deps: ReturnType<typeof makeWorkflowDeps>) =>
  queuedJobs(deps).map((job) => [job.userId, job.audience])

describe('a publication cancelled after approval', () => {
  beforeEach(() => {
    clearEventSchemas()
    registerAllEventSchemas()
  })
  afterEach(() => clearEventSchemas())

  it('asks the Property’s responsible approvers, not every AccountAdmin', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager2,
    ])
    deps.fakes.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await handleWorkflowNotificationEvent(deps, cancelled('source_changed'))

    expect(recipients(deps)).toEqual([
      [NOTIF_TEST_IDS.authorId, { kind: 'property_operator' }],
      [NOTIF_TEST_IDS.manager2, { kind: 'reply_approver', propertyId: PROPERTY }],
    ])
  })

  it('leaves out a responsible manager who may not approve replies', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])
    deps.fakes.replyApproval.canApproveReplies.mockImplementation(
      async (_org: unknown, _property: unknown, user: unknown) =>
        user === NOTIF_TEST_IDS.manager2,
    )

    await handleWorkflowNotificationEvent(deps, cancelled('disconnect'))

    expect(queuedJobs(deps).map((job) => job.userId)).toEqual([
      NOTIF_TEST_IDS.authorId,
      NOTIF_TEST_IDS.manager2,
    ])
  })

  it('falls back to the AccountAdmins when no responsible manager may approve', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([])

    await handleWorkflowNotificationEvent(deps, cancelled('provider_truth'))

    expect(recipients(deps)).toEqual([
      [NOTIF_TEST_IDS.authorId, { kind: 'property_operator' }],
      [NOTIF_TEST_IDS.admin1, { kind: 'account_admin' }],
    ])
  })

  // The author cannot approve their own reply, so when they are the only
  // responsible approver somebody else still has to.
  it('falls back to the AccountAdmins when the author is the only approver', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.authorId,
    ])

    await handleWorkflowNotificationEvent(deps, cancelled('source_changed'))

    expect(recipients(deps)).toEqual([
      [NOTIF_TEST_IDS.authorId, { kind: 'property_operator' }],
      [NOTIF_TEST_IDS.admin1, { kind: 'account_admin' }],
    ])
  })

  it('still leaves out an approver a policy cancellation took the Property from', async () => {
    const deps = makeWorkflowDeps()
    deps.fakes.responsibleManagers.findForProperty.mockResolvedValue([
      NOTIF_TEST_IDS.manager1,
      NOTIF_TEST_IDS.manager2,
    ])
    deps.fakes.responsibleManagers.isEligibleForProperty.mockImplementation(
      async (_org: unknown, _property: unknown, user: unknown) =>
        user !== NOTIF_TEST_IDS.manager1,
    )

    await handleWorkflowNotificationEvent(deps, cancelled('policy'))

    expect(queuedJobs(deps).map((job) => job.userId)).toEqual([
      NOTIF_TEST_IDS.authorId,
      NOTIF_TEST_IDS.manager2,
    ])
  })
})
