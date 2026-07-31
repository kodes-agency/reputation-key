// Tests for client-side error display sanitization (BQC-7.6).
//
// The root error boundary renders loader/handler failures. Raw error messages
// can carry SQL fragments, stack-derived paths, or secret-adjacent config
// values, so production renders a generic message; development keeps the raw
// message for debuggability.

import { describe, it, expect } from 'vitest'
import { publicErrorMessage, GENERIC_CLIENT_ERROR_MESSAGE } from './error-display'

describe('publicErrorMessage (BQC-7.6)', () => {
  it('returns the generic message in production, never the raw error', () => {
    const leaky = new Error(
      'duplicate key value violates unique constraint "users_email_unique" (password_hint=hunter2)',
    )
    expect(publicErrorMessage(leaky, true)).toBe(GENERIC_CLIENT_ERROR_MESSAGE)
    expect(publicErrorMessage(leaky, true)).not.toContain('hunter2')
    expect(publicErrorMessage(leaky, true)).not.toContain('unique constraint')
  })

  it('returns the raw message in development', () => {
    const err = new Error('detailed dev diagnostics')
    expect(publicErrorMessage(err, false)).toBe('detailed dev diagnostics')
  })

  it('falls back to the generic message when the error has no message', () => {
    expect(publicErrorMessage(new Error(), false)).toBe(GENERIC_CLIENT_ERROR_MESSAGE)
  })
})
