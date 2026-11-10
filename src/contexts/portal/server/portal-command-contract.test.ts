import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { policyDenial } from '#/shared/testing/policy-denial'
import { getRequestContext } from '#/shared/observability/request-context'
import { portalError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers()),
  tenant: vi.fn(),
  policy: vi.fn(),
  scope: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  publish: vi.fn(),
  disable: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  slug: vi.fn(),
  languages: vi.fn(),
  span: vi.fn(),
  end: vi.fn(),
}))

vi.mock('#/shared/auth/headers', () => ({ headersFromContext: mocks.headers }))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.tenant }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: {
      management: {
        resolvePortalManagementScope: mocks.scope,
        getPortal: mocks.read,
        updatePortalSettings: mocks.write,
        publishPortal: mocks.publish,
        disablePortal: mocks.disable,
        archivePortal: mocks.archive,
        restorePortal: mocks.restore,
        changePortalSlug: mocks.slug,
        changePortalLanguages: mocks.languages,
      },
    },
  }),
}))
vi.mock('#/shared/observability/trace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/observability/trace')>()),
  startRequestSpan: mocks.span,
}))

import {
  archivePortal,
  changePortalLanguages,
  changePortalSlug,
  disablePortal,
  getPortal,
  publishPortal,
  restorePortal,
  updatePortalSettings,
} from './portals'

const actor = { userId: 'user-1', organizationId: 'org-1', role: 'AccountAdmin' } as const
const input = { portalId: 'portal-1' }

describe.each([
  {
    name: 'portal.getPortal',
    method: 'GET',
    action: 'portal.read',
    capability: 'portal.read',
    input,
    effect: mocks.read,
    invoke: () => getPortal({ data: input }),
  },
  {
    name: 'portal.updatePortalSettings',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input,
    effect: mocks.write,
    invoke: () => updatePortalSettings({ data: input }),
  },
  {
    name: 'portal.publishPortal',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input: { ...input, reviewedDigest: 'reviewed-digest' },
    effect: mocks.publish,
    invoke: () =>
      publishPortal({ data: { ...input, reviewedDigest: 'reviewed-digest' } }),
  },
  {
    name: 'portal.disablePortal',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input,
    effect: mocks.disable,
    invoke: () => disablePortal({ data: input }),
  },
  {
    name: 'portal.archivePortal',
    method: 'POST',
    action: 'portal.delete',
    capability: 'portal.write',
    input,
    effect: mocks.archive,
    invoke: () => archivePortal({ data: input }),
  },
  {
    name: 'portal.restorePortal',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input,
    effect: mocks.restore,
    invoke: () => restorePortal({ data: input }),
  },
  {
    name: 'portal.changePortalSlug',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input: { ...input, slug: 'new-slug' },
    effect: mocks.slug,
    invoke: () => changePortalSlug({ data: { ...input, slug: 'new-slug' } }),
  },
  {
    name: 'portal.changePortalLanguages',
    method: 'POST',
    action: 'portal.update',
    capability: 'portal.write',
    input: { ...input, primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] },
    effect: mocks.languages,
    invoke: () =>
      changePortalLanguages({
        data: { ...input, primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] },
      }),
  },
])(
  '$name command contract',
  ({ name, method, action, capability, input, effect, invoke }) => {
    beforeEach(() => {
      vi.clearAllMocks()
      mocks.tenant.mockResolvedValue(actor)
      mocks.policy.mockResolvedValue(undefined)
      mocks.scope.mockResolvedValue({ organizationId: 'org-1', propertyId: 'property-1' })
      mocks.span.mockReturnValue({ end: mocks.end })
      effect.mockResolvedValue({ portal: {}, tokenStatus: null })
    })

    it.each(['property-1', 'property-2'])(
      'authorizes the Portal in %s within one named request trace',
      async (propertyId) => {
        mocks.scope.mockResolvedValue({
          organizationId: actor.organizationId,
          propertyId,
        })
        effect.mockImplementation(async () => {
          const request = getRequestContext()
          expect(request?.spanAttrs.useCase).toBe(name)
          expect(request?.commandId).toBe(request?.requestId)
          return { portal: {}, tokenStatus: null }
        })

        await withStartContext(invoke)

        expect(mocks.headers).toHaveBeenCalledTimes(1)
        expect(mocks.tenant).toHaveBeenCalledTimes(1)
        expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(input.portalId)
        expect(mocks.policy).toHaveBeenCalledExactlyOnceWith({
          actor,
          action,
          capability,
          propertyId,
        })
        expect(effect).toHaveBeenCalledExactlyOnceWith(input, actor)
        expect(mocks.tenant.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.scope.mock.invocationCallOrder[0]!,
        )
        expect(mocks.scope.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.policy.mock.invocationCallOrder[0]!,
        )
        expect(mocks.policy.mock.invocationCallOrder[0]).toBeLessThan(
          effect.mock.invocationCallOrder[0]!,
        )
        expect(mocks.span).toHaveBeenCalledExactlyOnceWith(
          expect.any(String),
          method,
          name,
        )
        expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
      },
    )

    it.each([null, { organizationId: 'other-org', propertyId: 'other-property' }])(
      'keeps an inaccessible Portal indistinguishable from a missing Portal (%j)',
      async (scope) => {
        mocks.scope.mockResolvedValue(scope)
        await expect(withStartContext(invoke)).rejects.toMatchObject({
          name: 'PortalError',
          code: 'portal_not_found',
          status: 404,
        })
        expect(mocks.scope).toHaveBeenCalledExactlyOnceWith(input.portalId)
        expect(mocks.policy).not.toHaveBeenCalled()
        expect(effect).not.toHaveBeenCalled()
      },
    )

    it('preserves a tagged policy refusal without running the use case', async () => {
      const denied = policyDenial('scope_denied')
      mocks.policy.mockRejectedValue(denied)
      await expect(withStartContext(invoke)).rejects.toBe(denied)
      expect(effect).not.toHaveBeenCalled()
      expect(mocks.end).toHaveBeenCalledExactlyOnceWith(denied)
    })

    it('keeps domain errors and unexpected failures safe on the wire', async () => {
      effect.mockRejectedValueOnce(portalError('revision_conflict', 'Please reload'))
      await expect(withStartContext(invoke)).rejects.toMatchObject({
        name: 'PortalError',
        code: 'revision_conflict',
        status: 409,
        message: 'Please reload',
      })
      effect.mockRejectedValueOnce(new Error('private database detail'))
      await expect(withStartContext(invoke)).rejects.toMatchObject({
        name: 'InternalError',
        code: 'internal_error',
        status: 500,
        message: 'Internal server error',
      })
    })
  },
)
