// The Monday email, decided (decision 11 of the v3 contract): whether a Property's Guest
// voice summary goes out this Monday, and what it says. The same read the Guest voice page
// is drawn from, worked out for today and for a week ago, so "a quiet week" is a fact
// about the page and not a second opinion about it.
//
//   - A Monday sends when something in the week moved: Fix first changed, an issue is new
//     to Fix first or Watch, or a review was Urgent. A quiet week sends nothing.
//   - The first Monday of a month sends the roundup whatever the week held, because a
//     manager who asked for the email hears from RepKey at least once a month.
//   - A Property whose Guest voice is not the 2.0 page (no v3 analysis), or has too few
//     reviews to spot patterns, sends nothing: there is nothing true to say yet.
//
// The plan reads no word of a review and calls no model. Its output is the three lines of
// "In short" as topics, counts and links (`summaryLines`), and nothing that could carry a
// guest's words out of the app (ADR 0046 r.8; ADR 0031).
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GuestVoiceSummaryFactLine } from '../../domain/events'
import { resolveAiReadGate } from '../ai-read-gate'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsRead,
} from '../ports/ai-guest-voice-facts.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { GuestVoiceV2Ready, Window } from '../read-models/guest-voice-v2'
import { assembleGuestVoiceV2 } from '../read-models/guest-voice-v2-build'
import { joinWindows } from '../read-models/guest-voice-v2-join'
import {
  BASELINE_DAYS,
  choosePopulation,
  type PopulationChoice,
} from '../read-models/guest-voice-v2-population'
import { guestVoiceScopes } from '../read-models/guest-voice-v2-scopes'
import {
  SUMMARY_WEEK_DAYS,
  hasUrgentReviewThisWeek,
  isFirstMondayOfMonth,
  isMonday,
  isQuietWeek,
  summaryLines,
} from '../read-models/guest-voice-v2-summary'

export type GuestVoiceSummaryPlan =
  | Readonly<{
      status: 'send'
      summaryKind: 'weekly' | 'monthly'
      /** The Property-local Monday the summary is for. */
      localDate: string
      window: Window
      startLocalDate: string
      endLocalDate: string
      lines: readonly GuestVoiceSummaryFactLine[]
    }>
  /** A quiet week: nothing moved, so nothing is sent. */
  | Readonly<{ status: 'quiet' }>
  | Readonly<{
      status: 'skipped'
      why:
        | 'disabled'
        | 'preparing'
        | 'not_monday'
        | 'not_v3'
        | 'not_enough_reviews'
        | 'no_lines'
    }>

export type PlanGuestVoiceSummaryDependencies = Readonly<{
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  calendar: AiPropertyCalendarPort
  facts: AiGuestVoiceFactsPort
  reviewSources: Pick<AiReviewSourcePort, 'readTrendPopulation'>
  nowEpochMillis: () => number
}>

export type PlanGuestVoiceSummaryInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** The page as it stood or stands: the reviews of a window and the 12 months before it. */
function readEndingOn(
  input: Readonly<{
    propertyId: string
    choice: PopulationChoice
    facts: GuestVoiceFactsRead
    /** Days before today the read is worked out as of. */
    daysBack: number
    endLocalDate: string
  }>,
): GuestVoiceV2Ready {
  const { choice, facts, daysBack } = input
  const endLocalDate = addDays(input.endLocalDate, -daysBack)
  const window = {
    startLocalDate: addDays(choice.startLocalDate, -daysBack),
    endLocalDate,
  }
  const before = choice.hasBaseline
    ? {
        startLocalDate: addDays(window.startLocalDate, -BASELINE_DAYS),
        endLocalDate: addDays(window.startLocalDate, -1),
      }
    : null
  const { now, earlier, provisional } = joinWindows({
    window,
    before,
    population: choice.reviews,
    facts,
  })
  return assembleGuestVoiceV2({
    propertyId: input.propertyId,
    window: choice.window,
    startLocalDate: window.startLocalDate,
    endLocalDate,
    provisional,
    population: now.population,
    groups: new Map(facts.groups.map((group) => [group.id, group])),
    current: now.analysed,
    baseline: earlier?.analysed ?? [],
  }).read
}

export function createPlanGuestVoiceSummary(
  dependencies: PlanGuestVoiceSummaryDependencies,
): (input: PlanGuestVoiceSummaryInput) => Promise<GuestVoiceSummaryPlan> {
  return async (input) => {
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'skipped', why: 'disabled' }

    const endLocalDate = await dependencies.calendar.resolveLocalDate({
      reviewedAtEpochMillis: dependencies.nowEpochMillis(),
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1',
    })
    if (endLocalDate === null) return { status: 'skipped', why: 'preparing' }
    // The sweep asks at the Property's Monday morning; this is the rule it asks under.
    if (!isMonday(endLocalDate)) return { status: 'skipped', why: 'not_monday' }

    const { facts: scope, population: populationScope } = guestVoiceScopes(
      input,
      gate,
      endLocalDate,
    )
    if (!(await dependencies.facts.hasV3Analyses(scope))) {
      return { status: 'skipped', why: 'not_v3' }
    }

    const choice = await choosePopulation(
      dependencies.reviewSources,
      populationScope,
      'auto',
    )
    if (choice === null) return { status: 'skipped', why: 'preparing' }
    if (!choice.enough) return { status: 'skipped', why: 'not_enough_reviews' }

    // One read of the analysis covers today's page and last week's, which starts a
    // week earlier and so needs its 12 months to start a week earlier too.
    const earliest = choice.hasBaseline
      ? addDays(choice.startLocalDate, -(BASELINE_DAYS + SUMMARY_WEEK_DAYS))
      : addDays(choice.startLocalDate, -SUMMARY_WEEK_DAYS)
    const facts = await dependencies.facts.readFacts(scope, {
      startLocalDate: earliest,
      endLocalDate,
    })
    if (facts === null || facts.coverage.settledAnalysisCount === 0) {
      return { status: 'skipped', why: 'preparing' }
    }

    const read = (daysBack: number) =>
      readEndingOn({
        propertyId: input.propertyId,
        choice,
        facts,
        daysBack,
        endLocalDate,
      })
    const now = read(0)
    // A Property too full to read a year before its window cannot be compared with
    // last week, and is never called quiet.
    const before = choice.hasBaseline ? read(SUMMARY_WEEK_DAYS) : null
    const monthly = isFirstMondayOfMonth(endLocalDate)
    const quiet = isQuietWeek({
      now,
      before,
      urgentThisWeek: hasUrgentReviewThisWeek(facts.reviews, endLocalDate),
    })
    if (quiet && !monthly) return { status: 'quiet' }

    const lines = summaryLines(now)
    // A weekly email with nothing to say is not sent; the roundup is, and says so.
    if (lines.length === 0 && !monthly) return { status: 'skipped', why: 'no_lines' }
    return {
      status: 'send',
      summaryKind: monthly ? 'monthly' : 'weekly',
      localDate: endLocalDate,
      window: now.window,
      startLocalDate: now.startLocalDate,
      endLocalDate: now.endLocalDate,
      lines,
    }
  }
}
