import { describe, expect, it } from 'vitest'
import { isRetrying } from './is-retrying'

const idle = { isError: false, isFetching: false }
const failed = { isError: true, isFetching: false }
const retrying = { isError: true, isFetching: true }
const loading = { isError: false, isFetching: true }

describe('isRetrying', () => {
  it('is false for a query that is loading for the first time', () => {
    expect(isRetrying(loading)).toBe(false)
  })

  it('is false for a failure that is not being tried again', () => {
    expect(isRetrying(failed)).toBe(false)
    expect(isRetrying(idle)).toBe(false)
  })

  it('is true while a failed query reads again', () => {
    expect(isRetrying(retrying)).toBe(true)
  })

  it('is true when any one of several queries is being tried again', () => {
    expect(isRetrying(idle, retrying)).toBe(true)
    expect(isRetrying(failed, loading)).toBe(false)
  })

  it('reads a list of queries, such as the results of useQueries', () => {
    expect(isRetrying([idle, failed], [retrying])).toBe(true)
    expect(isRetrying([idle, failed], [loading])).toBe(false)
  })

  it('is false with nothing to try', () => {
    expect(isRetrying()).toBe(false)
  })
})
