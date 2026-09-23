import type { GoalSubject } from '../../domain/goal-program'
import type { GoalMetricEvaluation } from '../../domain/goal-program'

export type FindMonthlyResultNotificationFactsInput = Readonly<{
  organizationId: string
  propertyId: string
  assignmentId: string
  monthlyResultId: string
}>

export type MonthlyResultNotificationFacts = Readonly<{
  programId: string
  monthlyResultId: string
  assignmentId: string
  programName: string
  /**
   * The month the result covers, `YYYY-MM` on the PROPERTY's own calendar —
   * the timezone the period was closed on, stored with the result. A key, not
   * a label: the reader's surface writes the month name.
   */
  periodMonth: string
  subject: GoalSubject
}>

export type FindMonthlyResultRevisionNotificationFactsInput = Readonly<{
  organizationId: string
  propertyId: string
  programId: string
  programVersionId: string
  assignmentId: string
  monthlyResultId: string
  revisionId: string
  revision: number
}>

/**
 * Identifier-only delivery facts for the CURRENT head of a corrected result,
 * found through one correction in its chain. A superseded correction resolves
 * to the head that replaced it (`revisionId`/`revision` then name the head):
 * revision flags compare each correction with the one before it, so a smaller
 * follow-up carries none, and requiring the exact head would silently drop
 * the notice of the correction that actually changed the outcome. Callers
 * compare the head's `evaluationState`/`achieved` with what their notice says.
 */
export type MonthlyResultRevisionNotificationFacts = MonthlyResultNotificationFacts &
  Readonly<{
    programVersionId: string
    revisionId: string
    revision: number
    evaluationState: GoalMetricEvaluation['state']
    achieved: boolean | null
  }>

/**
 * Goal-owned delivery-time read. Consumers provide every durable identity;
 * this port never broadens a miss to a looser Program or subject lookup.
 */
export type MonthlyResultNotificationFactsLookup = Readonly<{
  /**
   * Facts for a closed result that is achieved as it stands NOW: its latest
   * correction when it has one, the closed row otherwise. Null once a
   * correction has un-achieved it, so "Goal completed" is never confirmed for
   * a month that was missed.
   */
  findMonthlyResultNotificationFacts(
    input: FindMonthlyResultNotificationFactsInput,
  ): Promise<MonthlyResultNotificationFacts | null>
  findMonthlyResultRevisionNotificationFacts(
    input: FindMonthlyResultRevisionNotificationFactsInput,
  ): Promise<MonthlyResultRevisionNotificationFacts | null>
}>
