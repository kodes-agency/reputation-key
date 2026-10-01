// The two pages Review & publish draws side by side: what a guest meets after a
// 1 star and after a 5 star rating. Both carry the same Google card, which is
// the point of the pair; only the optional private note differs, and only when
// the portal's threshold reaches the rating.

import {
  ratedState,
  type PreviewPageState,
} from '../portal-preview/portal-preview-states'

export type ReviewPairState = Readonly<{
  id: 'low' | 'high'
  rating: number
  /** Printed over the phone: "1★ Poor". */
  label: string
  state: PreviewPageState
}>

const LOW_RATING = 1
const HIGH_RATING = 5
const MAX_RATING = 5

export function reviewPairStates(threshold: number): readonly ReviewPairState[] {
  return [
    {
      id: 'low',
      rating: LOW_RATING,
      label: `${LOW_RATING}★ Poor`,
      state: ratedState(LOW_RATING, threshold),
    },
    {
      id: 'high',
      rating: HIGH_RATING,
      label: `${HIGH_RATING}★ Excellent`,
      state: ratedState(HIGH_RATING, threshold),
    },
  ]
}

const GOOGLE_SENTENCE =
  'Once published, Google is offered the same way after every rating.'

/** The line over the pair: what is the same for every guest, and where the private note comes in. */
export function describeGoogleCard(threshold: number): Readonly<{
  title: string
  body: string
}> {
  const title = 'Every guest gets the same Google card'
  if (threshold < LOW_RATING) return { title, body: GOOGLE_SENTENCE }
  const note =
    threshold >= MAX_RATING
      ? 'The page also offers an optional private note after every rating.'
      : `At ${threshold}★ or below the page also offers an optional private note.`
  return { title, body: `${GOOGLE_SENTENCE} ${note}` }
}
