import { describe, expect, it, vi } from 'vitest'
import {
  getRetryRequest,
  sendRetryWithOneReplay,
} from './use-google-import-progress-controller'

describe('Google import retry request recovery', () => {
  it('reuses one request ID for the same item revision and rotates after revision advance', () => {
    const requests = new Map()
    const createRequestId = vi
      .fn<() => string>()
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('10000000-0000-4000-8000-000000000002')

    const first = getRetryRequest(requests, 'item-1', 3, createRequestId)
    const replay = getRetryRequest(requests, 'item-1', 3, createRequestId)
    const nextRevision = getRetryRequest(requests, 'item-1', 4, createRequestId)

    expect(replay).toBe(first)
    expect(first.retryRequestId).toBe('10000000-0000-4000-8000-000000000001')
    expect(nextRevision.retryRequestId).toBe('10000000-0000-4000-8000-000000000002')
    expect(createRequestId).toHaveBeenCalledTimes(2)
  })

  it('replays the exact retry request once after a dropped response', async () => {
    const request = Object.freeze({
      itemId: 'item-1',
      retryRequestId: '10000000-0000-4000-8000-000000000001',
      expectedRetryRevision: 3,
    })
    const observed: Array<typeof request> = []
    const send = vi.fn(async () => {
      observed.push(request)
      if (observed.length === 1) throw new Error('response dropped')
      return { replayed: true }
    })

    await expect(sendRetryWithOneReplay(send)).resolves.toEqual({ replayed: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(observed).toEqual([request, request])
  })

  it('surfaces failure after the single bounded replay also fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('unavailable'))

    await expect(sendRetryWithOneReplay(send)).rejects.toThrow('unavailable')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
