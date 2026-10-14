// Reporting — the Property Google rating goal's persistence and Property facts.
//
// One active goal per Property. Every read and write names the Organization
// and the Property; a goal id alone is never a tenant scope.

import type {
  PropertyRatingGoal,
  RatingGoalChange,
  RatingGoalEndedReason,
  RatingGoalPlan,
  RatingGoalStatus,
} from '../../domain/rating-goal'

/** What a rating goal needs to know about its Property, read in one place. */
export type RatingGoalPropertyFacts = Readonly<{
  timezone: string
  /** The Property lifecycle state (`active`, `suspended`, `archived`, ...). */
  lifecycleState: string
  /** The current Google binding epoch. */
  sourceEpoch: number
  /** True while the Property's Google binding is active. */
  googleBindingActive: boolean
}>

export type RatingGoalPropertyFactsReader = Readonly<{
  /** Null when the Property does not exist (or is deleted) in the Organization. */
  findPropertyFacts(
    organizationId: string,
    propertyId: string,
  ): Promise<RatingGoalPropertyFacts | null>
}>

/**
 * A goal as it is set: active, version 1. Its `lastEvaluation` is what the
 * set saw (the tenth Google showed, the status it starts in), so the first
 * evaluation can tell a tenth gained or lost since then from a first reading.
 */
export type NewPropertyRatingGoal = Omit<
  PropertyRatingGoal,
  'state' | 'endedReason' | 'reachedAt' | 'endedAt' | 'version'
>

export type RatingGoalPlanChange = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  expectedVersion: number
  plan: RatingGoalPlan
  /** One row per changed field, with ids and who/when filled in. */
  changes: readonly RatingGoalChange[]
  changedAt: Date
}>

export type RatingGoalManagerEnd = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  expectedVersion: number
  endedAt: Date
}>

/** What an evaluation stores, and the terminal step it takes, if any. */
export type RatingGoalEvaluationWrite = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  /** The version of the plan the evaluation was worked out on. */
  expectedVersion: number
  /** The tenth Google showed; null keeps the stored one (Google was not readable). */
  displayedTenths: number | null
  status: RatingGoalStatus
  evaluatedAt: Date
  outcome:
    | Readonly<{ kind: 'continues' }>
    | Readonly<{ kind: 'reached' }>
    | Readonly<{ kind: 'ended'; reason: Exclude<RatingGoalEndedReason, 'manager'> }>
}>

export type RatingGoalWriteResult = 'written' | 'version_conflict' | 'not_active'

export type PropertyRatingGoalRepository = Readonly<{
  /** True when the Organization lifecycle holds the Organization (closure). */
  isOrganizationHeld(organizationId: string): Promise<boolean>
  findActive(
    organizationId: string,
    propertyId: string,
  ): Promise<PropertyRatingGoal | null>
  findById(
    organizationId: string,
    propertyId: string,
    goalId: string,
  ): Promise<PropertyRatingGoal | null>
  /** Reached and ended goals, newest first. */
  listHistory(
    organizationId: string,
    propertyId: string,
    limit: number,
  ): Promise<readonly PropertyRatingGoal[]>
  /** A goal's change log, newest first. */
  listChanges(
    organizationId: string,
    propertyId: string,
    goalId: string,
    limit: number,
  ): Promise<readonly RatingGoalChange[]>
  /** `active_exists` when the Property already has an active goal. */
  insert(goal: NewPropertyRatingGoal): Promise<'inserted' | 'active_exists'>
  changePlan(change: RatingGoalPlanChange): Promise<RatingGoalWriteResult>
  endByManager(end: RatingGoalManagerEnd): Promise<RatingGoalWriteResult>
  /**
   * Stores an evaluation on an active goal when it differs from the stored one
   * or takes a terminal step. True when the row changed. Never moves the
   * version, so a manager's open form stays valid across evaluations; but it
   * is refused (false) when a manager changed the plan since the evaluation
   * read it, or when a newer evaluation is already stored. A refused
   * evaluation is decided again by the next one.
   */
  recordEvaluation(write: RatingGoalEvaluationWrite): Promise<boolean>
}>
