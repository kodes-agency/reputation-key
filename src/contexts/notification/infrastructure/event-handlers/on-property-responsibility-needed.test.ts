import { beforeEach, describe, expect, it } from 'vitest'
import type { PropertyResponsibilityNeeded } from '#/contexts/property/application/public-api'
import { onPropertyResponsibilityNeeded } from './on-property-responsibility-needed'
import {
  buildExpectedJob,
  createEventHandlerDeps,
  expectJobsEnqueued,
  NOTIF_TEST_IDS,
  type FakeEventHandlerDeps,
} from './test-fixtures'

const event: PropertyResponsibilityNeeded = {
  _tag: 'property.responsibility_became_needed',
  eventId: NOTIF_TEST_IDS.eventId,
  correlationId: null,
  organizationId: NOTIF_TEST_IDS.orgId,
  propertyId: NOTIF_TEST_IDS.propId,
  occurredAt: NOTIF_TEST_IDS.now,
}

describe('onPropertyResponsibilityNeeded', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
  })

  it('enqueues one content-free recovery alert per AccountAdmin', async () => {
    deps.userLookup.findByRole.mockResolvedValue([
      NOTIF_TEST_IDS.admin1,
      NOTIF_TEST_IDS.admin2,
    ])

    await onPropertyResponsibilityNeeded(deps)(event)

    expectJobsEnqueued(deps, 2)
    expect(deps.jobs).toEqual([
      buildExpectedJob(
        {
          userId: NOTIF_TEST_IDS.admin1,
          type: 'property.responsibility_needed',
          resourceType: 'property',
          resourceId: event.propertyId,
          payload: {},
        },
        { jobId: `${event.eventId}-${NOTIF_TEST_IDS.admin1}` },
      ),
      buildExpectedJob(
        {
          userId: NOTIF_TEST_IDS.admin2,
          type: 'property.responsibility_needed',
          resourceType: 'property',
          resourceId: event.propertyId,
          payload: {},
        },
        { jobId: `${event.eventId}-${NOTIF_TEST_IDS.admin2}` },
      ),
    ])
    expect(deps.jobs[0]?.data).not.toHaveProperty('title')
    expect(deps.jobs[0]?.data).not.toHaveProperty('body')
  })

  it('warns and stops when the Organization has no AccountAdmin', async () => {
    await onPropertyResponsibilityNeeded(deps)(event)

    expect(deps.queue.add).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(
      { correlationId: undefined },
      'onPropertyResponsibilityNeeded: no recipients found, skipping',
    )
  })
})
