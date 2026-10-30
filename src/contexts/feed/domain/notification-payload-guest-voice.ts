// Feed notification surface — the Guest voice summary's payload (ADR 0046 r.8).
//
// The Monday email and the monthly roundup state the page's three lines as fixed topics,
// counts and a window: nothing the guests wrote and nothing boiled down from it (not the
// issue's name, which is their words in short). Kept apart from ./notification-payload.ts
// so that module stays the list of what a notice may carry in general, and this one the
// shape of one family. The parser drops what it does not recognise, line by line: a
// malformed line shortens the email, it never loses it.

export type NotificationGuestVoiceWindow = '30d' | '90d' | '180d' | '365d'

/**
 * The twelve topics of review analysis v3, as the notice states them. Restated here, as
 * Feed's domain reads no module outside `shared/domain` (the same reason the rating goal
 * notices restate one of Reporting's thresholds); a test pins this list and the labels in
 * ./notification-templates-guest-voice.ts to `review-topic-taxonomy.ts`.
 */
export const NOTIFICATION_GUEST_VOICE_TOPICS = [
  'staff_service',
  'speed_waiting',
  'booking_arrival',
  'main_service',
  'food_drink',
  'cleanliness',
  'facilities_equipment',
  'price_billing',
  'atmosphere_noise',
  'location_access',
  'safety',
  'communication',
] as const

export type NotificationGuestVoiceTopic = (typeof NOTIFICATION_GUEST_VOICE_TOPICS)[number]

/** One of the page's three "In short" lines, as the fact the email states. */
export type NotificationGuestVoiceLine = Readonly<{
  kind: 'fix_first' | 'protect' | 'change'
  topic: NotificationGuestVoiceTopic
  /** Reviews that name it, and reviews with text in the window ("19 of 128"). */
  reviewCount: number
  textReviewCount: number
  /** Stars it may be worth on the window's average, in hundredths (20 is 0.2). */
  upToHundredths?: number
  /** Which way it moved, on a `change` line. */
  change?: 'rising' | 'falling'
  /** Whether the reviews that moved praise it or complain of it, on a `change` line. */
  polarity?: 'complaint' | 'praise'
}>

/** The fields a Guest voice summary notice adds to a payload. */
export type GuestVoiceSummaryPayloadFields = Readonly<{
  /** The Monday email, or the roundup of the first Monday of the month. */
  guestVoiceKind?: 'weekly' | 'monthly'
  /** The window the figures were worked out over. */
  guestVoiceWindow?: NotificationGuestVoiceWindow
  /** At most three lines, in the page's order: fix first, protect, change. */
  guestVoiceLines?: readonly NotificationGuestVoiceLine[]
}>

const MAX_LINES = 3
const MAX_COUNT = 1_000_000
/** 5 stars, in hundredths: the most a problem could be worth on a 5-star scale. */
const MAX_UP_TO_HUNDREDTHS = 500

const KINDS: Readonly<Record<string, true>> = {
  fix_first: true,
  protect: true,
  change: true,
}
const WINDOWS: Readonly<Record<string, true>> = {
  '30d': true,
  '90d': true,
  '180d': true,
  '365d': true,
}
const TOPICS: ReadonlySet<string> = new Set(NOTIFICATION_GUEST_VOICE_TOPICS)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT
    ? value
    : undefined

const oneOf = <T extends string>(
  value: unknown,
  allowed: Readonly<Record<string, true>>,
): T | undefined =>
  typeof value === 'string' && allowed[value] === true ? (value as T) : undefined

function parseLine(value: unknown): NotificationGuestVoiceLine | undefined {
  if (!isRecord(value)) return undefined
  const kind = oneOf<NotificationGuestVoiceLine['kind']>(value.kind, KINDS)
  const topic =
    typeof value.topic === 'string' && TOPICS.has(value.topic)
      ? (value.topic as NotificationGuestVoiceTopic)
      : undefined
  const reviewCount = count(value.reviewCount)
  const textReviewCount = count(value.textReviewCount)
  if (
    kind === undefined ||
    topic === undefined ||
    reviewCount === undefined ||
    textReviewCount === undefined
  ) {
    return undefined
  }
  const upTo = count(value.upToHundredths)
  const change = oneOf<'rising' | 'falling'>(value.change, {
    rising: true,
    falling: true,
  })
  const polarity = oneOf<'complaint' | 'praise'>(value.polarity, {
    complaint: true,
    praise: true,
  })
  return {
    kind,
    topic,
    reviewCount,
    textReviewCount,
    // A figure belongs to the line it is for, so a stray one is dropped.
    ...(kind === 'fix_first' && upTo !== undefined && upTo <= MAX_UP_TO_HUNDREDTHS
      ? { upToHundredths: upTo }
      : {}),
    ...(kind === 'change' && change !== undefined ? { change } : {}),
    ...(kind === 'change' && polarity !== undefined ? { polarity } : {}),
  }
}

/** The Guest voice summary fields of an untrusted payload; unknown input is dropped. */
export function parseGuestVoiceSummaryFields(
  raw: Readonly<Record<string, unknown>>,
): GuestVoiceSummaryPayloadFields {
  const kind = oneOf<'weekly' | 'monthly'>(raw.guestVoiceKind, {
    weekly: true,
    monthly: true,
  })
  const window = oneOf<NotificationGuestVoiceWindow>(raw.guestVoiceWindow, WINDOWS)
  const lines = Array.isArray(raw.guestVoiceLines)
    ? raw.guestVoiceLines
        .slice(0, MAX_LINES)
        .map(parseLine)
        .filter((line): line is NotificationGuestVoiceLine => line !== undefined)
    : undefined
  return {
    ...(kind === undefined ? {} : { guestVoiceKind: kind }),
    ...(window === undefined ? {} : { guestVoiceWindow: window }),
    ...(lines === undefined ? {} : { guestVoiceLines: lines }),
  }
}
