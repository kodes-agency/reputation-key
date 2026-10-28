// "Does this scope have a Portal?" for the Inbox's empty private-feedback queue.
// A boolean, read through the Portal public API and narrowed by the execution
// policy as `listPortals` is; a Property the reader may not see is refused, not
// answered "no".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'

const mocks = vi.hoisted(() => ({
  listPortalManagementPropertyIds: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  decide: vi.fn(),
  answers: [] as unknown[],
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(() => ({ decide: mocks.decide })),
}))
// Outside the Start compiler a server function call does not hand its
// handler's answer back to the caller, so the answer is kept here instead.
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      const answer = await handler(...args)
      mocks.answers.push(answer)
      return answer
    },
}))
vi.mock('#/composition', () => ({
  getContainer: vi.fn(() => ({
    clock: () => new Date('2026-10-28T09:00:00.000Z'),
    portalPublicApi: {
      management: {
        listPortalManagementPropertyIds: mocks.listPortalManagementPropertyIds,
      },
    },
  })),
}))

import { getPortalPresence } from './portal-presence'

const ADMIN = {
  userId: 'user-admin-1',
  organizationId: 'org-test-aaaa',
  role: 'AccountAdmin',
} as const
const HARBOR = '60000000-0000-4000-8000-000000000001'
const GARDEN = '60000000-0000-4000-8000-000000000002'
const NO_PORTAL = '60000000-0000-4000-8000-000000000003'

/** What the browser gets back for a question about one Property or the whole organization. */
async function ask(data: { propertyId?: string }): Promise<unknown> {
  await withStartContext(() => getPortalPresence({ data }))
  return mocks.answers.at(-1)
}

describe('getPortalPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.answers.length = 0
    mocks.resolveTenantContext.mockResolvedValue(ADMIN)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.listPortalManagementPropertyIds.mockResolvedValue([HARBOR, GARDEN])
    mocks.decide.mockResolvedValue({ allowed: true })
  })

  it('says a Property has a Portal when it is one of the Properties that hold one', async () => {
    await expect(ask({ propertyId: HARBOR })).resolves.toEqual({ hasPortal: true })
    await expect(ask({ propertyId: NO_PORTAL })).resolves.toEqual({ hasPortal: false })
    expect(mocks.listPortalManagementPropertyIds).toHaveBeenCalledWith(
      ADMIN.organizationId,
    )
  })

  it('says the organization has one when any Property the reader may see holds one', async () => {
    await expect(ask({})).resolves.toEqual({ hasPortal: true })

    mocks.listPortalManagementPropertyIds.mockResolvedValue([])
    await expect(ask({})).resolves.toEqual({ hasPortal: false })
  })

  it('counts only the Properties the execution policy lets the reader see', async () => {
    mocks.decide.mockImplementation(async ({ propertyId }: { propertyId: string }) => ({
      allowed: propertyId === GARDEN,
    }))

    await expect(ask({})).resolves.toEqual({ hasPortal: true })
    mocks.listPortalManagementPropertyIds.mockResolvedValue([HARBOR])
    await expect(ask({})).resolves.toEqual({ hasPortal: false })
  })

  it('asks the policy about portal.read on the Property it was given, and refuses what it refuses', async () => {
    await ask({ propertyId: HARBOR })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: ADMIN,
      action: 'portal.read',
      capability: 'portal.read',
      propertyId: HARBOR,
    })

    mocks.requireExecutionAllowed.mockRejectedValue(new Error('portal.read refused'))
    await expect(ask({ propertyId: HARBOR })).rejects.toThrow('portal.read refused')
    expect(mocks.answers).toHaveLength(1)
  })

  it('asks the policy about no one Property when the whole organization is asked', async () => {
    await ask({})

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})
