// Leaderboard context — date helpers

import type { LeaderboardPeriod } from '../domain/types'

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = [
  'today',
  'this_week',
  'this_month',
  'this_quarter',
  'all_time',
  'last_7_days',
  'last_30_days',
  'last_90_days',
]

// fallow-ignore-next-line code-duplication — mirrors badge/utils.ts periodToRange by design
export function periodToRange(period: LeaderboardPeriod, now: Date) {
  const end = new Date(now)
  const start = new Date(now)

  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0)
      break
    case 'this_week': {
      const day = start.getDay()
      const diff = day === 0 ? -6 : 1 - day
      start.setDate(start.getDate() + diff)
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'this_month':
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
    case 'this_quarter': {
      const month = start.getMonth()
      start.setMonth(Math.floor(month / 3) * 3, 1)
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'last_7_days':
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      break
    case 'last_30_days':
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      break
    case 'last_90_days':
      start.setDate(start.getDate() - 89)
      start.setHours(0, 0, 0, 0)
      break
    case 'all_time':
      return { start: undefined, end: undefined }
  }

  return { start, end }
}
