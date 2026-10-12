// What the Google settings card says about a Property's review destination.
// Kept apart from the card so each state's wording is tested without rendering.
//
// Nothing refreshes a destination in the background: a fenced one comes back
// when the Property is restored while still linked, or when it is linked again,
// and a Property Google gave no review link keeps none until it is linked
// again. So no state may read as if something were on its way.

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

export function googleReviewDestinationText(
  property: GoogleReviewDestinationSubject,
): string {
  const destination = property.googleReviewDestination
  if (!destination) return 'Not checked yet'
  if (destination.state === 'verified') {
    return 'Verified — guests can leave a Google review'
  }
  const linked = property.googleBindingState === 'active'
  if (destination.state === 'awaiting_refresh') {
    if (!linked) {
      return 'On hold — relink the Business Profile to bring the review link back'
    }
    return property.lifecycleState === 'archived'
      ? 'On hold while this property is archived — restoring it brings the review link back'
      : 'On hold — portals offer private feedback only'
  }
  return linked
    ? 'Unavailable — Google gave no review link for this Business Profile, so portals offer private feedback only'
    : 'Unavailable — portals offer private feedback only'
}
