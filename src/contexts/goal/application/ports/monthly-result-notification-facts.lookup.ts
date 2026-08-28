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
 * Identifier-only delivery facts for one currently authoritative correction.
 * The revision fence deliberately makes a superseded event resolve to null.
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
  findMonthlyResultNotificationFacts(
    input: FindMonthlyResultNotificationFactsInput,
  ): Promise<MonthlyResultNotificationFacts | null>
  findMonthlyResultRevisionNotificationFacts(
    input: FindMonthlyResultRevisionNotificationFactsInput,
  ): Promise<MonthlyResultRevisionNotificationFacts | null>
}>
