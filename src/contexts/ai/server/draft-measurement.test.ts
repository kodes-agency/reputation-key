import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod/v4'
const mocks = vi.hoisted(() => ({ record: vi.fn(), source: vi.fn(), policy: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (schema: z.ZodType) => ({
      handler:
        (handler: (input: { data: unknown }) => Promise<unknown>) =>
        async (input: { data: unknown }) =>
          handler({ data: schema.parse(input.data) }),
    }),
  }),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/auth/server-errors', () => ({
  catchUntagged: () => new Error('Safe failure'),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: async () => ({ organizationId: 'tenant', userId: 'manager' }),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    aiPublicApi: { recordDraftMeasurement: mocks.record },
    reviewPublicApi: { aiReviewSource: { readCurrentSource: mocks.source } },
  }),
}))
import { recordDraftMeasurementFn } from './draft-measurement'
const data = {
  reviewId: '4f000000-0000-4000-8000-000000000010',
  generationId: '4f000000-0000-4000-8000-000000000020',
  baseReplyRevision: 0,
  event: 'shown' as const,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.policy.mockResolvedValue(undefined)
  mocks.source.mockResolvedValue({
    status: 'available',
    source: { propertyId: 'property' },
  })
})
describe('advisory draft events', () => {
  it('uses the authenticated tenant, actor and stored review Property', async () => {
    await recordDraftMeasurementFn({ data })
    expect(mocks.policy).toHaveBeenCalledWith({
      actor: { organizationId: 'tenant', userId: 'manager' },
      action: 'reply.manage',
      propertyId: 'property',
    })
    expect(mocks.record).toHaveBeenCalledWith(
      {
        organizationId: 'tenant',
        propertyId: 'property',
        reviewId: data.reviewId,
        actorUserId: 'manager',
      },
      data,
    )
  })
  it('refuses arbitrary content before touching infrastructure', async () => {
    await expect(
      Reflect.apply(recordDraftMeasurementFn, undefined, [
        { data: { ...data, text: 'PRIVATE DRAFT' } },
      ]),
    ).rejects.toThrow(/Unrecognized key/)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('sanitizes storage failures', async () => {
    mocks.record.mockRejectedValueOnce(new Error('PRIVATE DATABASE DETAILS'))
    await expect(recordDraftMeasurementFn({ data })).rejects.toThrow('Safe failure')
  })
})
