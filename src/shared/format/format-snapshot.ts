import { formatMonthDay, toInstant, type InstantInput } from './format'
/** "1 Oct", with a year for a snapshot outside the current year. Kept in its lazy caller's chunk. */
export function formatSnapshotDate(
  value: InstantInput,
  now: InstantInput,
): string | null {
  const instant = toInstant(value)
  const short = formatMonthDay(instant)
  if (!instant || !short) return null
  const [month, day] = short.split(' ')
  const year = instant.getUTCFullYear()
  return `${day} ${month}${year === toInstant(now)?.getUTCFullYear() ? '' : ` ${year}`}`
}
