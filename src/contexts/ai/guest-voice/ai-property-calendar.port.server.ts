export type AiPropertyCalendarPort = Readonly<{
  resolveLocalDate(
    input: Readonly<{
      reviewedAtEpochMillis: number
      timezone: string
    }>,
  ): Promise<string | null>
}>
