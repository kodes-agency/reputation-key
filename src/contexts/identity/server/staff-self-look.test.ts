// The one staff-home fault the server-function harness cannot provoke: the Portal
// look reader rejecting. The home must stay open with the default look.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { STAFF_NOTICE_VERSION } from '../domain/staff-account'
import { getMyStaffHomeHandler } from './staff-self'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  look: vi.fn(),
  capture: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }))
vi.mock('./staff-self-context', () => ({
  resolveStaffSelfContext: mocks.resolve,
  requireOwnParticipation: vi.fn(),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: vi.fn(),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: { management: { getOwnPersonalLook: mocks.look } },
  }),
}))

const participationId = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolve.mockResolvedValue({
    ctx: buildTestAuthContext({ role: 'Member' }),
    person: {
      noticeVersion: STAFF_NOTICE_VERSION,
      participations: [
        {
          participationId,
          portalId: 'portal',
          propertyName: 'Harbor',
          propertyActive: true,
          portalState: 'live',
          colleagueListEnabled: false,
        },
      ],
    },
  })
})

describe('staff home when the Portal look cannot be read', () => {
  it('stays open with the default look and reports the fault', async () => {
    mocks.look.mockRejectedValue(new Error('The look failed to load'))

    const home = await withStartContext(() => getMyStaffHomeHandler())

    expect(home.participations).toEqual([
      expect.objectContaining({
        participationId,
        propertyName: 'Harbor',
        look: expect.objectContaining({
          logo: null,
          hero: null,
          accentColour: '',
          fieldColour: '',
        }),
      }),
    ])
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('does not report a Portal that is not yet the person’s', async () => {
    mocks.look.mockRejectedValue({ code: 'forbidden' })

    const home = await withStartContext(() => getMyStaffHomeHandler())

    expect(home.participations).toHaveLength(1)
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
