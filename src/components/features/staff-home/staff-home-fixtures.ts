import type { StaffHomeData, StaffHomeFns } from './types'

export const STAFF_HOME_FIXTURE: StaffHomeData = {
  participations: [
    {
      participationId: '11111111-1111-4111-8111-111111111111',
      propertyName: 'Harbor Hotel',
      portalState: 'live',
      noticeAcknowledged: true,
      colleagueListEnabled: false,
    },
  ],
}
export const STAFF_RESULTS_FIXTURE = {
  scans: 47,
  ratingCount: 12,
  averageRating: 4.6,
  ratingsCutoff: '2026-11-01T22:00:00.000Z',
}
export const STAFF_HOME_FNS: StaffHomeFns = {
  getMyStaffHome: async () => STAFF_HOME_FIXTURE,
  getMyCode: async () => ({
    state: 'live',
    qr: 'https://example.com/p/sample',
    wordingKey: 'en',
  }),
  acknowledgeStaffNotice: async () => ({ acknowledged: true }),
  getMyResults: async ({ data }) =>
    data.period === 'today'
      ? { scans: 3 }
      : data.period === 'week'
        ? {
            scans: 11,
            ratingCount: 3,
            ratingsCutoff: STAFF_RESULTS_FIXTURE.ratingsCutoff,
          }
        : STAFF_RESULTS_FIXTURE,
  getMyGoals: async () => ({ goals: [] }),
  getMyColleagues: async () => ({ colleagues: [] }),
  changePassword: async () => undefined,
  submitFeedback: async () => ({ reference: 'staff-report' }),
  listFeedback: async () => [],
}
