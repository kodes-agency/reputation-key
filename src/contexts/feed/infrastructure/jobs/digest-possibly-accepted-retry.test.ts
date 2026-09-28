// A frozen digest the provider may already hold is re-sent exactly as frozen,
// under its key, when nothing that must not leak has changed.
//
// A 5xx, a timeout or a reset leaves a batch "possibly accepted". Before the
// hourly retry, the recipient may read a line, a colleague may finish the work
// behind one (settlement cancels its queue row), or a repeat event may
// coalesce into one and change its wording. Each of those used to invalidate
// the whole batch, so a first attempt that never reached the provider lost the
// day's digest silently. Re-sending the frozen request under the same key is
// safe: the provider dedupes it. Authorization, standing, preference and
// address changes still close the batch.

import { describe, expect, it } from 'vitest'
import type { NotificationId, PropertyId } from '#/shared/domain/ids'
import type { NotificationDigestBatch } from '../../application/ports/notification-email-repository.port'
import type { Notification, NotificationEmail } from '../../domain/notification-types'
import { buildNotification } from './test-fixtures'
import { baseDeps, entryFor, PROP_A, PROP_B, runHandler } from './digest-job-test-deps'

const reopenFor = (
  entry: NotificationEmail,
  overrides: Partial<Pick<Notification, 'status' | 'payload'>> = {},
): Notification =>
  buildNotification({
    id: entry.notificationId as string,
    userId: entry.userId as string,
    organizationId: entry.organizationId as string,
    propertyId: entry.propertyId as string,
    type: 'inbox.reopened',
    category: 'workflow_collaboration',
    resourceType: 'inbox_item',
    resourceId: `inbox-${entry.propertyId as string}`,
    payload: {
      propertyName: (entry.propertyId as string) === PROP_A ? 'Riverside' : 'Hillcrest',
    },
    ...overrides,
  })

const failedOnce = (property: string): NotificationEmail => ({
  ...entryFor(property),
  category: 'workflow_collaboration',
  status: 'failed',
  lastErrorClass: 'transient',
  retryCount: 1,
})

type Deps = ReturnType<typeof baseDeps>

const serveNotifications = (
  deps: Deps,
  notificationOf: (property: string, entry: NotificationEmail) => Notification,
) =>
  deps.notifRepo.findByIdsForProperty.mockImplementation(
    async (ids: readonly NotificationId[], _org: unknown, property: PropertyId) =>
      new Map(
        ids.map((id) => [
          id as string,
          notificationOf(property as string, entryFor(property as string)),
        ]),
      ),
  )

/** The batch the 08:00 sweep froze and sent, left open by a transient failure. */
async function possiblyAccepted(): Promise<
  Readonly<{ batch: NotificationDigestBatch; firstHtml: string }>
> {
  const first = baseDeps()
  serveNotifications(first, (_property, entry) => reopenFor(entry))
  await runHandler(first)
  const prepared = (await first.emailRepo.prepareDigestBatch.mock.results[0]!.value).batch
  return {
    batch: { ...prepared, state: 'retryable', retryCount: 1, everyAttemptRefused: false },
    firstHtml: first.emailSender.send.mock.calls[0]![0].html,
  }
}

function retrying(
  batch: NotificationDigestBatch,
  batchEntries: readonly NotificationEmail[] = [failedOnce(PROP_A), failedOnce(PROP_B)],
) {
  return baseDeps({ openBatch: batch, batchEntries })
}

const expectResentUnderFrozenKey = (deps: Deps, batch: NotificationDigestBatch) => {
  expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
  expect(deps.emailSender.send.mock.calls[0]![0].idempotencyKey).toBe(
    batch.providerIdempotencyKey,
  )
  expect(deps.emailRepo.markSuppressed).not.toHaveBeenCalled()
  expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledTimes(1)
  expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      settlement: expect.objectContaining({ kind: 'accepted' }),
    }),
  )
}

describe('retrying a digest the provider may already hold', () => {
  it('re-sends it when a line was read in the bell before the retry', async () => {
    const { batch } = await possiblyAccepted()
    const deps = retrying(batch)
    serveNotifications(deps, (property, entry) =>
      reopenFor(entry, property === PROP_B ? { status: 'read' } : {}),
    )

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, batch)
  })

  it('re-sends it when the work behind a line was settled elsewhere', async () => {
    const { batch } = await possiblyAccepted()
    const deps = retrying(batch, [
      failedOnce(PROP_A),
      { ...failedOnce(PROP_B), status: 'cancelled', suppressionReason: 'work_settled' },
    ])
    serveNotifications(deps, (_property, entry) => reopenFor(entry))

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, batch)
  })

  it('re-sends the frozen wording when a repeat event coalesced into a line', async () => {
    const { batch, firstHtml } = await possiblyAccepted()
    const deps = retrying(batch)
    serveNotifications(deps, (property, entry) =>
      reopenFor(
        entry,
        property === PROP_B
          ? { payload: { propertyName: 'Hillcrest', platform: 'portal', guestRating: 2 } }
          : {},
      ),
    )

    await runHandler(deps)

    expectResentUnderFrozenKey(deps, batch)
    expect(deps.emailSender.send.mock.calls[0]![0].html).toBe(firstHtml)
  })

  it('closes it when every line was settled elsewhere', async () => {
    const { batch } = await possiblyAccepted()
    const settled = (property: string): NotificationEmail => ({
      ...failedOnce(property),
      status: 'cancelled',
      suppressionReason: 'work_settled',
    })
    const deps = retrying(batch, [settled(PROP_A), settled(PROP_B)])

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement: expect.objectContaining({ kind: 'invalidated' }),
      }),
    )
  })

  it('never sends the frozen request to an address the recipient has left', async () => {
    const { batch } = await possiblyAccepted()
    const deps = retrying(batch)
    serveNotifications(deps, (_property, entry) => reopenFor(entry))
    deps.userLookup.getEmail.mockResolvedValue('new-address@example.com')

    await runHandler(deps)

    expect(deps.emailSender.send).not.toHaveBeenCalled()
    expect(deps.emailRepo.settleDigestBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement: expect.objectContaining({ kind: 'content_mismatch' }),
      }),
    )
  })
})
