import { describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { createInboxAssignmentRuntime } from './inbox-assignment-runtime'
import type { InboxCommandStore } from './ports/inbox-command-store.port'

const AT = new Date('2026-11-10T12:00:00.000Z')
const input = {
  organizationId: organizationId('org-assignment-runtime'),
  userId: userId('user-leaving'),
  actorId: userId('user-admin'),
  at: AT,
}

describe('createInboxAssignmentRuntime', () => {
  it('hands the caller transaction to both release methods', async () => {
    const releaseAssignmentsForUser = vi.fn(async () => ({ released: 2 }))
    const releaseIneligibleAssignmentsForUser = vi.fn(async () => ({ released: 1 }))
    const runtime = createInboxAssignmentRuntime({
      releaseAssignmentsForUser,
      releaseIneligibleAssignmentsForUser,
    } as unknown as InboxCommandStore)
    const tx = { lent: true } as unknown as Tx

    await expect(runtime.releaseAssignmentsForUser(input, tx)).resolves.toEqual({
      released: 2,
    })
    await expect(runtime.releaseIneligibleAssignmentsForUser(input, tx)).resolves.toEqual(
      {
        released: 1,
      },
    )

    expect(releaseAssignmentsForUser).toHaveBeenCalledWith(input, tx)
    expect(releaseIneligibleAssignmentsForUser).toHaveBeenCalledWith(input, tx)
  })

  it('leaves the transaction undefined when the caller lends none', async () => {
    const releaseAssignmentsForUser = vi.fn(async () => ({ released: 0 }))
    const runtime = createInboxAssignmentRuntime({
      releaseAssignmentsForUser,
      releaseIneligibleAssignmentsForUser: vi.fn(),
    } as unknown as InboxCommandStore)

    await runtime.releaseAssignmentsForUser(input)

    expect(releaseAssignmentsForUser).toHaveBeenCalledWith(input, undefined)
  })
})
