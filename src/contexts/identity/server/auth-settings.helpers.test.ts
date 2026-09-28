import { APIError } from 'better-auth'
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

  it('forwards a Better Auth client error with the context code', () => {
    const logger = { warn: vi.fn() }
    const error = APIError.from('BAD_REQUEST', {
      code: 'INVALID_PASSWORD',
      message: 'Invalid password',
    })

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
        code: 'password_change_failed',
        status: 400,
        message: 'Invalid password',
      }),
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  // changePassword throws INTERNAL_SERVER_ERROR after the new password is
  // already stored (revokeOtherSessions). A 400 told the user to re-check a
  // password that had changed, and kept the failure out of error monitoring.
  it('keeps a Better Auth server failure a 500, logging it once', () => {
    const logger = { warn: vi.fn() }
    const error = APIError.from('INTERNAL_SERVER_ERROR', {
      code: 'FAILED_TO_GET_SESSION',
      message: 'Failed to get session',
    })

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
        name: 'APIError',
        code: 'FAILED_TO_GET_SESSION',
        status: 500,
      }),
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error, statusCode: 500 },
      'AuthError: password_change_failed',
    )
  })

  it('masks an unclassified failure as a 500 internal error, logging it once', () => {
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
        name: 'InternalError',
        code: 'internal_error',
        status: 500,
        message: 'Internal server error',
      }),
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'AuthError: profile_update_failed',
    )
  })
})
