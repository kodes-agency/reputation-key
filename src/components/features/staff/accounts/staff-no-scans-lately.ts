import { formatDayKey } from '#/lib/format'

/** Calendar days at the Property, including through daylight-saving changes. */
export function staffDaysSince(
  value: Date | string | null | undefined,
  now: Date,
  timeZone: string,
): number | null {
  const day = formatDayKey(value, timeZone)
  const today = formatDayKey(now, timeZone)
  if (!day || !today) return null
  return Math.floor((Date.parse(today) - Date.parse(day)) / 86400000)
}

export function staffNoScansLately(
  input: Readonly<{
    access: string
    joinedAt?: Date | string | null
    lastScanAt?: Date | string | null
    now: Date
    timeZone: string
  }>,
): boolean {
  if (input.access !== 'active') return false
  const joinedDays = staffDaysSince(input.joinedAt, input.now, input.timeZone)
  if (joinedDays === null || joinedDays < 14) return false
  const scanDays = staffDaysSince(input.lastScanAt, input.now, input.timeZone)
  return scanDays === null || scanDays >= 14
}

/** "Today", "Yesterday", "3 days ago"; a clock running behind the scan still reads as today. */
export function staffLastScanWords(days: number | null): string | null {
  if (days === null) return null
  if (days <= 0) return 'Today'
  return days === 1 ? 'Yesterday' : `${days} days ago`
}
