import { describe, expect, it, vi } from 'vitest'
import { handleAuthError } from './auth-settings.helpers'

describe('handleAuthError', () => {
  it('uses the injected logger and preserves fail-closed status mapping', () => {
    const logger = { warn: vi.fn() }
    const error = { statusCode: 403, message: 'provider denied the request' }

    expect(() =>
      handleAuthError(
        logger,
        error,
        'AuthError',
        'password_change_failed',
        'Password change failed.',
      ),
    ).toThrow(
      expect.objectContaining({
        name: 'AuthError',
        code: 'forbidden',
        status: 403,
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error, statusCode: 403 },
      'AuthError: password_change_failed',
    )
  })

  it('maps an unclassified provider failure to the supplied safe response', () => {
    const logger = { warn: vi.fn() }
    const error = new Error('provider internals')

    expect(() =>
      handleAuthError(
        logger,
        error,
        'AuthError',
        'profile_update_failed',
        'Failed to update profile.',
      ),
    ).toThrow(
      expect.objectContaining({
        name: 'AuthError',
        code: 'profile_update_failed',
        status: 400,
        message: 'Failed to update profile.',
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'AuthError: profile_update_failed',
    )
  })
})
