// Coordinate markers of structured-marker-detectors-v1.
//
// A pair of decimal degrees locates a place as exactly as an address does, and
// a guest writes it in many ways: `42.6977, 23.3219`, `42.6977; 23.3219`,
// `42.6977 23.3219`, `N 42.6977 E 23.3219`, `lat 42.6977 lon 23.3219`,
// `lat=42.6977,lng=23.3219`, `42.6977°, 23.3219°`, `42,6977; 23,3219`. Main
// removed most of them only because its bare-domain rule took every decimal
// number; that rule is gone (`4.5` is a rating), so the pair is read on purpose.
//
// A pair is two decimals of at least three digits after a dot (four after a
// comma, which is also the thousands mark), separated by a comma, a semicolon
// or blanks, each within the range of a latitude or a longitude. A label or a
// hemisphere letter next to a number belongs to the pair. A number that is part
// of a longer one (`1.42.6977`, `42.6977.5`) is not a coordinate.

export type CoordinateMarkerSpan = Readonly<{ start: number; end: number }>

/*
 * Candidate repetitions are bounded by the profile ({1,3}, {3,8}) and the input
 * is capped at 65,536 scalars before any pattern runs; the security rule cannot
 * model that.
 */
/* eslint-disable security/detect-unsafe-regex */
const COORDINATE_RE =
  /(?:^|[^\p{N}.+-]|(?<=\p{L})\.)((?:(?<![\p{L}\p{N}])(?:lat(?:itude)?|[NS])(?![\p{L}])[ \t]*[:=]?[ \t]*)?[+-]?\d{1,3}(?:\.\d{3,8}|,\d{4,8})[°º]?(?:[ \t]*[NS](?![\p{L}]))?(?:[ \t]*[,;][ \t]*|[ \t]+)(?:(?:lon(?:g(?:itude)?)?|lng|[EW])(?![\p{L}])[ \t]*[:=]?[ \t]*)?[+-]?\d{1,3}(?:\.\d{3,8}|,\d{4,8})[°º]?(?:[ \t]*[EW](?![\p{L}]))?)(?=$|\.(?!\p{N})|[^\p{N}.])/giu
/* eslint-enable security/detect-unsafe-regex */
const NUMBER_RE = /[+-]?\d{1,3}[.,]\d{3,8}/gu

const MAX_LATITUDE = 90n
const MAX_LONGITUDE = 180n

/** Whether `value`, a signed decimal, is no larger in magnitude than `maximum`. */
function decimalMagnitudeWithin(value: string, maximum: bigint): boolean {
  const unsigned = value.startsWith('+') || value.startsWith('-') ? value.slice(1) : value
  const [whole, fraction] = unsigned.split('.')
  if (
    whole === undefined ||
    fraction === undefined ||
    !/^\d+$/u.test(whole) ||
    !/^\d+$/u.test(fraction)
  ) {
    return false
  }
  const scale = 10n ** BigInt(fraction.length)
  const numerator = BigInt(whole) * scale + BigInt(fraction)
  return numerator <= maximum * scale
}

/** A pair is a latitude and a longitude in either order. */
function isCoordinatePair(first: string, second: string): boolean {
  const within = (value: string, maximum: bigint): boolean =>
    decimalMagnitudeWithin(value.replace(',', '.'), maximum)
  return (
    (within(first, MAX_LATITUDE) && within(second, MAX_LONGITUDE)) ||
    (within(first, MAX_LONGITUDE) && within(second, MAX_LATITUDE))
  )
}

/** Every coordinate pair of `text`, with the labels written next to it. */
export function findCoordinateMarkers(text: string): readonly CoordinateMarkerSpan[] {
  const spans: CoordinateMarkerSpan[] = []
  for (const match of text.matchAll(COORDINATE_RE)) {
    const value = match[1]
    if (value === undefined) continue
    const numbers = value.match(NUMBER_RE)
    const [first, second] = numbers ?? []
    if (numbers?.length !== 2 || first === undefined || second === undefined) continue
    if (!isCoordinatePair(first, second)) continue
    const start = match.index + match[0].lastIndexOf(value)
    spans.push({ start, end: start + value.length })
  }
  return spans
}

/** What the detector profile digest records about the coordinate markers. */
export const COORDINATE_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze([
    Object.freeze({
      id: 'coordinate_pair',
      source: COORDINATE_RE.source,
      flags: COORDINATE_RE.flags,
    }),
  ]),
  limits: Object.freeze({ maxLatitude: 90, maxLongitude: 180 }),
})
