import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../ai-property-read-access'
import { resolveAiReadGate } from '../ai-read-gate'
import { isAiAuthorizationUnderServedContract } from '../ai-workflow-support'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsScope,
} from '../ports/ai-guest-voice-facts.port'
import type { AiPropertyCalendarPort } from '../ports/ai-property-calendar.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import { twelveMonthStart } from './guest-voice-v2-recency'
import { joinPeriod, joinWindows } from './guest-voice-v2-join'
import {
  BASELINE_DAYS,
  choosePopulation,
  type PopulationChoice,
  type PopulationRange,
} from './guest-voice-v2-population'
import { guestVoiceScopes } from './guest-voice-v2-scopes'
import type { GuestVoiceReview } from './guest-voice-v2-facts'
import type { GuestVoiceBuildInput } from './guest-voice-v2-build'

export type GuestVoiceReadDependencies = Readonly<{
  propertyAccess: AiPropertyAccess
  authorization: AiAuthorizationPort
  processingProfiles: PropertyProcessingProfilePort
  calendar: AiPropertyCalendarPort
  facts: AiGuestVoiceFactsPort
  reviewSources: Pick<AiReviewSourcePort, 'readTrendPopulation'>
  nowEpochMillis: () => number
}>

export type GuestVoiceReadInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** The reader, authorized for the Property before anything is read. */
  actor: AuthContext
  range: PopulationRange
}>

export type GuestVoiceReadContext = Readonly<{
  status: 'loaded'
  scope: GuestVoiceFactsScope
  choice: PopulationChoice
  build: GuestVoiceBuildInput
  history: readonly GuestVoiceReview[]
  historyStartLocalDate: string
}>

/** Admission is identical for page and detail, before any tenant-derived facts. */
export async function loadGuestVoiceReadContext(
  deps: GuestVoiceReadDependencies,
  input: GuestVoiceReadInput,
  acceptsWindow?: (
    window: Readonly<{ startLocalDate: string; endLocalDate: string }>,
  ) => boolean,
): Promise<
  | GuestVoiceReadContext
  | Readonly<{ status: 'disabled' | 'preparing' | 'not_v3' | 'refresh_required' }>
> {
  await requireAiPropertyReadAccess(
    deps.propertyAccess,
    input.actor,
    'dashboard.read',
    input,
  )
  if (!['auto', '30d', '90d', '180d', '365d'].includes(input.range))
    throw new TypeError('Invalid Guest voice range')
  const gate = await resolveAiReadGate(deps, input, 'review_analysis')
  if (
    gate.status === 'disabled' ||
    !isAiAuthorizationUnderServedContract(gate.authorization, 'review_analysis')
  )
    return { status: 'disabled' }
  const endLocalDate = await deps.calendar.resolveLocalDate({
    reviewedAtEpochMillis: deps.nowEpochMillis(),
    timezone: gate.profile.timezone,
    calendarProfileVersion: 'property-calendar-v1',
  })
  if (endLocalDate === null) return { status: 'preparing' }
  const scopes = guestVoiceScopes(input, gate, endLocalDate)
  if (!(await deps.facts.hasV3Analyses(scopes.facts))) return { status: 'not_v3' }
  const choice = await choosePopulation(
    deps.reviewSources,
    scopes.population,
    input.range,
  )
  if (choice === null) return { status: 'preparing' }
  const window = { startLocalDate: choice.startLocalDate, endLocalDate }
  if (acceptsWindow && !acceptsWindow(window)) return { status: 'refresh_required' }
  const before = choice.hasBaseline
    ? {
        startLocalDate: addDays(choice.startLocalDate, -BASELINE_DAYS),
        endLocalDate: addDays(choice.startLocalDate, -1),
      }
    : null
  // A bounded year read may cover history even when it could not cover a baseline.
  // The earliest returned row is not a coverage boundary; use the query policy.
  const historyStart = twelveMonthStart(endLocalDate)
  const availableHistoryStart =
    choice.coveredStartLocalDate > historyStart
      ? choice.coveredStartLocalDate
      : historyStart
  const requiredStart = before?.startLocalDate ?? choice.startLocalDate
  const historyStartLocalDate =
    availableHistoryStart < requiredStart ? availableHistoryStart : requiredStart
  const facts = await deps.facts.readFacts(scopes.facts, {
    startLocalDate: historyStartLocalDate,
    endLocalDate,
  })
  if (facts === null || facts.coverage.settledAnalysisCount === 0)
    return { status: 'preparing' }
  const joined = joinWindows({ window, before, population: choice.reviews, facts })
  return {
    status: 'loaded',
    scope: scopes.facts,
    choice,
    historyStartLocalDate,
    history: joinPeriod(
      { startLocalDate: historyStartLocalDate, endLocalDate },
      choice.reviews,
      facts.reviews,
      facts.unavailable,
    ).analysed,
    build: {
      propertyId: input.propertyId,
      window: choice.window,
      ...window,
      provisional: joined.provisional,
      population: joined.now.population,
      currentPopulation: joined.now.currentPopulation,
      groups: new Map(facts.groups.map((g) => [g.id, g])),
      current: joined.now.analysed,
      baseline: joined.earlier?.analysed ?? [],
    },
  }
}
