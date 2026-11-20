// Portal context — issue and replace a Portal's address when the store refuses
// the new print code's hash. The rest of these server functions is covered over
// PostgreSQL in portal-address-handler.integration.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { portalError } from '#/contexts/portal/domain/errors'

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  issuePortalToken: vi.fn(),
  rotatePortalToken: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/beta-capabilities', () => ({
  assertBetaCapability: vi.fn(),
  assertGlobalCapability: vi.fn(),
  BetaCapabilityError: class BetaCapabilityError extends Error {},
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: vi.fn() })),
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader,
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    portalPublicApi: {
      management: {
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
        issuePortalToken: mocks.issuePortalToken,
        rotatePortalToken: mocks.rotatePortalToken,
      },
    },
  })),
}))
vi.mock('#/shared/observability/logger', async (importOriginal) => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
    getLogger: vi.fn(() => logger),
  }
})

import { issuePortalToken, rotatePortalToken } from '#/contexts/portal/server/portals'

const CTX = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
type PortalCall = (input: { data: { portalId: string } }) => Promise<unknown>
const ADDRESS_HANDLERS: readonly (readonly [
  string,
  PortalCall,
  typeof mocks.issuePortalToken,
])[] = [
  ['issuePortalToken', (input) => issuePortalToken(input), mocks.issuePortalToken],
  ['rotatePortalToken', (input) => rotatePortalToken(input), mocks.rotatePortalToken],
]

describe.each(ADDRESS_HANDLERS)('%s handler (executable)', (_name, handler, useCase) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(CTX)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.resolvePortalManagementScope.mockResolvedValue({
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalId: 'portal-1',
    })
  })

  it('answers a refused print code hash as a 409 the manager can retry', async () => {
    useCase.mockRejectedValue(
      portalError('print_code_collision', 'The new code could not be saved. Try again.'),
    )

    await expect(
      withStartContext(() => handler({ data: { portalId: 'portal-1' } })),
    ).rejects.toMatchObject({ code: 'print_code_collision', status: 409 })
  })
})
