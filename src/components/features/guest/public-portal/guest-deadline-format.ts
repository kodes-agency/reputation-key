import { fillGuestTemplate } from './guest-copy-format'
import type { GuestPortalCopyV2 } from './language-packs/guest-copy-v2'

// Guest-facing deadlines for the v2 copy: "Until 15:32 today, Sofia time".
//
// Everything here is pinned so the server and the browser print the same text
// (React #418): the portal's own IANA zone decides what "today" and "tomorrow"
// mean, the clock is written by hand (24-hour, never a locale's own glue), and
// the caller passes one `now` that travels with the page data instead of each
// side reading its own clock.

const MS_PER_DAY = 86_400_000

export type GuestDeadlineDescription = Readonly<{
  when: 'today' | 'tomorrow' | 'date'
  /** 24-hour clock in the portal zone, `HH:mm`. */
  time: string
  /** The zone's place name, such as `Sofia` for `Europe/Sofia`. */
  zone: string
}>

type ZoneClock = Readonly<{ dayNumber: number; time: string }>

function zoneClock(instant: Date, timeZone: string): ZoneClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value)
  // Some engines write midnight as 24 even with h23; the modulo makes it 0.
  const hour = part('hour') % 24
  return {
    dayNumber: Math.round(
      Date.UTC(part('year'), part('month') - 1, part('day')) / MS_PER_DAY,
    ),
    time: `${String(hour).padStart(2, '0')}:${String(part('minute')).padStart(2, '0')}`,
  }
}

function parseInstant(value: string, label: string): Date {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime()))
    throw new Error(`Invalid ${label} instant: ${value}`)
  return instant
}

function zonePlaceName(timeZone: string): string {
  const last = timeZone.split('/').at(-1) ?? timeZone
  return last.replaceAll('_', ' ')
}

/** Whether the deadline falls today, tomorrow or later, and its clock time, in `timeZone`. */
export function describeGuestDeadline(
  deadlineIso: string,
  nowIso: string,
  timeZone: string,
): GuestDeadlineDescription {
  const deadline = zoneClock(parseInstant(deadlineIso, 'deadline'), timeZone)
  const now = zoneClock(parseInstant(nowIso, 'current'), timeZone)
  const days = deadline.dayNumber - now.dayNumber
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'date'
  return { when, time: deadline.time, zone: zonePlaceName(timeZone) }
}

type DeadlineTemplates = Pick<
  GuestPortalCopyV2['copy'],
  'deadlineToday' | 'deadlineTomorrow' | 'deadlineDate'
>

/**
 * The deadline sentence for one pack. `localeTag` (an `Intl` tag such as
 * `bg-BG`) is used only for the date of a later day, which is the one part
 * that varies by language; the date and the time are joined by the pack's own
 * template, never by the engine.
 */
export function formatGuestDeadline(
  templates: DeadlineTemplates,
  deadlineIso: string,
  nowIso: string,
  timeZone: string,
  localeTag: string,
): string {
  const { when, time, zone } = describeGuestDeadline(deadlineIso, nowIso, timeZone)
  if (when === 'today') return fillGuestTemplate(templates.deadlineToday, { time, zone })
  if (when === 'tomorrow')
    return fillGuestTemplate(templates.deadlineTomorrow, { time, zone })
  const date = new Intl.DateTimeFormat(localeTag, {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(deadlineIso))
  return fillGuestTemplate(templates.deadlineDate, { date, time, zone })
}
