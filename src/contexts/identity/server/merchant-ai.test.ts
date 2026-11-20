// The one refusal mapping the request path cannot reach: the execution policy
// admits only an AccountAdmin, whose management scope is never denied, so the
// overview's capability_denied is injected here. Everything else these server
// functions do is proven over PostgreSQL in merchant-ai.integration.test.ts.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listOverview: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { merchantAiAuthorization: { listOverview: mocks.listOverview } },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ 'x-request-id': 'request-1' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { listMerchantAiOverviewFn } from './merchant-ai'
import { MerchantAiAuthorizationError } from '../consent/merchant-ai-authorization.server'

describe('Merchant AI overview refusal', () => {
  it('maps a denied overview to forbidden', async () => {
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: '00000000-0000-4000-8000-000000000002',
      userId: 'user-1',
      role: 'AccountAdmin',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.listOverview.mockRejectedValue(
      new MerchantAiAuthorizationError(
        'capability_denied',
        'Merchant AI overview is denied',
      ),
    )

    await expect(
      withStartContext(() => listMerchantAiOverviewFn()),
    ).rejects.toMatchObject({
      name: 'MerchantAiAuthorizationError',
      code: 'capability_denied',
      status: 403,
    })
  })
})
