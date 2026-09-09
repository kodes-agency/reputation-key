// Review context — reply-template server function contracts.
// Runtime-imports the production module so changed-code evidence cannot be
// satisfied by testing a detached DTO or a duplicate handler.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

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
  listTemplates: vi.fn(),
  loadTemplate: vi.fn(),
  headersFromContext: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

const seam = vi.hoisted(() => ({ methods: [] as string[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    seam.methods.push(options?.method ?? 'GET')
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (ctx: { data: unknown }) => Promise<unknown>) {
        return async (opts: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(opts.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    reviewPublicApi: {
      reply: {
        listTemplates: mocks.listTemplates,
        loadTemplate: mocks.loadTemplate,
      },
    },
  }),
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

import { listReplyTemplatesFn, loadReplyTemplateFn } from './reply-templates'

const REVIEW_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEMPLATE_ID = '550e8400-e29b-41d4-a716-446655440001'
const TARGET_LANGUAGE = { kind: 'review_language' as const }
const ACTOR = {
  organizationId: '550e8400-e29b-41d4-a716-446655440002',
  userId: 'reply-template-manager',
  role: 'PropertyManager',
} as unknown as AuthContext

const listInput = {
  reviewId: REVIEW_ID,
  targetLanguage: TARGET_LANGUAGE,
}
const loadInput = {
  ...listInput,
  templateId: TEMPLATE_ID,
}

const callUnchecked = (fn: (input: { data: never }) => Promise<unknown>, data: unknown) =>
  fn({ data } as { data: never })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headersFromContext.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(ACTOR)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  mocks.listTemplates.mockResolvedValue({
    profile: null,
    groups: [],
    recommendedTemplateId: null,
  })
  mocks.loadTemplate.mockResolvedValue({
    id: '550e8400-e29b-41d4-a716-446655440003',
    reviewId: REVIEW_ID,
    text: 'Dear {guest_name}, thank you for your visit.',
    templateId: TEMPLATE_ID,
    templateVersion: 2,
  })
})

describe('reply-template server functions', () => {
  it('declares both contracts as POST mutations', () => {
    expect(seam.methods.slice(-2)).toEqual(['POST', 'POST'])
  })

  it.each([
    ['list', listReplyTemplatesFn, { ...listInput, reviewText: 'must not cross' }],
    ['load', loadReplyTemplateFn, { ...loadInput, templateId: 'not-a-uuid' }],
  ] as const)(
    'rejects invalid %s input before authorization',
    async (_name, fn, data) => {
      await expect(callUnchecked(fn, data)).rejects.toBeInstanceOf(Error)
      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
      expect(mocks.listTemplates).not.toHaveBeenCalled()
      expect(mocks.loadTemplate).not.toHaveBeenCalled()
    },
  )

  it('accepts the list shape, requires reply.manage, and forwards no review content', async () => {
    await expect(listReplyTemplatesFn({ data: listInput })).resolves.toEqual({
      profile: null,
      groups: [],
      recommendedTemplateId: null,
    })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'reply.manage',
    })
    expect(mocks.listTemplates).toHaveBeenCalledWith(listInput, ACTOR)
    expect(mocks.listTemplates.mock.calls[0]?.[0]).not.toHaveProperty('reviewText')
    expect(mocks.requireExecutionAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listTemplates.mock.invocationCallOrder[0]!,
    )
  })

  it('accepts the load shape, requires reply.manage, and forwards identifiers only', async () => {
    const result = await loadReplyTemplateFn({ data: loadInput })

    expect(result).toMatchObject({
      reviewId: REVIEW_ID,
      templateId: TEMPLATE_ID,
      templateVersion: 2,
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ACTOR,
      action: 'reply.manage',
    })
    expect(mocks.loadTemplate).toHaveBeenCalledWith(loadInput, ACTOR)
    expect(mocks.loadTemplate.mock.calls[0]?.[0]).not.toHaveProperty('reviewText')
  })

  it.each([
    ['list', listReplyTemplatesFn],
    ['load', loadReplyTemplateFn],
  ] as const)(
    'stops %s before the Review API when authorization denies',
    async (_name, fn) => {
      mocks.requireExecutionAllowed.mockRejectedValueOnce(
        new ServerFunctionError(
          'AuthError',
          'Authorization denied',
          'permission_denied',
          403,
        ),
      )
      const data = fn === listReplyTemplatesFn ? listInput : loadInput

      await expect(callUnchecked(fn, data)).rejects.toMatchObject({
        code: 'permission_denied',
        status: 403,
      })
      expect(mocks.listTemplates).not.toHaveBeenCalled()
      expect(mocks.loadTemplate).not.toHaveBeenCalled()
    },
  )
})
