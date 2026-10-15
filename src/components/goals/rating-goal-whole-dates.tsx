// A forecast set on a screen: the month and year of each end of its range never
// part across lines ("Dec 2026 –" stays together, then "Jan 2027"), so a phone
// breaks the line only between the two ends. Spans, not non-breaking spaces:
// the words a screen reader and a test read are the sentence as it is.
import { dateParts } from './rating-goal-view'

export function RatingGoalWholeDates({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {dateParts(text).map((part, at) =>
        part.whole ? (
          <span key={at} className="whitespace-nowrap">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  )
}
