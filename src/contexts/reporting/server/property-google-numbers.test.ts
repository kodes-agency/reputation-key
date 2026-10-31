import { beforeEach, describe, expect, it, vi } from 'vitest'

type StandardValidator = Readonly<{
  '~standard': Readonly<{
    validate: (
      input: unknown,
    ) =>
      | Promise<{ value?: unknown; issues?: ReadonlyArray<unknown> }>
      | { value?: unknown; issues?: ReadonlyArray<unknown> }
  }>
}>

const seam = vi.hoisted(() => ({ method: null as string | null }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    let validator: StandardValidator | null = null
    const builder = {
      validator(next: StandardValidator) {
        validator = next
        return builder
      },
      handler(fn: (context: { data: unknown }) => Promise<unknown>) {
        seam.method = options?.method ?? 'GET'
        return async (options: { data: unknown }) => {
          if (validator === null) throw new Error('server fn declared no validator')
          const parsed = await validator['~standard'].validate(options.data)
          if (parsed.issues) throw new Error(JSON.stringify(parsed.issues))
          return fn({ data: parsed.value })
        }
      },
    }
    return builder
  },
}))

const mocks = vi.hoisted(() => ({ read: vi.fn(), tenant: vi.fn(), policy: vi.fn() }))
vi.mock('#/composition', () => ({
  getContainer: () => ({ dashboardPublicApi: { readPropertyGoogleNumbers: mocks.read } }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.tenant }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { dashboardError } from '../domain/dashboard-errors'
import { getPropertyGoogleNumbersFn } from './property-google-numbers'

const pid = '11111111-1111-4111-8111-111111111111'
const actor = {
  organizationId: 'session-org',
  userId: 'manager',
  role: 'PropertyManager',
}
const call = () => getPropertyGoogleNumbersFn({ data: { propertyId: pid } })

describe('getPropertyGoogleNumbersFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tenant.mockResolvedValue(actor)
    mocks.policy.mockResolvedValue(undefined)
    mocks.read.mockResolvedValue(null)
  })
  it('asks only dashboard.read on the Property, and supplies the session tenant and actor', async () => {
    expect(await call()).toBeNull()
    expect(seam.method).toBe('GET')
    expect(mocks.policy).toHaveBeenCalledExactlyOnceWith({
      actor,
      action: 'dashboard.read',
      propertyId: pid,
    })
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(
      { organizationId: actor.organizationId, propertyId: pid },
      actor,
    )
  })
  it('rejects browser-supplied Organization and malformed Property ids', async () => {
    for (const data of [
      { propertyId: pid, organizationId: 'foreign' },
      { propertyId: 'bad' },
    ]) {
      await expect(
        getPropertyGoogleNumbersFn({ data } as Parameters<
          typeof getPropertyGoogleNumbersFn
        >[0]),
      ).rejects.toThrow(/unrecognized_keys|invalid_format/)
    }
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not read when the execution policy refuses it', async () => {
    mocks.policy.mockRejectedValue(new Error('denied'))
    await expect(call()).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
      _tag: 'InternalError',
    })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('maps the application Property refusal to a safe tagged error', async () => {
    mocks.read.mockRejectedValue(
      dashboardError('forbidden', 'Property not assigned to caller'),
    )
    await expect(call()).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
      _tag: 'DashboardError',
    })
  })
})
