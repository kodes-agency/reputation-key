import { describe, expect, it } from 'vitest'
import {
  googleProviderErrorStatus,
  googleProviderFailure,
} from './google-provider-failure'

describe('googleProviderErrorStatus', () => {
  it.each(['NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_ARGUMENT', 'UNAUTHENTICATED'])(
    'keeps the Google status %s',
    (status) => {
      expect(googleProviderErrorStatus(status)).toBe(status)
    },
  )

  it.each([
    'not_found',
    'NOT_FOUND ',
    'Requested entity was not found.',
    'CUSTOMER_PRIVATE_VALUE',
    '',
    404,
    null,
    undefined,
    ['NOT_FOUND'],
    { status: 'NOT_FOUND' },
  ])('drops %j', (value) => {
    expect(googleProviderErrorStatus(value)).toBeNull()
  })
})

describe('googleProviderFailure', () => {
  it('rebuilds the closed fields and nothing else', () => {
    const failure = googleProviderFailure({
      providerStatus: 404,
      providerErrorStatus: 'NOT_FOUND',
      dispatch: 'answered',
      executionCode: 'private execution code',
      message: 'private customer content',
      body: { error: { message: 'private resource name' } },
    })

    expect(failure).toEqual({
      providerStatus: 404,
      providerErrorStatus: 'NOT_FOUND',
      dispatch: 'answered',
    })
    expect(JSON.stringify(failure)).not.toContain('private')
  })

  it.each([99, 600, 404.5, Number.NaN, '404', null])(
    'treats the HTTP status %j as unknown',
    (providerStatus) => {
      expect(googleProviderFailure({ providerStatus }).providerStatus).toBeNull()
    },
  )

  it.each(['answered', 'not_sent'])('keeps the dispatch %s', (dispatch) => {
    expect(googleProviderFailure({ dispatch }).dispatch).toBe(dispatch)
  })

  it.each(['sent', 'private resource', 7, null])(
    'treats the dispatch %j as unknown',
    (dispatch) => {
      expect(googleProviderFailure({ dispatch }).dispatch).toBe('unknown')
    },
  )

  it.each([null, undefined, 'failure', 42])(
    'answers with no evidence for the non-object %j',
    (value) => {
      expect(googleProviderFailure(value)).toEqual({
        providerStatus: null,
        providerErrorStatus: null,
        dispatch: 'unknown',
      })
    },
  )
})
