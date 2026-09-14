import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'

export type ResponseTargetChipTone =
  'neutral' | 'warning' | 'negative' | 'positive' | 'muted'

export type ResponseTargetChip = Readonly<{
  label: string
  tone: ResponseTargetChipTone
  /** Popover body: the sentence that used to be the target card's description. */
  description: string
  /** Exact due time in the Property timezone, or null. */
  dueLabel: string | null
  timezone: string
}>

type ChipMood = Readonly<{
  label: string
  tone: ResponseTargetChipTone
  description: string
}>

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Under this much time left the chip warns instead of reading as routine. */
const WARNING_WINDOW_MS = 12 * HOUR_MS
/**
 * Targets are set in hours (48 h by default), so hours stay legible across a
 * whole cycle and days only take over once a single day cannot describe it.
 */
const DAYS_THRESHOLD_MS = 2 * DAY_MS

const CANCELLED_DESCRIPTION = 'This cycle is excluded from response-target reporting.'

/** Largest whole unit, always carrying the unit so no bare number is printed. */
function formatDistance(ms: number): string {
  const elapsed = Math.max(0, ms)
  if (elapsed < MINUTE_MS) return 'under a minute'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} m`
  if (elapsed < DAYS_THRESHOLD_MS) return `${Math.floor(elapsed / HOUR_MS)} h`
  return `${Math.floor(elapsed / DAY_MS)} d`
}

function dueLabel(target: ResponseTargetView): string | null {
  if (!target.dueAt) return null
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: target.propertyTimezone,
  }).format(target.dueAt)
}

function chip(target: ResponseTargetView, mood: ChipMood): ResponseTargetChip {
  return {
    ...mood,
    dueLabel: dueLabel(target),
    timezone: target.propertyTimezone,
  }
}

function notMeasuredChip(
  target: ResponseTargetView,
  description: string,
): ResponseTargetChip {
  return chip(target, { label: 'Not measured', tone: 'muted', description })
}

function excludedDescription(target: ResponseTargetView): string {
  if (target.eligibility === 'historical_onboarding') {
    return 'This review was imported as onboarding history, so its earlier response time is not included in target reporting.'
  }
  return target.targetKind === 'google_review_response'
    ? 'Reliable timing is unavailable for this earlier review cycle, so it is not included in target reporting.'
    : 'Reliable timing is unavailable for this earlier feedback cycle, so it is not included in target reporting.'
}

function completedDescription(target: ResponseTargetView, onTime: boolean): string {
  if (target.targetKind === 'google_review_response') {
    return onTime
      ? 'A current response was observed live on Google within the saved target.'
      : 'A current response was observed live on Google after the saved target and remains included in reporting.'
  }
  return onTime
    ? 'The feedback handling cycle was completed within its saved target.'
    : 'The feedback handling cycle was completed and remains included in reporting.'
}

function completedChip(target: ResponseTargetView): ResponseTargetChip {
  const onTime = target.result === 'on_time'
  const verb = target.targetKind === 'private_feedback_handling' ? 'Handled' : 'Replied'
  return chip(target, {
    label: onTime ? `${verb} on time` : `${verb} late`,
    tone: onTime ? 'positive' : 'neutral',
    description: completedDescription(target, onTime),
  })
}

function activeChip(
  target: ResponseTargetView,
  dueAt: Date,
  now: Date,
): ResponseTargetChip {
  const remainingMs = dueAt.getTime() - now.getTime()
  if (target.evaluation.overdue) {
    return chip(target, {
      label: `Overdue by ${formatDistance(-remainingMs)}`,
      tone: 'negative',
      description:
        'The item remains open for follow-up. Escalation is managed separately.',
    })
  }
  // Both prefixes must end in a preposition that governs a duration: `Handle by
  // 6 h` reads as a clock time (six o'clock), the opposite of a countdown.
  const prefix =
    target.targetKind === 'private_feedback_handling' ? 'Handle within' : 'Reply due in'
  return chip(target, {
    label: `${prefix} ${formatDistance(remainingMs)}`,
    tone: remainingMs <= WARNING_WINDOW_MS ? 'warning' : 'neutral',
    description:
      target.targetKind === 'google_review_response'
        ? 'Timing starts from the saved Google publication, meaningful review update, or reopen time for this cycle.'
        : 'Timing starts from the feedback submission or reopen time for this cycle.',
  })
}

/**
 * `now` is a parameter so the chip stays pure: the deadline refresh hook owns
 * the clock and re-renders the strip as a target passes.
 */
export function presentResponseTargetChip(
  target: ResponseTargetView,
  now: Date,
): ResponseTargetChip {
  const { state } = target.evaluation
  if (state === 'excluded') return notMeasuredChip(target, excludedDescription(target))
  if (state === 'cancelled') return notMeasuredChip(target, CANCELLED_DESCRIPTION)
  if (state === 'completed') return completedChip(target)
  // An active cycle always has a due time; a view without one has nothing to
  // count down to, so it reads as unmeasured rather than as a blank countdown.
  if (!target.dueAt) return notMeasuredChip(target, CANCELLED_DESCRIPTION)
  return activeChip(target, target.dueAt, now)
}
