// What the two reads behind Guest voice 2.0 are asked under: the analysis side by the
// Property's current epochs and profile, and Review's side by the same Property and its
// own clock. One place, because the page and the Monday email must ask the same questions
// of the same data or "a quiet week" would be a second opinion about the page.
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AiReadGate } from '../ai-read-gate'
import type { GuestVoiceFactsScope } from '../ports/ai-guest-voice-facts.port'
import { POPULATION_QUERY_LIMIT, type PopulationScope } from './guest-voice-v2-population'

export type GuestVoiceScopes = Readonly<{
  facts: GuestVoiceFactsScope
  population: PopulationScope
}>

export function guestVoiceScopes(
  input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  gate: Extract<AiReadGate, { status: 'enabled' }>,
  endLocalDate: string,
): GuestVoiceScopes {
  const facts: GuestVoiceFactsScope = {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: gate.authorization.authorizedSourceEpoch,
    reviewAnalysisEpoch: gate.authorization.capabilityEpochs.review_analysis.epoch,
    propertyProfileVersion: gate.profile.profileVersion,
  }
  return {
    facts,
    population: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: facts.sourceEpoch,
      timezone: gate.profile.timezone,
      calendarProfileVersion: 'property-calendar-v1',
      endLocalDate,
      limit: POPULATION_QUERY_LIMIT,
    },
  }
}
