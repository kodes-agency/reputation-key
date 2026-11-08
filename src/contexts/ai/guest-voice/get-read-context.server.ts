import { guestVoicePeriod, buildGuestVoicePeriod } from './period.server'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from '../application/ai-property-read-access'
import { resolveAiReadGate } from '../application/ai-read-gate'
import {
  getAiRuntimeCapability,
  isAiRuntimeNoticeInForce,
} from '#/shared/ai-runtime-capability-contract'
import type { AiAuthorizationPort } from '../application/ports/ai-authorization.port'
import type {
  AiGuestVoiceFactsPort,
  GuestVoiceFactsScope,
} from '../application/ports/ai-guest-voice-facts.port'
import type { AiPropertyCalendarPort } from '../application/ports/ai-property-calendar.port'
import type { PropertyProcessingProfilePort } from '../application/ports/property-processing-profile.port'
import { twelveMonthStart } from '../application/read-models/guest-voice-v2-recency'
import { joinPeriod } from '../application/read-models/guest-voice-v2-join'
import {
  GUEST_VOICE_RANGES,
  choosePopulation,
  type PopulationChoice,
  type PopulationRange,
} from '../application/read-models/guest-voice-v2-population'
import { guestVoiceScopes } from '../application/read-models/guest-voice-v2-scopes'
import type { GuestVoiceReview } from '../application/read-models/guest-voice-v2-facts'
import type { GuestVoiceBuildInput } from '../application/read-models/guest-voice-v2-build'

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

type GuestVoiceReadOptions = Readonly<{
  withHistory?: boolean
  acceptsWindow?: (
    window: Readonly<{ startLocalDate: string; endLocalDate: string }>,
  ) => boolean
}>
type GuestVoiceReadResult =
  | GuestVoiceReadContext
  | Readonly<{
      status: 'disabled' | 'preparing' | 'not_v3' | 'refresh_required'
    }>

/** Facts and joins are bounded by the page window/baseline unless issue history is requested. */
async function loadGuestVoiceFacts(
  deps: GuestVoiceReadDependencies,
  input: GuestVoiceReadInput,
  scope: GuestVoiceFactsScope,
  choice: PopulationChoice,
  endLocalDate: string,
  withHistory: boolean,
): Promise<GuestVoiceReadResult> {
  const period = guestVoicePeriod(choice, endLocalDate)
  const requiredStart = period.before?.startLocalDate ?? period.window.startLocalDate
  // Coverage follows the population query policy, never the earliest returned row.
  const availableHistoryStart =
    choice.coveredStartLocalDate > twelveMonthStart(endLocalDate)
      ? choice.coveredStartLocalDate
      : twelveMonthStart(endLocalDate)
  const historyStartLocalDate =
    withHistory && availableHistoryStart < requiredStart
      ? availableHistoryStart
      : requiredStart
  const facts = await deps.facts.readFacts(scope, {
    startLocalDate: historyStartLocalDate,
    endLocalDate,
  })
  if (facts === null || facts.coverage.settledAnalysisCount === 0)
    return { status: 'preparing' }
  return {
    status: 'loaded',
    scope,
    choice,
    historyStartLocalDate,
    history: withHistory
      ? joinPeriod(
          { startLocalDate: historyStartLocalDate, endLocalDate },
          choice.reviews,
          facts.reviews,
          facts.unavailable,
        ).analysed
      : [],
    build: buildGuestVoicePeriod(input.propertyId, choice, facts, period),
  }
}

/** Shared Property admission and population selection, before tenant facts are read. */
export async function loadGuestVoiceReadContext(
  deps: GuestVoiceReadDependencies,
  input: GuestVoiceReadInput,
  options: GuestVoiceReadOptions = {},
): Promise<GuestVoiceReadResult> {
  await requireAiPropertyReadAccess(
    deps.propertyAccess,
    input.actor,
    'dashboard.read',
    input,
  )
  if (!GUEST_VOICE_RANGES.includes(input.range))
    throw new TypeError('Invalid Guest voice range')
  const gate = await resolveAiReadGate(deps, input, 'review_analysis')
  if (
    gate.status === 'disabled' ||
    !isAiRuntimeNoticeInForce(
      getAiRuntimeCapability('review_analysis'),
      gate.authorization,
    ) ||
    gate.authorization.providerDeploymentProfileVersion !==
      getAiRuntimeCapability('review_analysis').providerDeploymentProfileVersion
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
  if (options.acceptsWindow && !options.acceptsWindow(window))
    return { status: 'refresh_required' }
  return loadGuestVoiceFacts(
    deps,
    input,
    scopes.facts,
    choice,
    endLocalDate,
    options.withHistory ?? false,
  )
}
