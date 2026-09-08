import { describe, expect, it } from 'vitest'
import { ServerFunctionError, serverFunctionErrorAdapter } from './server-function-error'

describe('serverFunctionErrorAdapter', () => {
  const refusal = new ServerFunctionError(
    'AuthError',
    'Valid session required',
    'unauthorized',
    401,
  )

  it('carries name, code and status across the wire, not just the message', () => {
    const wire = serverFunctionErrorAdapter.toSerializable(refusal)
    expect(wire).toEqual({
      name: 'AuthError',
      message: 'Valid session required',
      code: 'unauthorized',
      status: 401,
    })

    const restored = serverFunctionErrorAdapter.fromSerializable(wire)
    expect(restored).toBeInstanceOf(ServerFunctionError)
    expect(restored.name).toBe('AuthError')
    expect(restored.code).toBe('unauthorized')
    expect(restored.status).toBe(401)
    expect(restored.message).toBe('Valid session required')
  })

  it('leaves ordinary errors to the framework default', () => {
    expect(serverFunctionErrorAdapter.test(refusal)).toBe(true)
    expect(serverFunctionErrorAdapter.test(new Error('boom'))).toBe(false)
    expect(serverFunctionErrorAdapter.test({ status: 401 })).toBe(false)
  })
})
