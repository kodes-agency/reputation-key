import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import type { ZodType } from 'zod/v4'

type Seam = {
  method: string
  schema?: ZodType
  handle?: (input: { data: unknown }) => Promise<unknown>
}
const mocks = vi.hoisted(() => ({
  seams: [] as Seam[],
  resolve: vi.fn(),
  authorize: vi.fn(),
  get: vi.fn(),
  claim: vi.fn(),
  markSeen: vi.fn(),
  setAutoShow: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: ({ method }: { method: string }) => {
    const seam: Seam = { method }
    mocks.seams.push(seam)
    return {
      validator(schema: ZodType) {
        seam.schema = schema
        return this
      },
      handler(handle: Seam['handle']) {
        seam.handle = handle
        return handle
      },
    }
  },
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({ identityProductUpdates: mocks }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.resolve }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.authorize,
}))
vi.mock('#/shared/auth/server-errors', () => ({
  catchUntagged: () => new Error('Safe failure'),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
import './product-updates'

const actor = {
  userId: 'session-person',
  organizationId: 'session-organization',
  role: 'PropertyManager',
}
async function call(index: number, data: unknown) {
  const seam = mocks.seams[index]!
  return seam.handle!({ data: seam.schema!.parse(data) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue(actor)
  mocks.authorize.mockResolvedValue(undefined)
})

describe('product update session boundaries', () => {
  it('uses the session person and Organization, discarding supplied identities', async () => {
    await call(0, { userId: 'someone-else', organizationId: 'elsewhere' })
    expect(mocks.get).toHaveBeenCalledWith({ actor })
    expect(mocks.authorize).toHaveBeenCalledWith({
      actor,
      action: 'identity.profile.update',
    })
    expect(mocks.seams.map(({ method }) => method)).toEqual([
      'GET',
      'POST',
      'POST',
      'POST',
    ])
  })
  it('authorizes before any claim, receipt or preference write', async () => {
    mocks.authorize.mockRejectedValue(new Error('Denied'))
    for (const [index, data] of [
      [1, {}],
      [2, { entryIds: ['one'] }],
      [3, { autoShow: false }],
    ] as const) {
      await expect(call(index, data)).rejects.toThrow('Denied')
    }
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.markSeen).not.toHaveBeenCalled()
    expect(mocks.setAutoShow).not.toHaveBeenCalled()
  })
  it('validates property scopes, receipt bounds and the personal switch', async () => {
    await expect(call(0, { propertyId: 'invalid' })).rejects.toThrow(ZodError)
    await expect(
      call(2, { entryIds: Array.from({ length: 501 }, () => 'one') }),
    ).rejects.toThrow(ZodError)
    await expect(call(3, { autoShow: 'yes' })).rejects.toThrow(ZodError)
    expect(mocks.get).not.toHaveBeenCalled()
    await call(3, { autoShow: false })
    expect(mocks.setAutoShow).toHaveBeenCalledWith(actor, false)
  })
  it('sanitizes unexpected persistence failures', async () => {
    mocks.get.mockRejectedValueOnce(new Error('private details'))
    await expect(call(0, {})).rejects.toThrow('Safe failure')
  })
})
