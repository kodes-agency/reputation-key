import { describe, expect, it, vi } from 'vitest'
import { serverFunctionErrorAdapter } from '#/shared/auth/server-function-error'
import { getRequestContext } from '#/shared/observability/request-context'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { commandHandler } from './command.server'
import type { CommandErrors } from './contracts'

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))

type DomainError = { code: 'refused'; message: string }
const errors: CommandErrors<DomainError> = {
  name: 'DomainError',
  is: (error): error is DomainError =>
    typeof error === 'object' && error !== null && 'code' in error,
  status: () => 409,
}

describe('commandHandler', () => {
  it('answers an unknown failure opaquely with its request ID across serialization', async () => {
    let requestId: string | undefined
    const original = new Error('SQL parameters: private-customer-value')
    const invoke = commandHandler(
      { method: 'POST', name: 'test.fail', errors },
      async () => {
        requestId = getRequestContext()?.requestId
        throw original
      },
    )

    const failure = await withStartContext(() => invoke({ data: {} })).catch(
      (error: unknown) => error,
    )

    expect(serverFunctionErrorAdapter.test(failure)).toBe(true)
    if (!serverFunctionErrorAdapter.test(failure))
      throw new Error('Expected a wire error')
    expect(requestId).toEqual(expect.any(String))
    const wire = serverFunctionErrorAdapter.toSerializable(failure)
    expect(wire).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
      requestId,
    })
    expect(JSON.stringify(wire)).not.toContain('private-customer-value')
    const restored = serverFunctionErrorAdapter.fromSerializable(wire)
    expect(restored).toMatchObject({ requestId })
    expect(restored.cause).toBeUndefined()
    expect(failure.cause).toBe(original)
  })
})
