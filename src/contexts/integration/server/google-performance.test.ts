import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPerformance: vi.fn(),
  renewLease: vi.fn(),
  resolveTenantContext: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    integrationPublicApi: {
      performance: {
        get: mocks.getPerformance,
        renewLease: mocks.renewLease,
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  getPropertyGooglePerformance,
  renewPropertyGooglePerformanceLease,
} from './google-performance'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const actor = {
  organizationId: '00000000-0000-4000-8000-000000000002',
  userId: 'user-1',
  role: 'AccountAdmin',
}

describe('Google Performance server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
  })

  it('forwards the validated property, preset, and resolved tenant actor', async () => {
    const result = { status: 'ready', report: { preset: '30d' } }
    mocks.getPerformance.mockResolvedValue(result)

    await withStartContext(() =>
      getPropertyGooglePerformance({
        data: { propertyId: PROPERTY_ID, preset: '30d' },
      }),
    )
    expect(mocks.getPerformance).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      preset: '30d',
      actor,
    })
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, max-age=0',
    )
  })

  it('forwards opaque lease renewal and contains application failure', async () => {
    mocks.renewLease.mockRejectedValue(new Error('provider unavailable'))

    await withStartContext(() =>
      renewPropertyGooglePerformanceLease({
        data: { propertyId: PROPERTY_ID, leaseRef: 'lease-ref' },
      }),
    )
    expect(mocks.renewLease).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      leaseRef: 'lease-ref',
      actor,
    })
  })
})
