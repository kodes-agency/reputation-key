/** The part of a Goal Program version that says when it starts. */
export type GoalVersionStart = Readonly<{ effectiveFrom: Date; propertyTimezone: string }>

/**
 * A revision's start date in the Property timezone its version was cut in.
 * After the Property's timezone moves east a revision can start a month later
 * than the next one, and the month in between is not evaluated (reporting
 * CONTEXT.md, invariant 2), so the date is always stated, never implied.
 */
export function goalRevisionStartDate(version: GoalVersionStart): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: version.propertyTimezone,
  }).format(version.effectiveFrom)
}

export function goalRevisionScheduledMessage(version: GoalVersionStart): string {
  return `Goal revision scheduled. It starts ${goalRevisionStartDate(version)} (${version.propertyTimezone}).`
}
