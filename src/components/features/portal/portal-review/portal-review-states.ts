// The words of the "See every guest state" row on the review page.

/** The line beside "See every guest state". */
export const describeStatesSummary = (languageCount: number): string =>
  `Arrival, after each rating and done · in ${languageCount} ${languageCount === 1 ? 'language' : 'languages'}`
