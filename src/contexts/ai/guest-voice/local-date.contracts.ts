/**
 * Property-local date arithmetic on `YYYY-MM-DD` strings.
 *
 * The AI aggregate tables are keyed by the property's LOCAL date, resolved
 * through the property calendar profile, never by a UTC instant. This stays
 * string-to-string over the shared local-day arithmetic and throws on anything
 * malformed rather than silently rolling over (`2026-02-30` is not a date).
 */
import { addLocalDays } from '#/shared/domain/local-days'

export function addDays(localDate: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isSafeInteger(delta)) {
    throw new TypeError('invalid property-local date arithmetic input')
  }
  if (addLocalDays(localDate, 0) !== localDate) {
    throw new TypeError('invalid property-local date')
  }
  return addLocalDays(localDate, delta)
}
