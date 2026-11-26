import { addLocalDays } from '#/shared/domain/local-days'

/**
 * Property-local date arithmetic on `YYYY-MM-DD` strings.
 *
 * The AI aggregate tables are keyed by the property's LOCAL date, resolved
 * through the property calendar profile, never by a UTC instant. The shared
 * UTC-midnight arithmetic has no zone or DST; this wrapper throws on anything
 * malformed or impossible rather than silently rolling over.
 */
export function addDays(localDate: string, delta: number): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(localDate) || !Number.isSafeInteger(delta)) {
    throw new TypeError('invalid property-local date arithmetic input')
  }
  if (addLocalDays(localDate, 0) !== localDate) {
    throw new TypeError('invalid property-local date')
  }
  return addLocalDays(localDate, delta)
}
