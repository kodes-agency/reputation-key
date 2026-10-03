// Three pages a role cannot open used to bounce the reader somewhere else without
// a word (Property AI, Property Targets and Review & publish). They answer in the
// app shell now, like every other role refusal (plan decision 9): the cause, the
// page's name, and a way back that is the page the reader can use.
import { describe, expect, it, vi } from 'vitest'

// The controlled-feature gate is a server function with its own tests; here the
// feature is on, so only the role check is left to answer.
vi.mock('#/shared/auth/controlled-route-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/auth/controlled-route-gate')>()),
  gateControlledRoute: vi.fn(async () => undefined),
}))

import { Route as AiRoute } from './settings/ai'
import { Route as TargetsRoute } from './settings/targets'
import { Route as ReviewRoute } from './portals/$portalId/review'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const PORTAL_ID = '20000000-0000-4000-8000-000000000002'
const PARAMS = { propertyId: PROPERTY_ID, portalId: PORTAL_ID }

type Gate = (args: never) => unknown

async function refusal(beforeLoad: Gate | undefined, role: string): Promise<unknown> {
  if (!beforeLoad) throw new Error('The route must define beforeLoad')
  try {
    await beforeLoad({ context: { role }, params: PARAMS } as never)
  } catch (error) {
    return error
  }
  return null
}

describe('role refusals answer in the shell with a way back', () => {
  it('Property AI, for a role without ai.manage', async () => {
    expect(await refusal(AiRoute.options.beforeLoad as Gate, 'Member')).toMatchObject({
      routeId: '/_authenticated',
      data: {
        cause: 'role',
        title: 'AI settings',
        back: 'propertySettings',
      },
    })
  })

  it('Property Targets, for a role without organization.update', async () => {
    expect(
      await refusal(TargetsRoute.options.beforeLoad as Gate, 'Member'),
    ).toMatchObject({
      routeId: '/_authenticated',
      data: {
        cause: 'role',
        title: 'Target settings',
        back: 'propertySettings',
      },
    })
  })

  it('lets the roles that hold the permission through', async () => {
    expect(await refusal(AiRoute.options.beforeLoad as Gate, 'AccountAdmin')).toBeNull()
    expect(
      await refusal(TargetsRoute.options.beforeLoad as Gate, 'AccountAdmin'),
    ).toBeNull()
  })

  it('Review & publish, for a role that cannot update the portal, goes back to the portal', async () => {
    expect(await refusal(ReviewRoute.options.beforeLoad as Gate, 'Member')).toMatchObject(
      {
        routeId: '/_authenticated',
        data: {
          cause: 'role',
          title: 'Review and publish',
          // The portal opens on its Page tab, which a reader can see.
          back: 'portal',
        },
      },
    )
    expect(
      await refusal(ReviewRoute.options.beforeLoad as Gate, 'AccountAdmin'),
    ).toBeNull()
  })
})
