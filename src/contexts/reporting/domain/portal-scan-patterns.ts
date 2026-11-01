/** Only this summary leaves Reporting; hourly counts never reach the browser. */
export type PortalScanPatterns = Readonly<{
  channels: Readonly<{ qr: number; nfc: number }>
  busiest: Readonly<{
    slots: ReadonlyArray<Readonly<{ startHour: number; endHour: number }>>
    weekday: number | null
  }> | null
}>
export const BUSIEST_TIMES_MIN_SCANS = 30

type Count = Readonly<{
  channel: 'qr' | 'nfc'
  hour: number
  weekday: number
  scans: number
}>

/** Ties favour the earlier hour/day. The runner-up must not overlap the best slot. */
export function portalScanPatterns(rows: readonly Count[]): PortalScanPatterns {
  const channels = { qr: 0, nfc: 0 }
  const hours = Array<number>(24).fill(0)
  const weekdays = Array<number>(7).fill(0)
  for (const row of rows) {
    channels[row.channel] += row.scans
    hours[row.hour] = (hours[row.hour] ?? 0) + row.scans
    weekdays[row.weekday] = (weekdays[row.weekday] ?? 0) + row.scans
  }
  if (channels.qr + channels.nfc < BUSIEST_TIMES_MIN_SCANS)
    return { channels, busiest: null }
  const candidates = hours
    .map((scans, startHour) => ({
      startHour,
      endHour: (startHour + 2) % 24,
      scans: scans + (hours[(startHour + 1) % 24] ?? 0),
    }))
    .sort((a, b) => b.scans - a.scans || a.startHour - b.startHour)
  const best = candidates[0]!
  const second = candidates.find((slot) => {
    const distance = (slot.startHour - best.startHour + 24) % 24
    return distance >= 2 && distance <= 22 && slot.scans * 5 >= best.scans * 4
  })
  const largestDay = Math.max(...weekdays)
  const weekday =
    largestDay * 7 * 5 >= (channels.qr + channels.nfc) * 6
      ? weekdays.indexOf(largestDay)
      : null
  const slots = [best, ...(second ? [second] : [])]
    .sort((a, b) => a.startHour - b.startHour)
    .map(({ startHour, endHour }) => ({ startHour, endHour }))
  return { channels, busiest: { slots, weekday } }
}
