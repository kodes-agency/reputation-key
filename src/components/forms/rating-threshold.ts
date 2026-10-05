// The ratings a threshold may name, and how a threshold reads. The one place the words
// live: the Portal editor, the notification page and the Organization targets all ask
// "how low a rating", and a screen reader says "★" as "black star", so the glyph is for
// the eye and the spoken form is for the ear.

/** Every rating a threshold can be, lowest first. */
export const RATING_THRESHOLDS = [1, 2, 3, 4, 5] as const

/** "N★ or lower" on screen; the lowest rating has nothing below it, so it is "only". */
export const ratingThresholdWords = (threshold: number): string =>
  threshold === 1 ? '1★ only' : `${threshold}★ or lower`

/** The same read aloud. */
export const spokenRatingThresholdWords = (threshold: number): string =>
  threshold === 1 ? '1 star only' : `${threshold} stars or lower`
