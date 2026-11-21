// Coordinate markers of structured-marker-detectors-v1.
//
// A pair of coordinates locates a place as exactly as an address does, and a
// guest writes it in many ways. Main removed most of them only because its
// bare-domain rule took every decimal number; that rule is gone (`4.5` is a
// rating), so the pairs are read on purpose:
//
// - DECIMAL DEGREES: `42.6977, 23.3219`, `42.6977; 23.3219`, `42.6977 23.3219`,
//   `42.6977/23.3219`, `42.6977 | 23.3219`, `42.6977 x 23.3219`, `42.6977 - 23.3219`,
//   `N 42.6977 E 23.3219`, `42.6977°N/23.3219°E`, `lat 42.6977 lon 23.3219`,
//   `lat=42.6977&lon=23.3219`, `lat 42.6977 and long 23.3219`, `42.6977 (lat)
//   23.3219 (lon)`, `42,6977; 23,3219`. Three decimals after a dot, four after a
//   comma (also the thousands mark), each within the range of a latitude or a
//   longitude. Fewer decimals (`42.69, 23.32`, `42.6, 23.3`) count when a label,
//   a hemisphere letter or a degree sign says so or the pair is written the way a
//   latitude is (two digits before the point): `Scores 8.5, 9.0` and `FX 1,0850
//   1,0920` are not coordinates.
// - ISO 6709: `+42.6977+023.3219/`.
// - DEGREES, MINUTES, SECONDS or decimal minutes: `42°41'52.7"N 23°19'19.2"E`,
//   `N 42° 41.862' E 23° 19.320'`.
// - NMEA: `4269.77N 2319.32E`.
//
// A number that is part of a longer one (`1.42.6977`, `42.6977.5`) is not a
// coordinate.

export type CoordinateMarkerSpan = Readonly<{ start: number; end: number }>

/*
 * Candidate repetitions are bounded by the profile ({1,3}, {1,8}, {1,6}) and the
 * input is capped at 65,536 scalars before any pattern runs; the security rule
 * cannot model that.
 */
/* eslint-disable security/detect-unsafe-regex */
const DECIMAL_PAIR_RE =
  /(?:^|[^\p{N}.+-]|(?<=\p{L})\.)((?:(?<![\p{L}\p{N}])(?:lat(?:itude)?|[NS])\.?(?![\p{L}])[ \t]*[:=]?[ \t]*)?[+-]?\d{1,3}(?:\.\d{1,8}|,\d{1,8})(?:[°º])?(?:[ \t]*\((?:lat|lon|long|lng|[NSEW])\))?(?:[ \t]*[NS](?![\p{L}]))?(?:[ \t]*,[ \t]*(?:and|then)(?![\p{L}])|[ \t]+(?:and|then)(?![\p{L}])|[ \t]*[,;/|&]|[ \t]*[-–—x×](?=[ \t\d+-])|[ \t]+|(?=[+-]))[ \t]*(?:(?:lon(?:g(?:itude)?)?\.?|lng|[EW]\.?)(?![\p{L}])[ \t]*[:=]?[ \t]*)?[+-]?\d{1,3}(?:\.\d{1,8}|,\d{1,8})(?:[°º])?(?:[ \t]*\((?:lat|lon|long|lng|[NSEW])\))?(?:[ \t]*[EW](?![\p{L}]))?)(?=$|\.(?!\p{N})|[^\p{N}.])/giu
const ISO_6709_RE =
  /(?<![\p{N}.+-])([+-]\d{2,3}\.\d{3,8}[+-]\d{2,3}\.\d{3,8})(?:\/|(?=$|[^\p{N}.]))/gu
