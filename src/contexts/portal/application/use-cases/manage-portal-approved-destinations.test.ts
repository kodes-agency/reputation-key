import { describe, expect, it, vi } from 'vitest'
import { portalApprovedDestinationId } from '#/shared/domain/ids'
import { revalidatePortalApprovedDestinations } from './manage-portal-approved-destinations'

const NOW = new Date('2026-08-27T12:00:00.000Z')

// A failed write cannot be provoked in the database, and the proof is the
// number of checks still in flight, so this one keeps its injected stores.
const candidate = {
  id: portalApprovedDestinationId('10000000-0000-4000-8000-000000000001'),
  organizationId: 'org-1',
  propertyId: '20000000-0000-4000-8000-000000000001',
  normalizedUri: 'https://example.com/',
  lastValidatedAt: new Date('2026-08-26T12:00:00.000Z'),
  nextAttemptAt: null,
  validationFailures: 0,
}

describe('revalidatePortalApprovedDestinations', () => {
  it('drains active checks before rejecting a failed write and starts no further batch', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      const rows = Array.from({ length: 6 }, (_, i) => ({
        ...candidate,
        id: portalApprovedDestinationId(`destination-${i}`),
        normalizedUri: `https://example.com/${i}`,
      }))
      const failure = new Error('Validation write failed')
      const recordNetworkValidation = vi.fn(async (input) => {
        if (input.id === rows[0]!.id) throw failure
        return rows.find((row) => row.id === input.id)!
      })
      const validate = vi.fn(async (uri: string) => {
        if (uri !== rows[0]!.normalizedUri)
          await new Promise((resolve) => setTimeout(resolve, 5_000))
        return {
          outcome: 'safe' as const,
          validatedAt: new Date(),
          finalUri: uri,
          redirectCount: 0,
        }
      })
      const useCase = revalidatePortalApprovedDestinations({
        destinationRepo: {
          listDueForNetworkRevalidation: async () => rows,
          recordNetworkValidation,
        } as never,
        destinationNetworkValidator: { validate },
        clock: () => new Date(),
      })
      let settled = false
      const running = useCase({ authorizeScope: async () => true })
      const refusal = expect(running).rejects.toBe(failure)
      const completion = running.catch(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(recordNetworkValidation).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(5_000)
      await refusal
      await completion
      expect(settled).toBe(true)
      expect(validate).toHaveBeenCalledTimes(5)
      expect(recordNetworkValidation).toHaveBeenCalledTimes(5)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
