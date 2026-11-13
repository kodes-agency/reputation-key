import { DEFAULT_IMMERSIVE_ACCENT } from '#/components/features/guest/public-portal/immersive/immersive-look'
import type { StaffHomeData, StaffHomeFns } from './types'

export const STAFF_HOME_FIXTURE: StaffHomeData = {
  participations: [
    {
      participationId: '11111111-1111-4111-8111-111111111111',
      propertyName: 'Harbor Hotel',
      look: {
        displayName: 'Harbor Hotel',
        wordmark: 'Harbor',
        accentColour: DEFAULT_IMMERSIVE_ACCENT,
        fieldColour: '',
        logo: null,
        hero: null,
      },
      portalState: 'live',
      noticeAcknowledged: true,
      colleagueListEnabled: false,
    },
  ],
}
const STAFF_MONTH_SERIES = {
  unit: 'week',
  columns: [
    { start: '2026-11-01', scans: 14, open: false },
    { start: '2026-11-02', scans: 19, open: false },
    { start: '2026-11-09', scans: 9, open: false },
    { start: '2026-11-16', scans: 5, open: true },
  ],
} as const
const STAFF_WEEK_SERIES = {
  unit: 'day',
  columns: [
    { start: '2026-11-16', scans: 4, open: false },
    { start: '2026-11-17', scans: 7, open: true },
  ],
} as const
export const STAFF_RESULTS_FIXTURE = {
  scans: 47,
  series: STAFF_MONTH_SERIES,
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
    headline: 'How did we do?',
    subline: 'About 30 seconds',
    cue: 'Scan with your camera',
  }),
  acknowledgeStaffNotice: async () => ({ acknowledged: true }),
  getMyResults: async ({ data }) =>
    data.period === 'today'
      ? { scans: 3, series: null }
      : data.period === 'week'
        ? {
            scans: 11,
            series: STAFF_WEEK_SERIES,
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
