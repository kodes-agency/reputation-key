import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contactRequestError } from '../domain/errors'
import { getContactRequestFn, revealContactRequestFn } from './contact-requests'

const mocks = vi.hoisted(() => ({
  enabled: true,
  getMasked: vi.fn(),
  reveal: vi.fn(),
  headers: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

// Outside a Start build `createServerFn` discards what the handler returns, so the
// seam runs the declared validator (a function or a schema) and then the handler.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (input: unknown): unknown => input
    const builder = {
      validator(next: typeof validate | { parse: typeof validate }) {
        validate = typeof next === 'function' ? next : (input) => next.parse(input)
        return builder
      },
      handler:
        (fn: (ctx: { data: unknown }) => Promise<unknown>) =>
        async (opts: { data: unknown }) =>
          fn({ data: validate(opts.data) }),
    }
    return builder
  },
}))
vi.mock('#/shared/auth/headers', () => ({ headersFromContext: mocks.headers }))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    guestContactRequests: {
      isEnabled: () => mocks.enabled,
      getMasked: mocks.getMasked,
      reveal: mocks.reveal,
    },
  }),
}))

const IDS = {
  propertyId: '10000000-0000-4000-8000-000000000001',
  portalId: '10000000-0000-4000-8000-000000000002',
}
const getData = { ...IDS, responseId: '10000000-0000-4000-8000-000000000003' }
const revealData = { ...IDS, contactRequestId: '10000000-0000-4000-8000-000000000004' }
const CTX = { userId: 'manager-1', organizationId: 'org-1' }

const refused = { status: 404, code: 'unavailable' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled = true
  mocks.headers.mockResolvedValue(new Headers())
  mocks.resolveTenantContext.mockResolvedValue(CTX)
  mocks.requireExecutionAllowed.mockResolvedValue(undefined)
})

describe('contact request manager endpoints', () => {
  it('answers a read with no request on the feedback like any missing request', async () => {
    mocks.getMasked.mockResolvedValue(null)

    await expect(getContactRequestFn({ data: getData })).rejects.toMatchObject(refused)
    expect(mocks.getMasked).toHaveBeenCalledOnce()
  })

  it('returns the masked request when there is one', async () => {
    const masked = { id: 'r1', maskedContact: '••••••••' }
    mocks.getMasked.mockResolvedValue(masked)

    await expect(getContactRequestFn({ data: getData })).resolves.toEqual(masked)
  })

  it.each([
    ['read', () => getContactRequestFn({ data: getData })],
    ['reveal', () => revealContactRequestFn({ data: revealData })],
  ])(
    'checks the switch on a %s before any identity or permission answer',
    async (_name, call) => {
      mocks.enabled = false
      mocks.resolveTenantContext.mockRejectedValue(new Error('identity was reached'))
      mocks.requireExecutionAllowed.mockRejectedValue(new Error('policy was reached'))

      await expect(call()).rejects.toMatchObject(refused)
      expect(mocks.headers).not.toHaveBeenCalled()
      expect(mocks.resolveTenantContext).not.toHaveBeenCalled()
      expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
      expect(mocks.getMasked).not.toHaveBeenCalled()
      expect(mocks.reveal).not.toHaveBeenCalled()
    },
  )

  it.each(['not_found', 'unavailable', 'not_authorized'] as const)(
    'answers a reveal refused as %s with the same 404',
    async (code) => {
      mocks.reveal.mockRejectedValue(contactRequestError(code, 'refused'))

      await expect(revealContactRequestFn({ data: revealData })).rejects.toMatchObject(
        refused,
      )
    },
  )
})
