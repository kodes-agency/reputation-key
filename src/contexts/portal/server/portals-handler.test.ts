// Portal context — server function handler invocation tests (B5)
// Imports and invokes the actual createServerFn handler (not just error-mapping helpers).
// Verifies the full chain: input → auth resolution → use case → return.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ServerFunctionError } from '#/shared/auth/server-errors'

// ── TanStack Start context setup ──────────────────────────────────
// createServerFn's middleware chain reads startOptions from a global ALS.
// In tests (no server runtime), we must seed it before invoking handlers.
const START_KEY = Symbol.for('tanstack-start:start-storage-context')
function ensureStartALS(): AsyncLocalStorage<unknown> {
  const g = globalThis as Record<symbol, AsyncLocalStorage<unknown> | undefined>
  if (!g[START_KEY]) g[START_KEY] = new AsyncLocalStorage()
  return g[START_KEY]!
}
/** Wraps a server-fn call so the TanStack Start middleware chain can read startOptions. */
function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  return ensureStartALS().run({ startOptions: {} }, fn)
}

// Stable mock functions so we can control return values per-test.
const mocks = vi.hoisted(() => ({
  listPortals: vi.fn(),
  listPortalManagementPropertyIds: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  decide: vi.fn(),
  resolvePortalManagementScope: vi.fn(),
  getPortalPublicationHistory: vi.fn(),
  updatePortal: vi.fn(),
  requestUploadUrl: vi.fn(),
  finalizeUpload: vi.fn(),
  rotatePortalToken: vi.fn(),
  softDeletePortal: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))

// BQR-0: portal.read is non-core; handler tests assert use-case wiring, not capability policy.
vi.mock('#/shared/auth/beta-capabilities', () => ({
  assertBetaCapability: vi.fn(),
  assertGlobalCapability: vi.fn(),
  BetaCapabilityError: class BetaCapabilityError extends Error {},
}))

// BQC-2.6: ExecutionPolicy seam — per-property decisions are controlled by each test.
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: mocks.decide })),
}))

vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    clock: () => new Date('2026-08-28T00:00:00.000Z'),
    logger: { error: mocks.loggerError },
    portalPublicApi: {
      management: {
        listPortals: mocks.listPortals,
        listPortalManagementPropertyIds: mocks.listPortalManagementPropertyIds,
        resolvePortalManagementScope: mocks.resolvePortalManagementScope,
        getPortalPublicationHistory: mocks.getPortalPublicationHistory,
        updatePortal: mocks.updatePortal,
        requestUploadUrl: mocks.requestUploadUrl,
        finalizeUpload: mocks.finalizeUpload,
        rotatePortalToken: mocks.rotatePortalToken,
        softDeletePortal: mocks.softDeletePortal,
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
    error: mocks.loggerError,
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
    getLogger: vi.fn(() => logger),
  }
})

import {
  deletePortal,
  getPortalPublicationHistory,
  listPortals,
  requestUploadUrl,
  finalizeUpload,
  rotatePortalToken,
  updatePortal,
} from '#/contexts/portal/server/portals'

const TEST_CTX = {
  userId: 'user-test-1',
  organizationId: 'org-test-aaaa',
  role: 'AccountAdmin',
} as const
const deniedResourceProbes: readonly [
  name: string,
  invoke: () => Promise<unknown>,
  effect: ReturnType<typeof vi.fn>,
][] = [
  [
    'publication',
    async () =>
      updatePortal({
        data: { portalId: 'portal-p2', publicationState: 'published' },
      }),
    mocks.updatePortal,
  ],
  [
    'token rotation',
    async () => rotatePortalToken({ data: { portalId: 'portal-p2' } }),
    mocks.rotatePortalToken,
  ],
  [
    'archive',
    async () => deletePortal({ data: { portalId: 'portal-p2' } }),
    mocks.softDeletePortal,
  ],
]
const propertyDisabled = () =>
  new ServerFunctionError(
    'AuthError',
    'Authorization denied: property_disabled',
    'property_disabled',
    403,
  )

