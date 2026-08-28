import { describe, expect, it, vi } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { classifyNotification } from '../../domain/notification-delivery-policy'
import { NOTIFICATION_CLOSING_FENCE_REASON } from '../adapters/notification-organization-lifecycle.adapter'
import { onOrganizationPurgePending } from './on-organization-purge-pending'

const ORG = organizationId('00000000-0000-4000-8000-000000000002')
const FACT = {
  eventId: 'event-1',
  organizationId: ORG,
  closureLineageId: '11111111-1111-4111-8111-111111111111',
  revision: 4,
  correlationId: null,
}

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
})

function setup(recipients: readonly string[]) {
  const add = vi.fn(
    async (_name: string, _payload: unknown, _options: { jobId: string }) => {},
  )
  const log = logger()
  const notify = onOrganizationPurgePending({
    queue: { add } as never,
    userLookup: { findByRole: vi.fn(async () => recipients) } as never,
    logger: log as never,
  })
  return { notify, add, log }
}

describe('Purge Pending final notice', () => {
  /**
   * The whole point of the carve-out: Closing cancels every still-sendable
   * NON-mandatory email, so a final notice in any other category would be
   * silenced by the very fence it has to survive.
   */
  it('is a mandatory notice, so the Closing fence cannot silence it', () => {
    expect(classifyNotification('account.organization_purge_pending')).toBe('mandatory')
    // The fence reason exists and is applied only to non-mandatory rows —
    // pinned here so a change to either side breaks this test, not delivery.
    expect(NOTIFICATION_CLOSING_FENCE_REASON).toBe('organization_closing')
  })

  it('notifies every CURRENT AccountAdmin, not the original requester', async () => {
    const { notify, add } = setup(['admin-1', 'admin-2'])

    await notify(FACT)

    expect(add).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userId: 'admin-1',
        organizationId: ORG,
        propertyId: null,
        type: 'account.organization_purge_pending',
        resourceType: 'organization',
        audience: { kind: 'account_admin' },
      }),
      { jobId: 'event-1-admin-1' },
    )
  })

  it('uses a deterministic job id so a retry cannot double-notify', async () => {
    const { notify, add } = setup(['admin-1'])

    await notify(FACT)
    await notify(FACT)

    expect(add.mock.calls.map((call) => call[2])).toEqual([
      { jobId: 'event-1-admin-1' },
      { jobId: 'event-1-admin-1' },
    ])
  })

  it('carries no tenant content in the queued payload', async () => {
    const { notify, add } = setup(['admin-1'])

    await notify(FACT)

    expect(add.mock.calls[0]?.[1]).toMatchObject({ payload: {} })
  })

  it('warns loudly rather than silently proceeding when no AccountAdmin remains', async () => {
    const { notify, add, log } = setup([])

    await notify(FACT)

    expect(add).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ closureLineageId: FACT.closureLineageId }),
      expect.stringContaining('no AccountAdmin recipient'),
    )
  })
})
