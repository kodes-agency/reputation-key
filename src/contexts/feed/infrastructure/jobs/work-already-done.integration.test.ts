// A notice whose work was finished before it landed, or before its mail left.
//
// Settlement retires the rows that exist when the settling fact is handled.
// An escalation resolved (or a reply approved) after its notice was written
// can leave a row, or a queued mail, that asks for work nobody is waiting on.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import { findNotificationEmailById } from '../../email/notification-email-queue.server'
import { createNotificationWorkState } from '../../notify/settle.server'
import { loadItems, type RecipientContext } from './digest-entry-selection'
import { seedNotice, readEmail, emailIdOf } from './delivery-seed'
import {
  NOW,
  ORG,
  PROPERTY,
  USER,
  openSendWorld,
  type SendEmailsTestDeps,
  type SendWorld,
} from './send-emails-test-deps'

const DIGEST_LINE = 'digest-line'
const RETIRED = { status: 'suppressed', suppressionReason: 'work_no_longer_waiting' }

let world: SendWorld

afterEach(async () => {
  await world.rollBack()
})

const ctx = {
  orgId: organizationId(ORG),
  userId: userId(USER),
  rawOrgId: ORG,
  now: NOW,
  timezone: 'UTC',
  timezoneSource: 'fallback',
  quietHours: { quietHoursStart: null, quietHoursEnd: null },
} as unknown as RecipientContext

/** The delivery deps with work that is, or is not, still waiting. */
const waiting = (answer: boolean) => {
  const deps = world.deps()
  deps.workState.isWaiting.mockResolvedValue(answer)
  deps.workState.isWaitingMany.mockImplementation(async (subjects) =>
    subjects.map(() => answer),
  )
  return deps
}

/** The delivery deps judging work by the Google connection as it stands. */
const judgedByConnection = (status: () => Promise<string | null>) => ({
  ...world.deps(),
  workState: createNotificationWorkState({
    googleConnectionStatus: { findStatus: vi.fn(status) },
  } as never),
})

/** A daily-digest row for the recipient, as the digest reads it from the queue. */
async function digestEntry(
  notice: Parameters<typeof seedNotice>[1] extends infer S ? Partial<S> : never,
) {
  await seedNotice(world.db, {
    createdAt: new Date(NOW.getTime() - 10 * 60_000),
    ...notice,
    name: DIGEST_LINE,
    organizationId: ORG,
    userId: USER,
    propertyId: PROPERTY,
    email: { cadence: 'daily' },
  })
  const entry = await findNotificationEmailById(
    world.db,
    emailIdOf(DIGEST_LINE),
    ORG,
    PROPERTY,
  )
  return entry!
}

describe('an immediate email whose work was done after its row was written', () => {
  const reply = {
    type: 'reply.pending_approval' as const,
    resourceType: 'inbox_item' as const,
    resourceId: 'item-1',
    payload: { propertyName: 'Riverside Hotel', platform: 'google' as const },
  }

  it('is retired, not sent, once the reply was decided', async () => {
    world = await openSendWorld({ notice: reply })
    const deps = waiting(false)

    await world.run(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject(RETIRED)
  })

  it('still goes out while the reply waits for approval', async () => {
    world = await openSendWorld({ notice: reply })
    const deps = waiting(true)

    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })
})

describe('a digest line whose work was done after its row was written', () => {
  const escalation = {
    type: 'inbox.escalated' as const,
    category: 'urgent_operational',
    resourceType: 'inbox_item' as const,
    resourceId: 'item-1',
  }

  it('is dropped with a visible reason', async () => {
    world = await openSendWorld()
    const entry = await digestEntry(escalation)
    const deps = waiting(false)

    const items = await loadItems(deps as never, ctx, [entry])

    expect(items).toEqual([])
    expect(await readEmail(world.db, entry.id as string)).toMatchObject(RETIRED)
  })

  it('is kept while the escalation stands', async () => {
    world = await openSendWorld()
    const entry = await digestEntry(escalation)

    const items = await loadItems(waiting(true) as never, ctx, [entry])

    expect(items).toHaveLength(1)
  })
})

describe('a Google reconnect notice, judged by the connection as it stands when sent', () => {
  const reconnect = {
    type: 'integration.reauthorization_required' as const,
    category: 'urgent_operational',
    priority: 'urgent',
    resourceType: 'integration' as const,
    resourceId: 'connection-1',
    payload: { reauthorizationCause: 'provider_revoked' as const },
  }

  const open = async () => {
    world = await openSendWorld({ notice: reconnect })
  }
  const send = (deps: ReturnType<typeof judgedByConnection>) =>
    world.run(deps as unknown as SendEmailsTestDeps)

  it('drops the digest line and the immediate email once the connection was reconnected', async () => {
    // Dropped at 10:00, reconnected at 10:02, sent at 11:00.
    await open()
    const deps = judgedByConnection(async () => 'active')
    const entry = await digestEntry({ ...reconnect, resourceId: 'connection-2' })

    expect(await loadItems(deps as never, ctx, [entry])).toEqual([])
    await send(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(await world.email()).toMatchObject(RETIRED)
  })

  it('notifies while the connection is still broken', async () => {
    await open()
    const deps = judgedByConnection(async () => 'reauth_required')
    const entry = await digestEntry({ ...reconnect, resourceId: 'connection-2' })

    expect(await loadItems(deps as never, ctx, [entry])).toHaveLength(1)
    await send(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })

  it('notifies when the integration lookup is unavailable', async () => {
    await open()
    const deps = judgedByConnection(async () => {
      throw new Error('integration unavailable')
    })
    const entry = await digestEntry({ ...reconnect, resourceId: 'connection-2' })

    expect(await loadItems(deps as never, ctx, [entry])).toHaveLength(1)
    await send(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  })
})
