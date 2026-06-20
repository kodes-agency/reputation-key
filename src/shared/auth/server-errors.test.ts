import { describe, expect, it } from 'vitest'
import { APIError } from 'better-auth'
import { catchUntagged, ServerFunctionError } from './server-errors'

/** Run catchUntagged (which throws) and capture the thrown ServerFunctionError. */
function surface(e: unknown): ServerFunctionError {
  try {
    catchUntagged(e)
  } catch (err) {
    return err as ServerFunctionError
  }
  throw new Error('catchUntagged did not throw')
}

describe('catchUntagged', () => {
  it('surfaces a better-auth APIError with its real HTTP status', () => {
    // No body message — better-auth drops the org plugin's string error code,
    // so catchUntagged must still surface the real status.
    const thrown = surface(APIError.fromStatus('FORBIDDEN'))
    expect(thrown).toBeInstanceOf(ServerFunctionError)
    expect(thrown.status).toBe(403)
  })

  it('falls back to a human message when the APIError message was dropped', () => {
    const thrown = surface(APIError.fromStatus('FORBIDDEN'))
    expect(thrown.message).toBe("You don't have permission to do that.")
    expect(thrown.message).not.toBe('Internal server error')
  })

  it('uses the APIError body message when present', () => {
    const thrown = surface(
      APIError.fromStatus('UNAUTHORIZED', { message: 'Not authenticated' }),
    )
    expect(thrown.status).toBe(401)
    expect(thrown.message).toBe('Not authenticated')
  })

  it('masks truly unknown errors as a generic 500 (no stack/SQL leak)', () => {
    const thrown = surface(new Error('relation "organizationRole" does not exist'))
    expect(thrown.status).toBe(500)
    expect(thrown.message).toBe('Internal server error')
    expect(thrown.message).not.toContain('organizationRole')
  })
})
