// Google's own rating and count for one Property, as a headline shows them.
//
// Two reads at once: the Current on Google snapshot (which answers only at the
// Property's current binding epoch) and whether that binding is active now.
// The rule that turns them into a headline is `googleNumbersView`.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { googleNumbersView, type GoogleNumbersView } from '../domain/google-numbers'
import type { RatingGoalPropertyFactsReader } from './ports/property-rating-goal.repository'
import type { MetricPublicApi } from './public-api'

export type GoogleNumbersReadDeps = Readonly<{
  properties: RatingGoalPropertyFactsReader
  google: Pick<MetricPublicApi, 'getCurrentOnGoogle'>
}>

/** Null when Google never sent numbers for the current binding, or the Property is gone. */
export async function readGoogleNumbers(
  deps: GoogleNumbersReadDeps,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  now: Date,
): Promise<GoogleNumbersView | null> {
  const [facts, snapshot] = await Promise.all([
    deps.properties.findPropertyFacts(organizationId, propertyId),
    deps.google.getCurrentOnGoogle(organizationId, propertyId),
  ])
  if (facts === null) return null
  return googleNumbersView(snapshot, facts.googleBindingActive, now)
}

export type ReadGoogleNumbers = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
  now: Date,
) => Promise<GoogleNumbersView | null>
