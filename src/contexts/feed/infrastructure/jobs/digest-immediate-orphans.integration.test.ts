// The digest run's immediate orphan sweep over real queue rows: immediate mail
// the urgent path never picked up is re-enqueued, stale mail is retired, and
// Organization-scoped mandatory mail is recovered under its own authorization.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notificationEmailQueue } from '#/shared/db/schema'
import { readEmail, seedNotice } from './delivery-seed'
import {
  HOUR,
  NOW,
  openDigestWorld,
  ORG,
  PROP_A,
  USER,
  type DigestWorld,
} from './digest-job-test-deps'

const DAY = 24 * HOUR

let world: DigestWorld

beforeEach(async () => {
  world = await openDigestWorld({ entries: false })
})

afterEach(async () => {
  await world.rollBack()
})

const immediateOrphan = (name: string, createdAt = new Date(NOW.getTime() - HOUR)) =>
  seedNotice(world.db, {
    name,
    organizationId: ORG,
    userId: USER,
    propertyId: PROP_A,
    createdAt,
    email: { cadence: 'immediate' },
  })

// A mandatory row whose job spent its attempts on transient failures.
const mandatoryOrphan = async (name: string) => {
  const seeded = await seedNotice(world.db, {
    name,
    organizationId: ORG,
    userId: USER,
    propertyId: null,
    createdAt: new Date(NOW.getTime() - HOUR),
    type: 'account.organization_access_removed',
    category: 'mandatory',
    resourceType: 'organization',
    resourceId: ORG,
    email: { cadence: 'immediate', status: 'failed', retryCount: 3 },
  })
  await world.db
    .update(notificationEmailQueue)
    .set({ lastErrorClass: 'transient' })
    .where(eq(notificationEmailQueue.id, seeded.emailId))
  return seeded
}

describe('immediate orphan sweep', () => {
  it('re-enqueues immediate-cadence rows the urgent path never picked up', async () => {
    const orphan = await immediateOrphan('orphan-1')
    const deps = world.deps()

    await world.run(deps)

    expect(deps.enqueueImmediate).toHaveBeenCalledWith({
      notificationEmailId: orphan.emailId,
      organizationId: ORG,
      propertyId: PROP_A,
    })
    expect(deps.logger.info).toHaveBeenCalledWith(
      { orphans: 1 },
      'Re-enqueued immediate notification emails missed by the urgent path',
    )
  })

  it('skips properties that fail the scope gate', async () => {
    await immediateOrphan('orphan-1')
    const deps = world.deps()
    deps.authorizeScope.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.enqueueImmediate).not.toHaveBeenCalled()
  })

  it('suppresses a stale orphan instead of re-enqueueing it once its scope is admitted', async () => {
    const fresh = await immediateOrphan('orphan-fresh')
    const stale = await immediateOrphan(
      'orphan-stale',
      new Date(NOW.getTime() - 60 * DAY),
    )
    const deps = world.deps()

    await world.run(deps)

    expect(await readEmail(world.db, stale.emailId)).toMatchObject({
      status: 'suppressed',
      suppressionReason: 'stale',
    })
    expect(deps.enqueueImmediate).not.toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: stale.emailId }),
    )
    expect(deps.enqueueImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: fresh.emailId }),
    )
  })

  it('re-enqueues Organization-scoped mandatory rows, authorized per Organization', async () => {
    // An access-removed or purge-pending notice has no Property, so walking
    // Properties never found it: a failed enqueue stranded it for good.
    const mandatory = await mandatoryOrphan('mandatory-1')
    const deps = world.deps()

    await world.run(deps)

    expect(deps.authorizeMandatoryScope).toHaveBeenCalledWith(ORG)
    expect(deps.enqueueImmediate).toHaveBeenCalledWith({
      notificationEmailId: mandatory.emailId,
      organizationId: ORG,
    })
  })

  it('recovers a mandatory row in an Organization the digest capability refuses', async () => {
    const mandatory = await mandatoryOrphan('mandatory-1')
    const deps = world.deps()
    // Ordinary product mail is dark for this tenant; the final warning before
    // an irreversible deletion is not ordinary product mail.
    deps.authorizeScope.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.enqueueImmediate).toHaveBeenCalledWith({
      notificationEmailId: mandatory.emailId,
      organizationId: ORG,
    })
  })

  it('leaves an Organization that fails the mandatory scope gate for a later sweep', async () => {
    const mandatory = await mandatoryOrphan('mandatory-1')
    const deps = world.deps()
    deps.authorizeMandatoryScope.mockResolvedValue(false)

    await world.run(deps)

    expect(deps.enqueueImmediate).not.toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmailId: mandatory.emailId }),
    )
    expect(await readEmail(world.db, mandatory.emailId)).toMatchObject({
      status: 'failed',
    })
  })
})
