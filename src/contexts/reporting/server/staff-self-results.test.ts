import { setResponseHeader } from '@tanstack/react-start/server'
import { resetEnv } from '#/shared/config/env'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import {
  getMyResultsHandler as getMyResults,
  getMyGoalsHandler as getMyGoals,
  getMyColleaguesHandler as getMyColleagues,
} from './staff-self-results'
import { resolveStaffSelfContext } from './staff-self-context'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  find: vi.fn(),
  policy: vi.fn(),
  results: vi.fn(),
  goals: vi.fn(),
  colleagues: vi.fn(),
  scans: vi.fn(),
  targetsEnabled: true,
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
    identityPublicApi: { staffSelf: { find: mocks.find, colleagues: mocks.colleagues } },
    dashboardPublicApi: {
      staffSelf: {
        targetsEnabled: mocks.targetsEnabled,
        results: mocks.results,
        goals: mocks.goals,
        scans: mocks.scans,
      },
    },
  }),
}))
const participationId = '11111111-1111-4111-8111-111111111111'
const own = {
  participationId,
  propertyId: 'property',
  portalId: 'personal',
  propertyName: 'Harbor',
  propertyActive: true,
  portalState: 'live' as const,
  colleagueListEnabled: true,
  timezone: 'Europe/Sofia',
  countryCode: 'BG',
  groupId: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.targetsEnabled = true
  vi.stubEnv('STAFF_SCAN_TARGETS_ENABLED', 'true')
  resetEnv()
  mocks.resolve.mockResolvedValue(buildTestAuthContext({ role: 'Member' }))
  mocks.find.mockResolvedValue({
    linkId: 'link',
    participantId: 'you',
    noticeVersion: null,
    participations: [own],
  })
  mocks.results.mockResolvedValue({
    scans: 4,
    ratingCount: 2,
    ratingsCutoff: '2026-11-01T22:00:00Z',
    google: 99,
    privateNotes: 'secret',
  })
  mocks.goals.mockResolvedValue([
    { id: 'goal', name: 'Scans', target: 20, scans: 4, google: 99 },
  ])
  mocks.colleagues.mockResolvedValue([
    { participantId: 'alex', displayName: 'Alex', portalId: 'other' },
    { participantId: 'you', displayName: 'Polly', portalId: 'personal' },
  ])
  mocks.scans.mockResolvedValue(
    new Map([
      ['personal', 4],
      ['other', 0],
    ]),
  )
})

describe('staff results DTO allowlists', () => {
  it('uses the same session-owned participation and hides every unapproved field', async () => {
    expect(
      (await resolveStaffSelfContext(new Headers())).person.participations[0]?.portalId,
    ).toBe('personal')
    expect(
      await withStartContext(() =>
        getMyResults({ data: { participationId, period: 'week' } }),
      ),
    ).toEqual({ scans: 4, ratingCount: 2, ratingsCutoff: '2026-11-01T22:00:00Z' })
    expect(
      await withStartContext(() =>
        getMyResults({ data: { participationId, period: 'today' } }),
      ),
    ).toEqual({ scans: 4 })
  })
  it('cannot name another participation', async () => {
    await expect(
      withStartContext(() =>
        getMyResults({
          data: {
            participationId: '22222222-2222-4222-8222-222222222222',
            period: 'week',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.results).not.toHaveBeenCalled()
  })
  it('returns only scan-goal fields and nothing while targets are off', async () => {
    expect(
      await withStartContext(() => getMyGoals({ data: { participationId } })),
    ).toEqual({ goals: [{ id: 'goal', name: 'Scans', target: 20, scans: 4 }] })
    mocks.targetsEnabled = false
    vi.stubEnv('STAFF_SCAN_TARGETS_ENABLED', 'false')
    resetEnv()
    expect(
      await withStartContext(() => getMyGoals({ data: { participationId } })),
    ).toEqual({ goals: [] })
    expect(mocks.goals).toHaveBeenCalledTimes(1)
  })
  it('returns the named scan list including zeros through one batch read', async () => {
    expect(
      await withStartContext(() =>
        getMyColleagues({ data: { participationId, period: 'week' } }),
      ),
    ).toEqual({
      colleagues: [
        { displayName: 'Alex', scans: 0, isYou: false },
        { displayName: 'Polly', scans: 4, isYou: true },
      ],
    })
    expect(mocks.scans).toHaveBeenCalledTimes(1)
    expect(mocks.scans.mock.calls[0]?.[1]).toEqual(['other', 'personal'])
  })
  it('refuses colleagues when the setting is off', async () => {
    mocks.find.mockResolvedValue({
      linkId: 'link',
      participantId: 'you',
      noticeVersion: null,
      participations: [{ ...own, colleagueListEnabled: false }],
    })
    await expect(
      withStartContext(() =>
        getMyColleagues({ data: { participationId, period: 'month' } }),
      ),
    ).rejects.toMatchObject({ code: 'colleague_list_disabled' })
    expect(mocks.scans).not.toHaveBeenCalled()
  })
})

it('marks every personal results read private and non-cacheable', async () => {
  await withStartContext(() =>
    getMyResults({ data: { participationId, period: 'month' } }),
  )
  await withStartContext(() => getMyGoals({ data: { participationId } }))
  await withStartContext(() =>
    getMyColleagues({ data: { participationId, period: 'week' } }),
  )
  expect(setResponseHeader).toHaveBeenCalledTimes(3)
  expect(setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
})
