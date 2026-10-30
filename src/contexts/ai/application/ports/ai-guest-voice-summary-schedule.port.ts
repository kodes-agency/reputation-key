import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GuestVoiceSummaryPlan } from '../use-cases/plan-guest-voice-summary'

/** A Property whose Guest voice summary may be due: it is its Monday morning. */
export type DueGuestVoiceSummary = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** What the sweep records when a plan says to send. */
export type GuestVoiceSummaryPublication = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  plan: Extract<GuestVoiceSummaryPlan, { status: 'send' }>
  /** When the plan was made: the instant the fact is recorded at. */
  occurredAt: Date
}>

/** What the Monday sweep needs of the AI store. */
export type AiGuestVoiceSummarySchedulePort = Readonly<{
  /**
   * The Properties with Review Analysis enabled whose local time is Monday between 08:00
   * and 10:59, oldest id first, at most `limit`. A tenant-cross enumeration only: each is
   * decided again, under current policy, before anything of it is read.
   */
  listDue(
    input: Readonly<{ nowEpochMillis: number; limit: number }>,
  ): Promise<readonly DueGuestVoiceSummary[]>
  /**
   * Records the summary as one identifier-only fact. One per Property per Monday: true
   * when this call recorded it, false when that Monday's was already there.
   */
  publish(publication: GuestVoiceSummaryPublication): Promise<boolean>
}>
