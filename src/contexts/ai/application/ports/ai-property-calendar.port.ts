export type AiPropertyCalendarPort = Readonly<{
  assertComplete(): Promise<boolean>

  resolveLocalDate(
    input: Readonly<{
      reviewedAtEpochMillis: number
      timezone: string
      calendarProfileVersion: 'property-calendar-v1'
    }>,
  ): Promise<string | null>
}>
