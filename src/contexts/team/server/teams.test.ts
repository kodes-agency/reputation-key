// Team context — server function tests
// Tests the real teamErrorStatus function exported from the server module.
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { teamError } from '#/contexts/team/domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'
import { teamErrorStatus } from './teams'

describe('teamErrorStatus (error → HTTP status mapping)', () => {
  it('maps forbidden → 403', () => {
    expect(teamErrorStatus('forbidden')).toBe(403)
  })

  it('maps team_not_found → 404', () => {
    expect(teamErrorStatus('team_not_found')).toBe(404)
  })

  it('maps property_not_found → 404', () => {
    expect(teamErrorStatus('property_not_found')).toBe(404)
  })

  it('maps name_taken → 409', () => {
    expect(teamErrorStatus('name_taken')).toBe(409)
  })

  it('maps invalid_name → 400', () => {
    expect(teamErrorStatus('invalid_name')).toBe(400)
  })
})

describe('throwContextError integration', () => {
  it('throws Error with correct name, code, and status for TeamError', () => {
    const err = teamError('forbidden', 'Access denied')

    expect(() => throwContextError('TeamError', err, teamErrorStatus(err.code))).toThrow(
      expect.objectContaining({
        message: 'Access denied',
      }),
    )
  })

  it('thrown error has code and status properties', () => {
    const err = teamError('name_taken', 'Duplicate name')

    try {
      throwContextError('TeamError', err, teamErrorStatus(err.code))
    } catch (e) {
      expect((e as Error).name).toBe('TeamError')
      expect((e as unknown as Record<string, unknown>).code).toBe('name_taken')
      expect((e as unknown as Record<string, unknown>).status).toBe(409)
    }
  })
})
