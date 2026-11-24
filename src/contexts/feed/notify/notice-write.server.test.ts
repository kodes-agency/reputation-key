import { describe, expect, it, vi } from 'vitest'
import {
  notificationEmailId,
  organizationId,
  propertyId,
  type NotificationEmailId,
} from '#/shared/domain/ids'
import type { NotificationEmail } from '../domain/notification-types'
import { enqueueImmediateAfterCommit } from './notice-write.server'

const EMAIL_ID = notificationEmailId('4d1f0c1e-2b7a-4c55-9a51-000000000012')
const ORG = organizationId('4d1f0c1e-2b7a-4c55-9a51-0000000000a1')
const PROPERTY = propertyId('4d1f0c1e-2b7a-4c55-9a51-0000000000b1')

const queuedEmail = (
  overrides: Partial<{ cadence: string; propertyId: typeof PROPERTY | null }> = {},
) =>
  ({
    id: EMAIL_ID as NotificationEmailId,
    organizationId: ORG,
    propertyId: PROPERTY,
    cadence: 'immediate',
    ...overrides,
  }) as unknown as NotificationEmail

const makeDeps = () => ({
  enqueueImmediateEmail: vi.fn(async () => {}),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
})

describe('enqueueImmediateAfterCommit', () => {
  it('enqueues an immediate row with its organization and property', async () => {
    const deps = makeDeps()

    await enqueueImmediateAfterCommit(deps, queuedEmail())

    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: EMAIL_ID,
      organizationId: ORG,
      propertyId: PROPERTY,
    })
  })

  it('omits the property for an Organization-scoped row', async () => {
    const deps = makeDeps()

    await enqueueImmediateAfterCommit(deps, queuedEmail({ propertyId: null }))

    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: EMAIL_ID,
      organizationId: ORG,
    })
  })

  it('does not enqueue a daily row or a missing row', async () => {
    const deps = makeDeps()

    await enqueueImmediateAfterCommit(deps, queuedEmail({ cadence: 'daily' }))
    await enqueueImmediateAfterCommit(deps, null)

    expect(deps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })

  it('does nothing when no queue is configured', async () => {
    const deps = makeDeps()

    await expect(
      enqueueImmediateAfterCommit({ logger: deps.logger }, queuedEmail()),
    ).resolves.toBeUndefined()
  })

  it('logs and resolves when the queue is unavailable', async () => {
    const deps = makeDeps()
    deps.enqueueImmediateEmail.mockRejectedValueOnce(new Error('queue unavailable'))

    await expect(
      enqueueImmediateAfterCommit(deps, queuedEmail()),
    ).resolves.toBeUndefined()

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: `notification-email:${EMAIL_ID}`,
        cadence: 'immediate',
      }),
      expect.any(String),
    )
  })
})
