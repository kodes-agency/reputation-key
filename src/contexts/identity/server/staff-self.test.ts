import { requireOwnStaffParticipation } from '../application/staff-self-context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { STAFF_NOTICE_VERSION } from '../domain/staff-account'
import {
  getMyStaffHomeHandler as getMyStaffHome,
  getMyCodeHandler as getMyCode,
  acknowledgeStaffNoticeHandler as acknowledgeStaffNotice,
} from './staff-self'
import { requireOwnParticipation, resolveStaffSelfContext } from './staff-self-context'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  find: vi.fn(),
  acknowledge: vi.fn(),
  policy: vi.fn(),
  budget: vi.fn(),
  code: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }))
vi.mock('#/shared/auth/staff-resolver', () => ({ resolveStaff: mocks.resolve }))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      staffSelf: { find: mocks.find, acknowledge: mocks.acknowledge },
    },
    rateLimiter: { check: mocks.budget },
    portalPublicApi: { management: { getOwnPersonalCode: mocks.code } },
  }),
}))
const participationId = '11111111-1111-4111-8111-111111111111'
const own = {
  participationId,
  propertyId: 'property',
  portalId: 'portal',
  propertyName: 'Harbor',
  propertyActive: true,
  portalState: 'live' as const,
  colleagueListEnabled: false,
  timezone: 'Europe/Sofia',
  countryCode: 'BG',
  groupId: null,
}
const person = {
  linkId: 'link',
  participantId: 'person',
  noticeVersion: STAFF_NOTICE_VERSION,
  participations: [own],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolve.mockResolvedValue(buildTestAuthContext({ role: 'Member' }))
  mocks.find.mockResolvedValue(person)
  mocks.budget.mockResolvedValue({ allowed: true })
  mocks.code.mockResolvedValue({
    state: 'live',
    qr: 'HTTPS://PRINT.EXAMPLE/p/QR',
    wordingKey: 'en',
    direct: 'SECRET',
    nfc: 'SECRET',
  })
})

describe('staff self server boundary', () => {
  it('returns only the home allowlist', async () => {
    const result = await withStartContext(() => getMyStaffHome())
    expect(result).toEqual({
      participations: [
        {
          participationId,
          propertyName: 'Harbor',
          portalState: 'live',
          noticeAcknowledged: true,
          colleagueListEnabled: false,
        },
      ],
    })
  })
  it('refuses no link and a person with no personal participations', async () => {
    mocks.find.mockResolvedValue(null)
    await expect(resolveStaffSelfContext(new Headers())).rejects.toMatchObject({
      code: 'forbidden',
    })
    mocks.find.mockResolvedValue({ ...person, participations: [] })
    await expect(resolveStaffSelfContext(new Headers())).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
  it('admits a manager who also has an active link', async () => {
    mocks.resolve.mockResolvedValue(buildTestAuthContext({ role: 'AccountAdmin' }))
    expect((await resolveStaffSelfContext(new Headers())).person.linkId).toBe('link')
  })
  it('cannot select somebody else by participation id', () => {
    expect(requireOwnStaffParticipation(person, participationId)).toEqual(own)
    expect(() => requireOwnStaffParticipation(person, 'other')).toThrow(
      'Choose one of your own staff Properties',
    )
    expect(() => requireOwnParticipation(person, 'another-person')).toThrow(
      'Choose one of your own staff Properties',
    )
  })
  it('returns the QR allowlist and uses only the separate per-user budget', async () => {
    const code = await withStartContext(() => getMyCode({ data: { participationId } }))
    expect(code).toEqual({
      state: 'live',
      qr: 'HTTPS://PRINT.EXAMPLE/p/QR',
      wordingKey: 'en',
    })
    expect(mocks.budget).toHaveBeenCalledTimes(1)
    expect(mocks.budget).toHaveBeenCalledWith(expect.stringMatching(/^staff:own-code:/), {
      maxRequests: 120,
      windowSeconds: 3600,
    })
  })
  it('returns only paused for an inactive Property', async () => {
    mocks.find.mockResolvedValue({
      ...person,
      participations: [{ ...own, propertyActive: false }],
    })
    expect(
      await withStartContext(() => getMyCode({ data: { participationId } })),
    ).toEqual({ state: 'paused' })
    expect(mocks.code).not.toHaveBeenCalled()
  })
  it('acknowledges only the served notice version', async () => {
    expect(
      await withStartContext(() =>
        acknowledgeStaffNotice({ data: { version: STAFF_NOTICE_VERSION } }),
      ),
    ).toEqual({ acknowledged: true })
    await expect(
      withStartContext(() => acknowledgeStaffNotice({ data: { version: 'older' } })),
    ).rejects.toMatchObject({ code: 'notice_version_changed' })
  })
})