describe('listPortals handler (executable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(TEST_CTX)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.listPortalManagementPropertyIds.mockResolvedValue(['prop-test-1'])
    mocks.decide.mockResolvedValue({ allowed: true, reason: 'allowed' })
    mocks.resolvePortalManagementScope.mockResolvedValue({
      organizationId: 'org-test-aaaa',
      propertyId: 'property-p2',
      portalId: 'portal-p2',
    })
  })

  it('returns the scoped manager publication history read model', async () => {
    const history = {
      current: {
        activationSequence: 3,
        version: 1,
        kind: 'rollback',
        activatedAt: '2026-08-26T14:00:00.000Z',
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [],
      hasPendingChanges: true,
      nextCursor: null,
    } as const
    mocks.getPortalPublicationHistory.mockResolvedValue(history)

    await withStartContext(() =>
      getPortalPublicationHistory({ data: { portalId: 'portal-p2' } }),
    )
    expect(mocks.resolvePortalManagementScope).toHaveBeenCalled()
    expect(mocks.getPortalPublicationHistory).toHaveBeenCalledWith(
      { portalId: 'portal-p2' },
      TEST_CTX,
    )
  })

  it('resolves auth context and invokes the listPortals use case with caller context', async () => {
    const fakePortals = [
      { id: 'p1', name: 'Portal 1' },
      { id: 'p2', name: 'Portal 2' },
    ]
    mocks.listPortals.mockResolvedValue(fakePortals)

    await withStartContext(() => listPortals({ data: {} }))

    // The handler resolves auth from request headers
    expect(mocks.resolveTenantContext).toHaveBeenCalledTimes(1)

    // The handler passes the validated data + resolved auth context to the use case
    expect(mocks.listPortals).toHaveBeenCalledTimes(1)
    const [dataArg, ctxArg] = mocks.listPortals.mock.calls[0]!
    expect(dataArg).toEqual({ propertyId: 'prop-test-1' })
    expect(ctxArg.organizationId).toBe('org-test-aaaa')
    expect(ctxArg.role).toBe('AccountAdmin')
  })

  it('passes the propertyId filter through to the use case', async () => {
    mocks.listPortals.mockResolvedValue([])

    await withStartContext(() => listPortals({ data: { propertyId: 'prop-test-1' } }))

    const [dataArg] = mocks.listPortals.mock.calls[0]!
    expect(dataArg).toEqual({ propertyId: 'prop-test-1' })
  })

  it('enumerates only P1 properties when Staff scope includes a disabled P2', async () => {
    mocks.resolveTenantContext.mockResolvedValue({ ...TEST_CTX, role: 'Staff' })
    mocks.listPortalManagementPropertyIds.mockResolvedValue([
      'property-p1',
      'property-p2',
    ])
    mocks.decide.mockImplementation(async ({ propertyId }) => ({
      allowed: propertyId === 'property-p1',
      reason: propertyId === 'property-p1' ? 'allowed' : 'property_disabled',
    }))
    mocks.listPortals.mockImplementation(async ({ propertyId }) =>
      propertyId === 'property-p1' ? [{ id: 'portal-p1' }] : [{ id: 'portal-p2' }],
    )

    await withStartContext(() => listPortals({ data: {} }))
    expect(mocks.listPortals).toHaveBeenCalledTimes(1)
    expect(mocks.listPortals).toHaveBeenCalledWith(
      { propertyId: 'property-p1' },
      expect.objectContaining({ role: 'Staff' }),
    )
  })

  it('denies direct P2 list scope without querying Portal content', async () => {
    mocks.requireExecutionAllowed.mockRejectedValue(propertyDisabled())

    await expect(
      withStartContext(() => listPortals({ data: { propertyId: 'property-p2' } })),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'property_disabled', status: 403 })

    expect(mocks.listPortals).not.toHaveBeenCalled()
  })

  it.each(deniedResourceProbes)(
    'denies P2 %s before effects',
    async (_name, invoke, effect) => {
      mocks.requireExecutionAllowed.mockRejectedValue(propertyDisabled())

      await expect(
        withStartContext<unknown>(async (): Promise<unknown> => await invoke()),
      ).rejects.toMatchObject({
        _tag: 'AuthError',
        code: 'property_disabled',
        status: 403,
      })
      expect(effect).not.toHaveBeenCalled()
    },
  )

  it('treats the legacy delete endpoint as recoverable archive', async () => {
    mocks.updatePortal.mockResolvedValue({
      id: 'portal-p2',
      publicationState: 'archived',
    })

    await withStartContext(() => deletePortal({ data: { portalId: 'portal-p2' } }))

    expect(mocks.updatePortal).toHaveBeenCalledWith(
      { portalId: 'portal-p2', publicationState: 'archived' },
      TEST_CTX,
    )
    expect(mocks.softDeletePortal).not.toHaveBeenCalled()
  })

  const uploadFailureCases: ReadonlyArray<{
    name: string
    effect: typeof mocks.requestUploadUrl
    invoke: () => Promise<unknown>
    errorCode: string
    message: string
  }> = [
    {
      name: 'issuance',
      effect: mocks.requestUploadUrl,
      invoke: () =>
        requestUploadUrl({
          data: {
            portalId: 'portal-p2',
            contentType: 'image/png',
            fileSize: 128,
          },
        }),
      errorCode: 'portal_upload_request_failed',
      message: 'Upload request failed',
    },
    {
      name: 'finalization',
      effect: mocks.finalizeUpload,
      invoke: () =>
        finalizeUpload({
          data: {
            portalId: 'portal-p2',
            uploadId: '70000000-0000-4000-8000-000000000001',
          },
        }),
      errorCode: 'portal_upload_finalization_failed',
      message: 'Upload finalization failed',
    },
  ]

  it.each(uploadFailureCases)(
    'does not copy private provider details into $name failure logs',
    async ({ effect, invoke, errorCode, message }) => {
      const privateDetail = 's3://private-bucket/private/portal-upload/source-key'
      effect.mockRejectedValueOnce(new Error(privateDetail))

      await expect(withStartContext(invoke)).rejects.toMatchObject({
        code: 'upload_failed',
        status: 422,
      })

      expect(mocks.loggerError).toHaveBeenCalledWith({ errorCode }, message)
      expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(privateDetail)
    },
  )
})
