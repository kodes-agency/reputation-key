// Review context — the reply command guard and every server function that runs
// through it.
//
// `runReplyCommand` is the whole authorization and error contract of the reply
// commands the Inbox sends: the session's tenant, `reply.manage` before the
// Review API, a ReviewError mapped to its HTTP status with its sentence, and
// anything untagged masked. The table below then drives each command server
// function through the production modules, so every one stays pinned to its own
// Review API method and forwards only its own input — including the six that
// reply-publication-functions.test.ts does not cover.
//
// SEAM. Same seam as reply-publication-functions.test.ts: `@tanstack/react-start`
// is mocked with a builder that validates, runs the handler and returns its
// value, with the declared method on each function. `tracedHandler`,
// `catchUntagged`, `throwContextError` and the zod DTOs stay real.
//
// Pure unit tests — no database.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import type * as LoggerModule from '#/shared/observability/logger'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { reviewError } from '../domain/errors'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const mocks = vi.hoisted(() => ({
  reply: {
    draft: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    editPublished: vi.fn(),
    reject: vi.fn(),
    delete: vi.fn(),
    retryPublish: vi.fn(),
    checkPublication: vi.fn(),
  },
  headersFromContext: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        return Object.assign(
          async (opts: { data: unknown }) => {
            if (validator === null) throw new Error('server fn declared no validator')
            const parsed = await validator['~standard'].validate(opts.data)
            if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
            return fn({ data: parsed.value })
          },
          { method: options?.method ?? 'GET' },
        )
      },
    }
    return builder
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))

vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>()
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { ...actual, getLogger: () => logger }
})

vi.mock('#/composition', () => ({
  getContainer: () => ({ reviewPublicApi: { reply: mocks.reply } }),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: mocks.headersFromContext,
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { runReplyCommand } from './reply-command'
import {
  approveReplyFn,
  checkReplyPublicationFn,
  deleteReplyFn,
  draftReplyFn,
  editPublishedReplyFn,
  rejectReplyFn,
  retryPublishFn,
  submitReplyFn,
} from './reply'

const REVIEW_ID = '550e8400-e29b-41d4-a716-446655440010'
const ACTOR = {
  organizationId: '550e8400-e29b-41d4-a716-446655440011',
  userId: 'reply-command-manager',
  role: 'PropertyManager',
} as unknown as AuthContext
const REPLY = { id: '550e8400-e29b-41d4-a716-446655440012', status: 'draft' }

type ReplyMethod = keyof typeof mocks.reply

/** Each command server function, the Review API method it owns, and its input. */
const COMMANDS = [
  {
    name: 'draftReplyFn',
    fn: draftReplyFn,
    method: 'draft',
    data: { reviewId: REVIEW_ID, text: 'Thank you for staying with us.' },
    forwarded: { reviewId: REVIEW_ID, text: 'Thank you for staying with us.' },
  },
  {
    name: 'submitReplyFn',
    fn: submitReplyFn,
    method: 'submit',
    data: { reviewId: REVIEW_ID },
    forwarded: { reviewId: REVIEW_ID },
  },
  {
    name: 'approveReplyFn',
    fn: approveReplyFn,
    method: 'approve',
    data: { reviewId: REVIEW_ID },
    forwarded: { reviewId: REVIEW_ID },
  },
  {
    name: 'editPublishedReplyFn',
    fn: editPublishedReplyFn,
    method: 'editPublished',
    data: { reviewId: REVIEW_ID, text: 'Updated thanks.', provenanceToken: 'token-1' },
    // An edit republishes the text alone: no AI provenance rides along.
    forwarded: { reviewId: REVIEW_ID, text: 'Updated thanks.' },
  },
  {
    name: 'rejectReplyFn',
    fn: rejectReplyFn,
    method: 'reject',
    data: { reviewId: REVIEW_ID, reason: 'Wrong guest name' },
    forwarded: { reviewId: REVIEW_ID, reason: 'Wrong guest name' },
  },
  {
    name: 'deleteReplyFn',
    fn: deleteReplyFn,
    method: 'delete',
    data: { reviewId: REVIEW_ID },
    forwarded: { reviewId: REVIEW_ID },
  },
  {
    name: 'retryPublishFn',
    fn: retryPublishFn,
    method: 'retryPublish',
    data: { reviewId: REVIEW_ID },
    forwarded: { reviewId: REVIEW_ID },
  },
  {
    name: 'checkReplyPublicationFn',
    fn: checkReplyPublicationFn,
    method: 'checkPublication',
    data: { reviewId: REVIEW_ID },
    forwarded: { reviewId: REVIEW_ID },
  },
] as const satisfies ReadonlyArray<{
  name: string
  fn: (input: { data: never }) => Promise<unknown>
  method: ReplyMethod
  data: Record<string, unknown>
  forwarded: Record<string, unknown>
}>

const call = (fn: (input: { data: never }) => Promise<unknown>, data: unknown) =>
  fn({ data } as { data: never })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  for (const method of Object.keys(mocks.reply) as ReplyMethod[]) {
    mocks.reply[method].mockResolvedValue(REPLY)
  }
})

describe('runReplyCommand', () => {
  it('resolves the tenant, authorizes reply.manage, then runs the command as that actor', async () => {
    const command = vi.fn(async () => REPLY)

    await expect(runReplyCommand(command)).resolves.toBe(REPLY)

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'reply.manage',
    })
    expect(command).toHaveBeenCalledWith(mocks.reply, ACTOR)
    const [resolved] = mocks.resolveTenantContext.mock.invocationCallOrder
    const [authorized] = mocks.requireExecutionAllowed.mock.invocationCallOrder
    const [ran] = command.mock.invocationCallOrder
    expect(resolved).toBeLessThan(authorized!)
    expect(authorized).toBeLessThan(ran!)
  })

  it('never runs the command when authorization denies', async () => {
    const command = vi.fn(async () => REPLY)
    mocks.requireExecutionAllowed.mockRejectedValueOnce(
      new ServerFunctionError(
        'AuthError',
        'Authorization denied',
        'permission_denied',
        403,
      ),
    )

    await expect(runReplyCommand(command)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'permission_denied',
      status: 403,
    })
    expect(command).not.toHaveBeenCalled()
  })

  it('maps a ReviewError to its HTTP status and keeps the sentence the manager reads', async () => {
    const refusal = reviewError('reply_not_found', 'This reply no longer exists.')

    await expect(
      runReplyCommand(async () => {
        throw refusal
      }),
    ).rejects.toMatchObject({
      name: 'ReviewError',
      code: 'reply_not_found',
      status: 404,
      message: refusal.message,
    })
  })

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

