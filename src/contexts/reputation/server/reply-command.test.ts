// The failures runReplyCommand maps that a database-backed call cannot provoke:
// an untagged error is masked, an already-tagged one passes through. The guard
// order, the refusals and the commands themselves are covered by
// reply-command.integration.test.ts.

import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

const ACTOR = {
  organizationId: '550e8400-e29b-41d4-a716-446655440011',
  userId: 'reply-command-manager',
  role: 'PropertyManager',
} as unknown as AuthContext

vi.mock('#/composition', () => ({
  getContainer: () => ({ reviewPublicApi: { reply: {} } }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: async () => ACTOR,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: async () => undefined,
}))

import { runReplyCommand } from './reply-command'

describe('runReplyCommand', () => {
  it('masks an untagged failure as a generic 500 without its detail', async () => {
    const error = await runReplyCommand(async () => {
      throw new Error('update replies set status = $1 failed: deadlock detected')
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServerFunctionError)
    expect(error).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
  })

  it('lets an already-tagged error through with its own status', async () => {
    await expect(
      runReplyCommand(async () => {
        throw new ServerFunctionError('AiError', 'Suggestion expired', 'expired', 409)
      }),
    ).rejects.toMatchObject({ name: 'AiError', code: 'expired', status: 409 })
  })
})
