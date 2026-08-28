import { describe, expect, it, vi } from 'vitest'
import { contactRequestRetentionSweep } from './contact-request-retention'
import type { ContactRequestRepository } from '../ports/contact-request.repository'

const NOW = new Date('2026-08-28T12:00:00.000Z')

const repository = (
  results: ReadonlyArray<Awaited<ReturnType<ContactRequestRepository['purgeExpired']>>>,
) => {
  const purgeExpired = vi.fn()
  for (const result of results) purgeExpired.mockResolvedValueOnce(result)
  return { purgeExpired } as Pick<ContactRequestRepository, 'purgeExpired'>
}

describe('Contact Request retention sweep', () => {
  it('drains bounded batches against one fixed observation time and reports completion', async () => {
    const repo = repository([
      {
        processed: 2,
        checkpoint: { expiresAt: new Date('2026-08-01T00:00:00.000Z'), id: 'a' },
        completedThrough: null,
      },
      {
        processed: 1,
        checkpoint: { expiresAt: new Date('2026-08-02T00:00:00.000Z'), id: 'b' },
        completedThrough: null,
      },
      {
        processed: 0,
        checkpoint: { expiresAt: new Date('2026-08-02T00:00:00.000Z'), id: 'b' },
        completedThrough: NOW,
      },
    ])
    const sweep = contactRequestRetentionSweep({
      repo,
      clock: () => NOW,
      maxBatches: 3,
    })

    await expect(sweep({ batchSize: 2 })).resolves.toEqual({
      batches: 2,
      processed: 3,
      capped: false,
      completedThrough: NOW,
    })
    expect(repo.purgeExpired).toHaveBeenCalledTimes(3)
    expect(repo.purgeExpired).toHaveBeenNthCalledWith(1, {
      through: NOW,
      batchSize: 2,
    })
    expect(repo.purgeExpired).toHaveBeenNthCalledWith(3, {
      through: NOW,
      batchSize: 2,
    })
  })

  it('stops at the configured batch ceiling and reports that work remains', async () => {
    const repo = repository([
      { processed: 2, checkpoint: null, completedThrough: null },
      { processed: 2, checkpoint: null, completedThrough: null },
    ])
    const sweep = contactRequestRetentionSweep({
      repo,
      clock: () => NOW,
      maxBatches: 2,
    })

    await expect(sweep({ batchSize: 2 })).resolves.toEqual({
      batches: 2,
      processed: 4,
      capped: true,
      completedThrough: null,
    })
    expect(repo.purgeExpired).toHaveBeenCalledTimes(2)
  })

  it.each([0, 1_001])('rejects unsafe batch size %s', async (batchSize) => {
    const sweep = contactRequestRetentionSweep({
      repo: repository([]),
      clock: () => NOW,
      maxBatches: 1,
    })

    await expect(sweep({ batchSize })).rejects.toThrowError(
      'Contact Request retention bounds are invalid',
    )
  })

  it('rejects an unsafe batch ceiling', () => {
    expect(() =>
      contactRequestRetentionSweep({
        repo: repository([]),
        clock: () => NOW,
        maxBatches: 0,
      }),
    ).toThrowError('Contact Request retention bounds are invalid')
  })
})