describe('reply command server functions', () => {
  it.each(COMMANDS)(
    '$name is a POST that gates reply.manage before reply.$method, with only its input',
    async ({ fn, method, data, forwarded }) => {
      await call(fn, data)

      expect(fn).toHaveProperty('method', 'POST')
      expect(mocks.reply[method]).toHaveBeenCalledTimes(1)
      expect(mocks.reply[method]).toHaveBeenCalledWith(forwarded, ACTOR)
      expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.reply[method].mock.invocationCallOrder[0]!,
      )
      for (const other of Object.keys(mocks.reply) as ReplyMethod[]) {
        if (other !== method) expect(mocks.reply[other]).not.toHaveBeenCalled()
      }
    },
  )

  it.each(COMMANDS.filter(({ method }) => method !== 'delete'))(
    '$name returns what reply.$method returned',
    async ({ fn, data }) => {
      await expect(call(fn, data)).resolves.toBe(REPLY)
    },
  )

  it('deleteReplyFn answers success once the Review API has deleted the reply', async () => {
    await expect(call(deleteReplyFn, { reviewId: REVIEW_ID })).resolves.toEqual({
      success: true,
    })
  })

  it.each(COMMANDS)(
    '$name rejects a non-UUID review id before resolving the tenant',
    async ({ fn, data, method }) => {
      await expect(call(fn, { ...data, reviewId: 'not-a-uuid' })).rejects.toThrow(
        /"path":\["reviewId"\]/,
      )
      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.reply[method]).not.toHaveBeenCalled()
    },
  )

  it('draftReplyFn suppresses caching before it resolves the tenant', async () => {
    await call(draftReplyFn, COMMANDS[0].data)

    expect(mocks.setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store, max-age=0'],
      ['Pragma', 'no-cache'],
      ['Expires', '0'],
    ])
    const lastHeader = mocks.setResponseHeader.mock.invocationCallOrder.at(-1)
    const [resolved] = mocks.headersFromContext.mock.invocationCallOrder
    expect(lastHeader).toBeLessThan(resolved!)
  })
})
