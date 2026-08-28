import { describe, expect, it, vi } from 'vitest'
import { settlePortalVisit } from './guest-analytics-notice'

describe('settlePortalVisit', () => {
  it('settles a confirmed visit without waiting', async () => {
    const attempt = vi.fn(async () => 'recorded' as const)
    const wait = vi.fn(async () => undefined)

    await expect(settlePortalVisit(attempt, wait)).resolves.toBe(true)

    expect(attempt).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })

  it('retries one transient authority outcome and settles the successful retry', async () => {
    const attempt = vi
      .fn<() => Promise<'retryable' | 'recorded'>>()
      .mockResolvedValueOnce('retryable')
      .mockResolvedValueOnce('recorded')
    const wait = vi.fn(async () => undefined)

    await expect(settlePortalVisit(attempt, wait)).resolves.toBe(true)

    expect(attempt).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledExactlyOnceWith(1_000)
  })

  it('leaves an exhausted transient visit unsettled for a later page load', async () => {
    const attempt = vi.fn(async () => 'retryable' as const)
    const wait = vi.fn(async () => undefined)

    await expect(settlePortalVisit(attempt, wait)).resolves.toBe(false)

    expect(attempt).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledExactlyOnceWith(1_000)
  })

  it('treats a transport failure as transient but keeps the retry bounded', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('connection interrupted')
    })
    const wait = vi.fn(async () => undefined)

    await expect(settlePortalVisit(attempt, wait)).resolves.toBe(false)

    expect(attempt).toHaveBeenCalledTimes(2)
  })
})