const DEGREE_MINUTES_RE =
  /(?<![\p{L}\p{N}.])((?:[NS][ \t]*)?\d{1,3}[ \t]*°[ \t]*\d{1,2}(?:\.\d{1,6})?[ \t]*['′][ \t]*(?:\d{1,2}(?:\.\d{1,6})?[ \t]*(?:"|″|''|′′)[ \t]*)?[NS]?(?:[ \t]*[,;/|-][ \t]*|[ \t]+)(?:[EW][ \t]*)?\d{1,3}[ \t]*°[ \t]*\d{1,2}(?:\.\d{1,6})?[ \t]*['′][ \t]*(?:\d{1,2}(?:\.\d{1,6})?[ \t]*(?:"|″|''|′′)[ \t]*)?[EW]?)(?![\p{L}\p{N}])/giu
const NMEA_RE =
  /(?<![\p{N}.])(\d{4}\.\d{2,6}[NS][ \t]*[,;]?[ \t]*\d{4,5}\.\d{2,6}[EW])(?![\p{L}\p{N}])/giu
const NUMBER_RE = /[+-]?\d{1,3}(?:\.\d{1,8}|,\d{1,8})/gu
const DEGREES_AND_MINUTES_RE = /(\d{1,3})[ \t]*°[ \t]*(\d{1,2}(?:\.\d{1,6})?)/gu
const CONTEXT_LABEL_RE =
  /(?:^|[^\p{L}])(?:gps|pin|coords?|coordinates|lat(?:itude)?|lon(?:g(?:itude)?)?|lng|location|loc|map|maps)(?:[ \t]+(?:is|at|are))?[ \t]*[:=-]?[ \t]*$/iu
/** A degree sign, a hemisphere letter or a latitude or longitude label inside the pair. */
const HEMISPHERE_OR_LABEL_RE =
  /[°º]|\([a-z]+\)|(?<![\p{L}])(?:[NSEW]|lat|lon|long|lng)\.?(?![\p{L}])/iu
/* eslint-enable security/detect-unsafe-regex */
const CONTEXT_LOOKBEHIND_SCALARS = 24
const MIN_DOT_DECIMALS = 3
const MIN_COMMA_DECIMALS = 4

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

function decimalsOf(value: string): number {
  return value.length - value.search(/[.,]/u) - 1
}

function integerDigitsOf(value: string): number {
  return value.replace(/^[+-]/u, '').search(/[.,]/u)
}

/** Whether a number has the precision of a coordinate: three decimals after a dot, four after a comma. */
function isPrecise(value: string): boolean {
  return (
    decimalsOf(value) >= (value.includes(',') ? MIN_COMMA_DECIMALS : MIN_DOT_DECIMALS)
  )
}

/**
 * A pair of precise numbers is a coordinate pair, unless it uses a comma and
 * both numbers lie below ten (`1,0850 1,0920`, an exchange rate). A pair with
 * fewer decimals needs a sign that it is one: a degree sign, a hemisphere letter
 * or a label inside it, or a word in front (`GPS`, `Pin:`, `coordinates`).
 * `Prices were 12.50, 14.75` and `Scores 8.5, 9.0` are not coordinates.
 */
function readsAsCoordinates(
  numbers: readonly [string, string],
  signed: boolean,
  context: boolean,
): boolean {
  const [first, second] = numbers
  if (signed || context) return true
  if (!isPrecise(first) || !isPrecise(second)) return false
  const commas = `${first}${second}`.includes(',')
  return !commas || integerDigitsOf(first) >= 2 || integerDigitsOf(second) >= 2
}

function contextBefore(text: string, start: number): boolean {
  return CONTEXT_LABEL_RE.test(
    text.slice(Math.max(0, start - CONTEXT_LOOKBEHIND_SCALARS), start),
  )
}

function findDecimalPairs(text: string): readonly CoordinateMarkerSpan[] {
  const spans: CoordinateMarkerSpan[] = []
  for (const match of text.matchAll(DECIMAL_PAIR_RE)) {
    const value = match[1]
    if (value === undefined) continue
    const numbers = value.match(NUMBER_RE)
    const [first, second] = numbers ?? []
    if (numbers?.length !== 2 || first === undefined || second === undefined) continue
    if (!isCoordinatePair(first, second)) continue
    const start = match.index + match[0].lastIndexOf(value)
    const signed = HEMISPHERE_OR_LABEL_RE.test(value)
    if (readsAsCoordinates([first, second], signed, contextBefore(text, start))) {
      spans.push({ start, end: start + value.length })
    }
  }
  return spans
}

/** Whether a degrees, minutes (and seconds) pair has a latitude and a longitude in range. */
function degreesWithinRange(value: string): boolean {
  const parts = [...value.matchAll(DEGREES_AND_MINUTES_RE)]
  const [lat, lon] = parts
  if (parts.length !== 2 || lat === undefined || lon === undefined) return false
  const within = (part: RegExpMatchArray, maximum: number): boolean =>
    Number(part[1]) <= maximum && Number(part[2]) < 60
  return (within(lat, 90) && within(lon, 180)) || (within(lat, 180) && within(lon, 90))
}

function findDegreeMinutes(text: string): readonly CoordinateMarkerSpan[] {
  const spans: CoordinateMarkerSpan[] = []
  for (const match of text.matchAll(DEGREE_MINUTES_RE)) {
    const value = match[1]
    if (value === undefined || !degreesWithinRange(value)) continue
    spans.push({ start: match.index, end: match.index + value.length })
  }
  return spans
}

function findIsoAndNmea(text: string): readonly CoordinateMarkerSpan[] {
  const spans: CoordinateMarkerSpan[] = []
  for (const match of text.matchAll(ISO_6709_RE)) {
    const numbers = match[1]?.match(/[+-]\d{2,3}\.\d{3,8}/gu)
    const [first, second] = numbers ?? []
    if (first === undefined || second === undefined || !isCoordinatePair(first, second)) {
      continue
    }
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  for (const match of text.matchAll(NMEA_RE)) {
    spans.push({ start: match.index, end: match.index + (match[1] ?? '').length })
  }
  return spans
}

/** Every coordinate pair of `text`, with the labels written next to it. */
export function findCoordinateMarkers(text: string): readonly CoordinateMarkerSpan[] {
  return [findDecimalPairs, findDegreeMinutes, findIsoAndNmea].flatMap((find) =>
    find(text),
  )
}

/** What the detector profile digest records about the coordinate markers. */
export const COORDINATE_MARKER_PROFILE = Object.freeze({
  patterns: Object.freeze(
    (
      [
        ['coordinate_pair', DECIMAL_PAIR_RE],
        ['coordinate_iso_6709', ISO_6709_RE],
        ['coordinate_degree_minutes', DEGREE_MINUTES_RE],
        ['coordinate_nmea', NMEA_RE],
        ['coordinate_context_label', CONTEXT_LABEL_RE],
        ['coordinate_hemisphere_or_label', HEMISPHERE_OR_LABEL_RE],
      ] as const
    ).map(([id, expression]) =>
      Object.freeze({ id, source: expression.source, flags: expression.flags }),
    ),
  ),
  limits: Object.freeze({
    maxLatitude: 90,
    maxLongitude: 180,
    minDotDecimals: MIN_DOT_DECIMALS,
    minCommaDecimals: MIN_COMMA_DECIMALS,
    contextLookbehindScalars: CONTEXT_LOOKBEHIND_SCALARS,
  }),
})
