import { addDays } from './local-date.contracts'
import type { GuestVoiceFactsRead } from './ai-guest-voice-facts.port.server'
import type { GuestVoiceBuildInput } from '../application/read-models/guest-voice-v2-build'
import { joinWindows, type Period } from './guest-voice-v2-join.server'
import { BASELINE_DAYS, type PopulationChoice } from './guest-voice-v2-population.server'

/** The page and the Monday comparison use the same window and preceding year. */
export function guestVoicePeriod(
  choice: PopulationChoice,
  endLocalDate: string,
  daysBack = 0,
): Readonly<{ window: Period; before: Period | null }> {
  const window = {
    startLocalDate: addDays(choice.startLocalDate, -daysBack),
    endLocalDate: addDays(endLocalDate, -daysBack),
  }
  return {
    window,
    before: choice.hasBaseline
      ? {
          startLocalDate: addDays(window.startLocalDate, -BASELINE_DAYS),
          endLocalDate: addDays(window.startLocalDate, -1),
        }
      : null,
  }
}

export function buildGuestVoicePeriod(
  propertyId: string,
  choice: PopulationChoice,
  facts: GuestVoiceFactsRead,
  period: ReturnType<typeof guestVoicePeriod>,
): GuestVoiceBuildInput {
  const joined = joinWindows({ ...period, population: choice.reviews, facts })
  return {
    propertyId,
    window: choice.window,
    ...period.window,
    provisional: joined.provisional,
    population: joined.now.population,
    currentPopulation: joined.now.currentPopulation,
    groups: new Map(facts.groups.map((group) => [group.id, group])),
    current: joined.now.analysed,
    baseline: joined.earlier?.analysed ?? [],
  }
}
