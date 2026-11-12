import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { serverFunctionErrorAdapter } from '#/shared/auth/server-function-error'
import { getRequestContext } from '#/shared/observability/request-context'
import { publicCommand } from './public-command.server'
import type { CommandErrors } from './contracts'

const fakes = vi.hoisted(() => ({
  tenant: vi.fn(),
  headers: new Headers({ 'x-request-unit': 'public' }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => fakes.headers,
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: fakes.tenant }))

type LimitError = { code: 'limited'; message: string }
const errors: CommandErrors<LimitError> = {
  name: 'PublicError',
  is: (error): error is LimitError =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'limited',
  status: () => 429,
}
const data = { address: 'opaque-address', organizationId: 'untrusted-org' }
const scope = { organizationId: 'resolved-org', propertyId: 'resolved-property' }
const resolveScope = vi.fn(async () => scope)
const limit = vi.fn(async () => {})
const run = vi.fn(async () => ({ accepted: true }))
const invoke = publicCommand(
  {
    name: 'public.accept',
    method: 'POST',
    errors,
    resolveScope,
    limit,
    execution: () => ({ action: 'public:accept', capability: 'portal.public_read' }),
  },
  run,
)

beforeEach(() => {
  vi.clearAllMocks()
  resolveScope.mockResolvedValue(scope)
  limit.mockResolvedValue(undefined)
  run.mockResolvedValue({ accepted: true })
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
  initExecutionPolicy(
    createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
  )
})
afterEach(() => {
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
})

describe('public command shell', () => {
  it('resolves scope and limits before effects without asking for manager membership', async () => {
    await expect(invoke({ data })).resolves.toEqual({ accepted: true })
    expect(resolveScope).toHaveBeenCalledWith({ data, headers: fakes.headers })
    expect(limit).toHaveBeenCalledWith({ data, headers: fakes.headers, scope })
    expect(run).toHaveBeenCalledWith({ data, headers: fakes.headers, scope })
    expect(resolveScope.mock.invocationCallOrder[0]).toBeLessThan(
      limit.mock.invocationCallOrder[0]!,
    )
    expect(limit.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0]!,
    )
    expect(fakes.tenant).not.toHaveBeenCalled()
  })

  it('does not run limits or effects when scope resolution fails', async () => {
    resolveScope.mockRejectedValueOnce(new Error('lookup failed'))
    await expect(invoke({ data })).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
    })
    expect(limit).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('maps a declared limit refusal and never runs the effect', async () => {
    limit.mockRejectedValueOnce({ code: 'limited', message: 'Try again later.' })
    await expect(invoke({ data })).rejects.toMatchObject({
      _tag: 'PublicError',
      code: 'limited',
      status: 429,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('checks suspension against resolved scope rather than the input organization', async () => {
    const isOrgSuspended = vi.fn((id: string) => id === scope.organizationId)
    initCapabilityPolicyStore({
      ...createEnvCapabilityPolicyStore({}),
      isOrgSuspended,
    })
    await expect(invoke({ data })).rejects.toMatchObject({
      status: 403,
      code: 'org_suspended',
    })
    expect(isOrgSuspended).toHaveBeenCalledWith(scope.organizationId)
    expect(isOrgSuspended).not.toHaveBeenCalledWith(data.organizationId)
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps consent requirements on the public execution decision', async () => {
    const consentCommand = publicCommand(
      {
        name: 'public.acceptWithConsent',
        method: 'POST',
        errors,
        resolveScope,
        limit,
        execution: () => ({
          action: 'public:accept',
          requiredPublicConsents: ['response'],
        }),
      },
      run,
    )
    await expect(consentCommand({ data })).rejects.toMatchObject({
      code: 'consent_required',
      status: 403,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('serializes an opaque failure and request ID without its cause', async () => {
    let requestId: string | undefined
    run.mockImplementationOnce(async () => {
      requestId = getRequestContext()?.requestId
      throw new Error('private-provider-response')
    })
    const failure = await invoke({ data }).catch((error: unknown) => error)
    if (!serverFunctionErrorAdapter.test(failure))
      throw new Error('Expected a wire error')
    expect(requestId).toEqual(expect.any(String))
    const wire = serverFunctionErrorAdapter.toSerializable(failure)
    expect(wire).toMatchObject({
      status: 500,
      requestId,
      message: 'Internal server error',
    })
    expect(JSON.stringify(wire)).not.toContain('private-provider-response')
    expect(serverFunctionErrorAdapter.fromSerializable(wire).cause).toBeUndefined()
  })
})
