// What a reporter is told about their own report.
//
// Internal triage carries severity, privacy class, security class, owner queue
// and dedupe disposition. None of that is a reporter's business — some of it
// would be actively misleading, and the security classification must not leak
// at all. This maps the two states a reporter can meaningfully act on
// (did it send, and where has it got to) onto plain language.

export type ReporterFeedbackTone = 'pending' | 'active' | 'settled' | 'closed' | 'failed'

export type ReporterFeedbackStatus = Readonly<{
  label: string
  description: string
  tone: ReporterFeedbackTone
}>

type Input = Readonly<{
  deliveryState: 'prepared' | 'delivered' | 'failed'
  triageState: 'new' | 'screened' | 'reproducing' | 'accepted' | 'declined' | 'resolved'
}>

const TRIAGE_STATUS: Readonly<Record<Input['triageState'], ReporterFeedbackStatus>> = {
  new: {
    label: 'Received',
    description: 'It has reached the team and is waiting to be read.',
    tone: 'pending',
  },
  screened: {
    label: 'Read',
    description: 'Someone has read it and is deciding what happens next.',
    tone: 'active',
  },
  reproducing: {
    label: 'Being investigated',
    description: 'The team is trying to reproduce what you described.',
    tone: 'active',
  },
  accepted: {
    label: 'Accepted',
    description: 'This is going to be worked on.',
    tone: 'settled',
  },
  declined: {
    label: 'Not planned',
    description: 'The team decided not to act on this one.',
    tone: 'closed',
  },
  resolved: {
    label: 'Resolved',
    description: 'This has been dealt with.',
    tone: 'settled',
  },
}

const DELIVERY_STATUS: Readonly<Record<'prepared' | 'failed', ReporterFeedbackStatus>> = {
  prepared: {
    label: 'Sending',
    description: 'Still on its way. Refresh in a moment.',
    tone: 'pending',
  },
  failed: {
    label: 'Not sent',
    description: 'This report did not reach the team. Please send it again.',
    tone: 'failed',
  },
}

/** Delivery outranks triage: an undelivered report has no meaningful triage. */
export function reporterFeedbackStatus(input: Input): ReporterFeedbackStatus {
  if (input.deliveryState !== 'delivered') return DELIVERY_STATUS[input.deliveryState]
  return TRIAGE_STATUS[input.triageState]
}

/** Route keys are dotted machine values; show the surface the report came from. */
export function reporterRouteLabel(routeKey: string): string {
  if (routeKey === 'other_authenticated') return 'Elsewhere in RepKey'
  return routeKey
    .split('.')
    .map((part) => part.replaceAll('_', ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' · ')
}

/**
 * The issue tracker this beta files engineering work in. It is public, which is
 * why an issue carries no reporter text (`beta-feedback-issue.ts`) — and also
 * why a reporter can follow the link: there is nothing behind it they are not
 * allowed to see.
 */
const ISSUE_TRACKER_URL = 'https://github.com/kodes-agency/reputation-key/issues'

/**
 * A link only for a plain issue number, which is what `ops feedback-issue`
 * writes. Any other reference an operator recorded by hand stays text, rather
 * than becoming a guessed URL that might point somewhere wrong.
 */
export function issueUrlFor(engineeringIssueRef: string): string | null {
  return /^\d{1,9}$/u.test(engineeringIssueRef)
    ? `${ISSUE_TRACKER_URL}/${engineeringIssueRef}`
    : null
}
