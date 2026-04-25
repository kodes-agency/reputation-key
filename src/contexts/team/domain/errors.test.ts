import { describe, it, expect } from 'vitest'
import { teamError, isTeamError } from './errors'

describe('teamError', () => {
  it('creates a tagged error with code and message', () => {
    const e = teamError('forbidden', 'no access')
    expect(e._tag).toBe('TeamError')
    expect(e.code).toBe('forbidden')
    expect(e.message).toBe('no access')
  })

  it('includes optional context', () => {
    const e = teamError('name_taken', 'taken', { name: 'foo' })
    expect(e.context).toEqual({ name: 'foo' })
  })

  it('omits context when not provided', () => {
    const e = teamError('team_not_found', 'not found')
    expect(e.context).toBeUndefined()
  })
})

describe('isTeamError', () => {
  it('returns true for TeamError', () => {
    expect(isTeamError(teamError('forbidden', 'no'))).toBe(true)
  })

  it('returns false for non-TeamError', () => {
    expect(isTeamError(new Error('no'))).toBe(false)
    expect(isTeamError(null)).toBe(false)
    expect(isTeamError({ _tag: 'OtherError' })).toBe(false)
  })
})
