import { describe, expect, it, vi } from 'vitest'
import {
  baseDeps,
  entryFor,
  ORG,
  PROP_A,
  PROP_B,
  runHandler,
} from './digest-job-test-deps'

describe('daily digest delivery acceptance', () => {
  it('sends only opted-in Property lines and freezes only those members', async () => {
    const deps = baseDeps()
    deps.preferenceRepo.resolveForDelivery = vi.fn(async (...args: unknown[]) => ({
      enabled: args[2] !== PROP_B,
      cadence: 'daily' as const,
    }))

    await runHandler(deps)

    expect(deps.emailSender.send).toHaveBeenCalledTimes(1)
    const sent = deps.emailSender.send.mock.calls[0]![0]
    expect(sent.html).toContain('Riverside')
    expect(sent.text).toContain('Riverside')
    expect(sent.html).not.toContain('Hillcrest')
    expect(sent.text).not.toContain('Hillcrest')
    expect(deps.emailRepo.prepareDigestBatch).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: [entryFor(PROP_A).id] }),
    )
    expect(deps.emailRepo.markSuppressed).toHaveBeenCalledWith(
      entryFor(PROP_B).id,
      ORG,
      PROP_B,
      'preference_disabled',
      expect.any(Date),
    )
  })

  it.each([
    ['spring forward', '2026-03-08T06:30:00.000Z', '03:30', '2026-03-08T07:30:00.000Z'],
    ['fall back', '2026-11-01T05:30:00.000Z', '02:30', '2026-11-01T07:30:00.000Z'],
  ])(
    'releases a quiet-hours digest at its local end across %s',
    async (_shift, heldAt, quietHoursEnd, releasedAt) => {
      const entry = {
        ...entryFor(PROP_A),
        status: 'delayed' as const,
        createdAt: new Date(new Date(heldAt).getTime() - 60 * 60_000),
      }
      const window = {
        quietHoursStart: '22:00',
        quietHoursEnd,
        urgentBypassEnabled: false,
      }
      const held = baseDeps({
        now: new Date(heldAt),
        userTimezone: 'America/New_York',
        dueByUser: [entry],
      })
      held.preferenceRepo.resolveDeliveryWindow.mockResolvedValue(window)

      await runHandler(held)

      expect(held.emailSender.send).not.toHaveBeenCalled()
      expect(held.emailRepo.markDelayed).toHaveBeenCalledWith(
        entry.id,
        ORG,
        PROP_A,
        new Date(releasedAt),
        new Date(heldAt),
      )

      const released = baseDeps({
        now: new Date(releasedAt),
        userTimezone: 'America/New_York',
        dueByUser: [{ ...entry, notBefore: new Date(releasedAt) }],
      })
      released.preferenceRepo.resolveDeliveryWindow.mockResolvedValue(window)

      await runHandler(released)

      expect(released.emailSender.send).toHaveBeenCalledTimes(1)
      expect(released.emailRepo.markDelayed).not.toHaveBeenCalled()
    },
  )

  it('retries every frozen request field and key without rendering again', async () => {
    const first = baseDeps()
    await runHandler(first)
    const batch = (await first.emailRepo.prepareDigestBatch.mock.results[0]!.value).batch
    const retry = baseDeps({
      openBatch: { ...batch, state: 'retryable', everyAttemptRefused: false },
    })
    retry.userLookup.getName.mockRejectedValue(new Error('display name unavailable'))

    await runHandler(retry)

    expect(retry.emailSender.send).toHaveBeenCalledExactlyOnceWith({
      ...batch.providerRequest,
      idempotencyKey: batch.providerIdempotencyKey,
    })
    expect(retry.userLookup.getName).not.toHaveBeenCalled()
    expect(retry.emailRepo.prepareDigestBatch).not.toHaveBeenCalled()
  })
})
