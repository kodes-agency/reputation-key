import { describe, expect, it, vi } from 'vitest'
import { settleSetupReads } from './use-setup-facts'

const loaded = { data: {}, isError: false, isFetching: false, errorUpdateCount: 0 }
const pending = { data: undefined, isError: false, isFetching: true, errorUpdateCount: 0 }
const failed = { data: undefined, isError: true, isFetching: false, errorUpdateCount: 1 }

describe('settleSetupReads', () => {
  it('is loading while any read is still pending and none has failed', () => {
    const reads = [
      { ...loaded, refetch: vi.fn() },
      { ...pending, refetch: vi.fn() },
    ]

    expect(settleSetupReads(reads)).toEqual({ status: 'loading' })
  })

  it('is ready once every read has data', () => {
    const reads = [
      { ...loaded, refetch: vi.fn() },
      { ...loaded, refetch: vi.fn() },
    ]

    expect(settleSetupReads(reads)).toEqual({ status: 'ready' })
  })

  it('stays ready when a background refetch fails after everything loaded', () => {
    const reads = [{ ...loaded, isError: true, errorUpdateCount: 1, refetch: vi.fn() }]

    expect(settleSetupReads(reads)).toEqual({ status: 'ready' })
  })

  it('retries only the reads that failed', () => {
    const okRefetch = vi.fn()
    const failedRefetch = vi.fn()
    const state = settleSetupReads([
      { ...loaded, refetch: okRefetch },
      { ...failed, refetch: failedRefetch },
    ])

    if (state.status !== 'error') throw new Error('expected an error state')
    state.retry()

    expect(failedRefetch).toHaveBeenCalledTimes(1)
    expect(okRefetch).not.toHaveBeenCalled()
    expect(state.retrying).toBe(false)
  })

  it('keeps the error shown, busy, while a retry reads', () => {
    const state = settleSetupReads([
      { ...loaded, refetch: vi.fn() },
      {
        ...failed,
        isError: false,
        isFetching: true,
        errorUpdateCount: 1,
        refetch: vi.fn(),
      },
    ])

    expect(state).toMatchObject({ status: 'error', retrying: true })
  })
})
