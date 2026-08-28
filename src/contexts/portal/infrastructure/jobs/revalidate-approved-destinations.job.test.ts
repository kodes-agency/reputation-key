import { describe, expect, it, vi } from 'vitest'
import { createRevalidateApprovedDestinationsHandler } from './revalidate-approved-destinations.job'

describe('Portal approved destination revalidation job', () => {
  it('runs one bounded authorized batch with no job payload authority', async () => {
    const authorizeScope = vi.fn(async () => true)
    const revalidate = vi.fn(async () => ({
      scanned: 2,
      validated: 1,
      quarantined: 1,
      unavailable: 0,
      unauthorized: 0,
      stale: 0,
    }))
    const logger = { info: vi.fn() }
    await createRevalidateApprovedDestinationsHandler({
      revalidate,
      authorizeScope,
      logger,
    })({ data: { organizationId: 'must-not-be-used' } } as never)
    expect(revalidate).toHaveBeenCalledWith({ limit: 100, authorizeScope })
    expect(logger.info).toHaveBeenCalledWith(
      {
        job: 'portal-approved-destination-revalidation',
        scanned: 2,
        validated: 1,
        quarantined: 1,
        unavailable: 0,
        unauthorized: 0,
        stale: 0,
      },
      'Portal approved-destination revalidation completed',
    )
  })
})
