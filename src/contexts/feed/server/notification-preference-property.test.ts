// A preference write names a Property. The command confirms the Property
// belongs to the caller's Organization before it writes, and answers the typed
// not-found a missing Property gets instead of the preference row's tenant
// foreign key surfacing as a generic internal error. The real createServerFn
// handler and tracedHandler run here; only the session, the execution policy
// and the composed public APIs are stubbed.

import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updatePreference: vi.fn(async () => undefined),
  propertyExists: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    feedPublicApi: { updatePreference: mocks.updatePreference },
    propertyPublicApi: { propertyExists: mocks.propertyExists },
  })),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { updateNotificationPreferenceFn } from './notifications'

const PROPERTY = '86700000-0000-4000-8000-000000000002'

const ACTOR = {
  organizationId: 'org-notification-preference',
  userId: 'user-notification-preference',
  role: 'PropertyManager',
} as const

const data = {
  propertyId: PROPERTY,
  category: 'workflow_collaboration',
  channel: 'in_app',
  enabled: true,
  cadence: 'daily',
} as const

describe('updateNotificationPreferenceFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(ACTOR)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('writes the preference for a Property of the caller’s Organization', async () => {
    mocks.propertyExists.mockResolvedValue(true)

    await withStartContext(() => updateNotificationPreferenceFn({ data }))

    expect(mocks.propertyExists).toHaveBeenCalledWith(ACTOR.organizationId, PROPERTY)
    expect(mocks.updatePreference).toHaveBeenCalledOnce()
  })

  it('refuses a Property of another Organization with a typed not-found and writes nothing', async () => {
    mocks.propertyExists.mockResolvedValue(false)

    await expect(
      withStartContext(() => updateNotificationPreferenceFn({ data })),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
    expect(mocks.updatePreference).not.toHaveBeenCalled()
  })
})
