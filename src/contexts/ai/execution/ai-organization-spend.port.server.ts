import type { OrganizationId } from '#/shared/domain/ids'

export type AiOrganizationMonthSpend = Readonly<{
  /** First instant of the calendar month the window covers (UTC). */
  monthStartEpochMillis: number
  settledMicros: number
  reservedMicros: number
  capMicros: number
}>

export type AiOrganizationSpendPort = Readonly<{
  /** The organization's current monthly cost window; zero spend when none exists yet. */
  readCurrentMonth(
    input: Readonly<{ organizationId: OrganizationId; nowEpochMillis: number }>,
  ): Promise<AiOrganizationMonthSpend>
}>
