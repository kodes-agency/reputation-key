import { describe, expect, it } from 'vitest'
import { APIError } from 'better-auth'
import { catchUntagged } from './server-errors'
import { ServerFunctionError } from './server-function-error'

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
  // The regression: this module is imported both by alias and relatively, so the
  // dev SSR module graph can hold two copies of the class. When it did, an error
  // the domain had already classified and logged as
  // `GoogleImportDiscoveryError(temporarily_unavailable) -> 503` reached the
  // browser as `InternalError` / `internal_error` / 500, and every classified
  // Google-import refusal collapsed into one generic sentence with no action.
  // A structurally identical instance from a duplicate class must pass through.
  it('passes through a tagged error from a duplicate class instance', () => {
    class DuplicateServerFunctionError extends Error {
      readonly _tag: string
      readonly code: string
      readonly status: number
      constructor(name: string, message: string, code: string, status: number) {
        super(message)
        this.name = name
        this._tag = name
        this.code = code
        this.status = status
      }
    }
    const tagged = new DuplicateServerFunctionError(
      'GoogleImportDiscoveryError',
      'Google import discovery failed: temporarily_unavailable',
      'temporarily_unavailable',
      503,
    )

    expect(() => catchUntagged(tagged)).toThrow(tagged)
  })

  it('still hides an untagged failure behind a generic 500', () => {
    expect(() => catchUntagged(new Error('relation "replies" does not exist'))).toThrow(
      expect.objectContaining({ code: 'internal_error', status: 500 }),
    )
  })

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

  it('preserves an already translated execution-policy denial', () => {
    const denial = new ServerFunctionError(
      'AuthError',
      'Authorization denied: property_disabled',
      'property_disabled',
      403,
    )
    expect(surface(denial)).toBe(denial)
  })

  it('masks truly unknown errors as a generic 500 (no stack/SQL leak)', () => {
    const thrown = surface(new Error('relation "organizationRole" does not exist'))
    expect(thrown.status).toBe(500)
    expect(thrown.message).toBe('Internal server error')
    expect(thrown.message).not.toContain('organizationRole')
  })
})
