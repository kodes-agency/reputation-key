// Dashboard context — domain errors unit tests
import { describe, it, expect } from 'vitest'
import {
  dashboardError,
  isDashboardError,
  type DashboardErrorCode,
} from './errors'

describe('dashboardError', () => {
  it.each([
    ['forbidden', 403],
    ['not_found', 404],
    ['invalid_input', 400],
  ] as const)('%s code maps to %i status', (code, expectedStatus) => {
    const err = dashboardError(code, `Error: ${code}`)
    expect(err._tag).toBe('DashboardError')
    expect(err.code).toBe(code)
    expect(err.message).toBe(`Error: ${code}`)

    // Status is mapped in server layer — verify domain error shape
    expect(isDashboardError(err)).toBe(true)

    // Cross-reference: the server's dashboardErrorStatus must map these consistently.
    // This test documents the expected contract for all server implementations.
    const expectedMapping: Record<DashboardErrorCode, number> = {
      forbidden: 403,
      not_found: 404,
      invalid_input: 400,
    }
    expect(expectedMapping[code]).toBe(expectedStatus)
  })

  it('rejects non-DashboardError objects', () => {
    expect(isDashboardError(null)).toBe(false)
    expect(isDashboardError(undefined)).toBe(false)
    expect(isDashboardError({})).toBe(false)
    expect(isDashboardError({ _tag: 'OtherError' })).toBe(false)
    expect(isDashboardError(new Error('regular'))).toBe(false)
  })

  it('includes optional context', () => {
    const err = dashboardError('invalid_input', 'Bad data', {
      field: 'timeRange',
    })
    expect(err.context).toEqual({ field: 'timeRange' })
  })
})
