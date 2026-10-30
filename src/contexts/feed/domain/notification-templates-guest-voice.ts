// Feed notification surface — copy for the notices Guest voice raises.
//
// Split out of ./notification-templates.ts, which lists these renderers in its table.
// Named exports, as the account and goal notices are: a spread of an imported record
// moved a whole module's copy into first paint's chunk. This module is a leaf; its copy
// type is restated structurally below.
//
// Every sentence here is written for a notice that must carry no word of a review and no
// word about one (ADR 0046 r.8; ADR 0031): the Urgent alert says that an urgent review
// needs its reader and where, and nothing of why. The reason a model gave is read in the
// app, where the notice opens the review.
import type { NotificationPayload } from './notification-payload'
import type {
  NotificationGuestVoiceLine,
  NotificationGuestVoiceTopic,
  NotificationGuestVoiceWindow,
} from './notification-payload-guest-voice'

/** What a Guest voice renderer returns; assignable to the templates' own copy type. */
type GuestVoiceNoticeCopy = Readonly<{
  title: string
  body: string
  detail?: string
  lines?: readonly string[]
  actionLabel: string
  summary: string
}>

/**
 * The Urgent alert (v3 contract decision 10). The title is the sentence the owner
 * chose, led by the decision and followed by the Property, as every Property notice is
 * (templates rule 3). It names no reason, topic, rating or person, and the body only
 * says to open the review: the app says why it is urgent.
 */
export const renderReviewAiUrgentDetected = (
  p: NotificationPayload,
): GuestVoiceNoticeCopy => ({
  title:
    p.propertyName === undefined
      ? 'An urgent review needs you'
      : `An urgent review needs you at ${p.propertyName}`,
  body: 'Open it to read the review and decide what to do.',
  actionLabel: 'Open review',
  summary:
    p.propertyName === undefined ? 'urgent review' : `${p.propertyName} · urgent review`,
})

/** The twelve topics by their names on the page; pinned to the taxonomy by a test. */
export const GUEST_VOICE_TOPIC_LABELS: Readonly<
  Record<NotificationGuestVoiceTopic, string>
> = {
  staff_service: 'Staff and service',
  speed_waiting: 'Speed and waiting',
  booking_arrival: 'Booking and arrival',
  main_service: 'The main service',
  food_drink: 'Food and drink',
  cleanliness: 'Cleanliness',
  facilities_equipment: 'Facilities and equipment',
  price_billing: 'Price and billing',
  atmosphere_noise: 'Atmosphere and noise',
  location_access: 'Location and access',
  safety: 'Safety',
  communication: 'Communication',
}

const AVERAGE_WORDS: Readonly<Record<NotificationGuestVoiceWindow, string>> = {
  '30d': '30-day',
  '90d': '90-day',
  '180d': '6-month',
  '365d': '12-month',
}

/** "0.2", "0.15", "0.05": the engine rounds to 0.05, so two places at most. */
const starFigure = (hundredths: number): string =>
  (hundredths / 100).toFixed(2).replace(/0$/u, '')

/**
 * "worth up to about 0.2★ on your 90-day average": an association over the Property's own
 * reviews, as the page says it, and never one review's rating.
 */
const worthUpTo = (
  line: NotificationGuestVoiceLine,
  window: NotificationGuestVoiceWindow | undefined,
): string =>
  line.upToHundredths === undefined || line.upToHundredths <= 0
    ? ''
    : `, worth up to about ${starFigure(line.upToHundredths)}★ on your ${
        window === undefined ? '' : `${AVERAGE_WORDS[window]} `
      }average`

/**
 * One of the page's three lines as a sentence, from fixed words. The topic is one of the
 * twelve; the sentence names no cause, because a cause is the guests' words boiled down
 * and those are read in the app (ADR 0046 r.8).
 */
function summaryLine(
  line: NotificationGuestVoiceLine,
  window: NotificationGuestVoiceWindow | undefined,
): string {
  const topic = GUEST_VOICE_TOPIC_LABELS[line.topic]
  const share = `${line.reviewCount} of ${line.textReviewCount}`
  if (line.kind === 'fix_first') {
    return `Fix first: ${topic}, in ${share} reviews${worthUpTo(line, window)}.`
  }
  if (line.kind === 'protect') return `Guests love: ${topic}, in ${share} reviews.`
  const moving = line.change === 'falling' ? 'falling' : 'rising'
  return line.polarity === 'praise'
    ? `Praise for ${topic} is ${moving}.`
    : `${topic} complaints are ${moving}.`
}

/**
 * The Monday email and the roundup of the first Monday of the month (v3 contract decision
 * 11): the page's three lines and a way in. The lines are topics, counts and a window; a
 * month with nothing to name still gets its roundup, and says so.
 */
export const renderGuestVoiceSummary = (p: NotificationPayload): GuestVoiceNoticeCopy => {
  const monthly = p.guestVoiceKind === 'monthly'
  const lines = (p.guestVoiceLines ?? []).map((line) =>
    summaryLine(line, p.guestVoiceWindow),
  )
  const body =
    lines.length === 0 ? 'Nothing stands out. Open it for every topic.' : lines.join(' ')
  return {
    title: `Your Guest voice ${monthly ? 'this month' : 'this week'}${
      p.propertyName === undefined ? '' : ` at ${p.propertyName}`
    }`,
    body,
    detail: body,
    ...(lines.length === 0 ? {} : { lines }),
    actionLabel: 'Open Guest voice',
    summary: `${p.propertyName === undefined ? '' : `${p.propertyName} · `}${
      monthly ? 'monthly roundup' : 'weekly summary'
    }`,
  }
}
