// What the Google settings card says about a Property's review destination.
// Kept apart from the card so each state's wording is tested without rendering.
//
// Nothing refreshes a destination in the background: a fenced one comes back
// when the Property is restored while still linked, or when it is linked again,
// and a Property Google gave no review link keeps none until it is linked
// again. So no state may read as if something were on its way.
//
// A Portal is published only against a verified destination, so every state
// short of verified says that publishing is blocked, or names the step that
// brings the review link back. "Private feedback only" alone would describe a
// live Portal and hide that no new one can go live.

import type {
  GoogleBindingState,
  PropertyLifecycleState,
} from '../property-lifecycle-model'

export type GoogleReviewDestinationSubject = Readonly<{
  lifecycleState: PropertyLifecycleState
  googleBindingState: GoogleBindingState
  googleReviewDestination?: Readonly<{
    state: 'verified' | 'awaiting_refresh' | 'unavailable' | string
  }>
}>

const PUBLISHING_BLOCKED =
  'portals cannot be published and any live portal offers private feedback only'

/** A held review link that is fenced: what lifts the fence, or what it costs. */
function onHoldText(property: GoogleReviewDestinationSubject): string {
  const archived = property.lifecycleState === 'archived'
  if (property.googleBindingState !== 'active') {
    // The import offers a relink only for an active Property.
    return archived
      ? 'On hold while this property is archived — restore it, then relink the Business Profile'
      : 'On hold — relink the Business Profile to bring the review link back'
  }
  return archived
    ? 'On hold while this property is archived — restoring it brings the review link back'
    : `On hold — ${PUBLISHING_BLOCKED}`
}

export function googleReviewDestinationText(
  property: GoogleReviewDestinationSubject,
): string {
  const destination = property.googleReviewDestination
  if (!destination) return 'Not checked yet'
  if (destination.state === 'verified') {
    return 'Verified — guests can leave a Google review'
  }
  if (destination.state === 'awaiting_refresh') return onHoldText(property)
  return property.googleBindingState === 'active'
    ? `Unavailable — Google gave no review link for this Business Profile, so ${PUBLISHING_BLOCKED}`
    : `Unavailable — ${PUBLISHING_BLOCKED}`
}
