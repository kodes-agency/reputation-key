import { beforeEach, describe, expect, it } from 'vitest'
import { portalId } from '#/shared/domain/ids'
import type { PortalResponsibilityNeeded } from '#/contexts/portal/application/public-api'
import { onPortalResponsibilityNeeded } from './on-portal-responsibility-needed'
import {
  buildExpectedJob,
  createEventHandlerDeps,
  expectJobsEnqueued,
  NOTIF_TEST_IDS,
  type FakeEventHandlerDeps,
} from './test-fixtures'

const event: PortalResponsibilityNeeded = {
  _tag: 'portal.responsibility_became_needed',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  portalId: portalId('portal-1'),
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  sourceAggregateVersion: NOTIF_TEST_IDS.now.toISOString(),
  occurredAt: NOTIF_TEST_IDS.now,
}

describe('onPortalResponsibilityNeeded', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues one content-free recovery alert for each AccountAdmin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onPortalResponsibilityNeeded(deps)(event)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs).toEqual([
      buildExpectedJob(
        {
          userId: NOTIF_TEST_IDS.admin1,
          type: 'portal.responsibility_needed',
          resourceType: 'portal',
          resourceId: event.portalId,
          payload: {},
          audience: { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${NOTIF_TEST_IDS.admin1}` },
      ),
      buildExpectedJob(
        {
          userId: NOTIF_TEST_IDS.admin2,
          type: 'portal.responsibility_needed',
          resourceType: 'portal',
          resourceId: event.portalId,
          payload: {},
          audience: { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${NOTIF_TEST_IDS.admin2}` },
      ),
    ])
  })

  it('does not expose portal or property names in the job payload', async () => {
    deps.userLookup.findByRole.mockResolvedValue([NOTIF_TEST_IDS.admin1])

    await onPortalResponsibilityNeeded(deps)(event)

    expect(deps.jobs[0]?.data).not.toHaveProperty('title')
    expect(deps.jobs[0]?.data).not.toHaveProperty('body')
    expect(deps.jobs[0]?.data).toEqual(expect.objectContaining({ payload: {} }))
  })

  it('warns and stops when the organization has no AccountAdmin', async () => {
    await onPortalResponsibilityNeeded(deps)(event)

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      { correlationId: undefined },
      'onPortalResponsibilityNeeded: no recipients found, skipping',
    )
  })
})
