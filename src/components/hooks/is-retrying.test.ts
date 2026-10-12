import { describe, expect, it } from 'vitest'
import { hasFailed, isRetrying } from './is-retrying'

const query = (state: Partial<Parameters<typeof hasFailed>[0]> = {}) => ({
  isError: false,
  isFetching: false,
  errorUpdateCount: 0,
  data: undefined,
  ...state,
})

/** A first load that failed, as TanStack Query reports it. */
const failed = query({ isError: true, errorUpdateCount: 1 })
/** The same query a moment after Try again: no data, so it reset to pending, error dropped. */
const retryingWithoutData = query({ isFetching: true, errorUpdateCount: 1 })
/** A query with rows that failed to refresh keeps its error while it reads again. */
const retryingWithData = query({
  isError: true,
  isFetching: true,
  errorUpdateCount: 1,
  data: ['kept'],
})
const loading = query({ isFetching: true })

describe('hasFailed', () => {
  it('is true for a failed query', () => {
    expect(hasFailed(failed)).toBe(true)
  })

  it('stays true while Try again reads, though the query has dropped its error', () => {
    expect(hasFailed(retryingWithoutData)).toBe(true)
  })

  it('is false for a first load that has not failed', () => {
    expect(hasFailed(loading)).toBe(false)
    expect(hasFailed(query())).toBe(false)
  })

  it('is false once a retry has brought data', () => {
    expect(hasFailed(query({ errorUpdateCount: 1, data: ['rows'] }))).toBe(false)
    expect(hasFailed(query({ isFetching: true, errorUpdateCount: 1, data: [] }))).toBe(
      false,
    )
  })
})

describe('isRetrying', () => {
  it('is false for a query that is loading for the first time', () => {
    expect(isRetrying(loading)).toBe(false)
  })

  it('is false for a failure that is not being tried again', () => {
    expect(isRetrying(failed)).toBe(false)
    expect(isRetrying(query())).toBe(false)
  })

  it('is true while a failed query reads again, with or without data to keep', () => {
    expect(isRetrying(retryingWithoutData)).toBe(true)
    expect(isRetrying(retryingWithData)).toBe(true)
  })

  it('is true when any one of several queries is being tried again', () => {
    expect(isRetrying(query(), retryingWithoutData)).toBe(true)
    expect(isRetrying(failed, loading)).toBe(false)
  })

  it('reads a list of queries, such as the results of useQueries', () => {
    expect(isRetrying([query(), failed], [retryingWithoutData])).toBe(true)
    expect(isRetrying([query(), failed], [loading])).toBe(false)
  })

  it('is false with nothing to try', () => {
    expect(isRetrying()).toBe(false)
  })
})
