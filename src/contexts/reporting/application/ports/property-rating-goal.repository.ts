// Reporting — the Property Google rating goal's persistence and Property facts.
//
// One active goal per Property. Every read and write names the Organization
// and the Property; a goal id alone is never a tenant scope.

import type {
  PropertyRatingGoal,
  RatingGoalChange,
  RatingGoalEndedReason,
  RatingGoalEvaluationMark,
  RatingGoalPlan,
  RatingGoalStatus,
} from '../../domain/rating-goal'
import type { RatingGoalNotice } from '../../domain/rating-goal-notices'

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

/** The part of the stored evaluation a notice was worked out against. */
export type RatingGoalNoticeMark = Pick<
  RatingGoalEvaluationMark,
  'displayedTenths' | 'knownStatus' | 'belowPaceNoticedAt' | 'cantReachNoticedAt'
>

/** What an evaluation stores, and the terminal step it takes, if any. */
export type RatingGoalEvaluationWrite = Readonly<{
  organizationId: string
  propertyId: string
  goalId: string
  /** The version of the plan the evaluation was worked out on. */
  expectedVersion: number
  /**
   * What the goal held when the evaluation read it. The write applies only
   * onto exactly that, so its notices are told once and from the right "before".
   */
  expectedMark: RatingGoalNoticeMark
  /** The tenth Google showed; null keeps the stored one (Google was not readable). */
  displayedTenths: number | null
  status: RatingGoalStatus
  /** The last status that was not a wait for Google, after this evaluation. */
  knownStatus: RatingGoalStatus | null
  belowPaceNoticedAt: Date | null
  cantReachNoticedAt: Date | null
  evaluatedAt: Date
  outcome:
    | Readonly<{ kind: 'continues' }>
    | Readonly<{ kind: 'reached' }>
    | Readonly<{ kind: 'ended'; reason: Exclude<RatingGoalEndedReason, 'manager'> }>
  /**
   * What the goal's managers are told. Each is written as a
   * `goal.rating_goal.transitioned` fact in the same transaction as the row.
   */
  notices: readonly RatingGoalNotice[]
}>

/** A Property's archive, as its lifecycle fact names it. */
export type RatingGoalPropertyArchive = Readonly<{
  organizationId: string
  propertyId: string
  /** The binding epoch the archive moved the Property to. */
  archivedEpoch: number
  endedAt: Date
}>

export type RatingGoalWriteResult = 'written' | 'version_conflict' | 'not_active'

/** One active goal's tenant scope, as the daily evaluation lists them. */
export type RatingGoalScope = Readonly<{
  goalId: string
  organizationId: string
  propertyId: string
}>

/** Where the daily evaluation's listing continues: after this goal. */
export type RatingGoalScopeCursor = Pick<RatingGoalScope, 'goalId'>

/** A manager's "Not now" for a Property's rating goal. */
export type RatingGoalNotNow = Readonly<{
  organizationId: string
  propertyId: string
  chosenBy: string
  chosenAt: Date
}>

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
   * or takes a terminal step, with one outbox fact per notice in the same
   * transaction. True when the row changed. Never moves the version, so a
   * manager's open form stays valid across evaluations; but it is refused
   * (false) when a manager changed the plan since the evaluation read it, when
   * a newer evaluation is already stored, or when another evaluation stored a
   * tenth, a known status or a below-pace notice since this one read them. A
   * refused evaluation tells nobody anything and is decided again by the next.
   */
  recordEvaluation(write: RatingGoalEvaluationWrite): Promise<boolean>
  /**
   * The Organization and Property of active goals in goal id order, at most
   * `limit` after the cursor: the daily evaluation's tenant-cross listing.
   * Identifiers only.
   */
  listActiveGoalScopes(
    after: RatingGoalScopeCursor | null,
    limit: number,
  ): Promise<readonly RatingGoalScope[]>
  /**
   * Ends the Property's active goal `property_archived` when it was set under
   * an epoch before the archive's, so a late or repeated fact never ends a goal
   * set after a Restore. True when a goal ended.
   */
  endForArchivedProperty(archive: RatingGoalPropertyArchive): Promise<boolean>
  /**
   * Records that a manager chose "Not now" for the Property's rating goal. A
   * repeat keeps the first choice. True when this call recorded it.
   */
  recordNotNow(choice: RatingGoalNotNow): Promise<boolean>
}>
