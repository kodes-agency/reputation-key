// The provider subject mapping a stored Review is judged by when it vanishes
// from Google (`review_provider_subjects`).
//
// A snapshot page maps every review it lists, strictly: a collision, a
// rotating key or an older revision fails the run. A head check or a push
// stores reviews outside any run, and records only that a review exists on
// Google: it inserts a missing mapping and, for one that already maps the same
// review, keeps its revision current. It never moves a mapping to another key,
// review or state, and never touches what a run saw or missed, so the snapshot
// run stays the only writer of those.
//
// Both take the locks in the same order: the subject key versions, shared, then
// the subject rows. A rotation updates every key row, so it waits for the
// mappings in flight and they wait for it; mappings do not wait for each other.

import { timingSafeEqual } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  reviewProviderSubjectHmacKeyVersions,
  reviewProviderSubjects,
} from '#/shared/db/schema/review.schema'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  ReviewProviderSubjectSighting,
  ReviewProviderSubjectSightings,
} from '../../application/ports/review-provider-subject-sightings.port'
import type { ReviewProviderSubject } from '#/shared/review-provider-subject-contract'
import type { ReviewProviderSubjectCandidates } from '../../application/ports/review-provider-observation-writer.port'
import { snapshotSubjectScope } from './review-provider-snapshot-scope'

type SubjectRow = typeof reviewProviderSubjects.$inferSelect

export type SubjectLinkScope = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
}>

export type SubjectLinkObservation = Readonly<{
  reviewId: string
  sourceRevision: number
  subjects: ReviewProviderSubjectCandidates
}>

function hmacEquals(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === 32 &&
    right.byteLength === 32 &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  )
}

/**
 * Lock the key versions the candidates were derived under, shared, and say
 * whether the first candidate is under the one active key. A mapping written
 * under any other key would outlive the rotation unmatched.
 *
 * The candidates are under the active key and, mid-rotation, the retiring one;
 * never under a staged next key. A mapping written under the active key while
 * a next key is staged is safe: activation needs no mapping under the next
 * key, turns the active key into the retiring one, which every listing then
 * moves its mappings off, and a retiring key cannot be removed while any
 * mapping still uses it.
 */
export async function activeSubjectKeyHolds(
  tx: Tx,
  observation: SubjectLinkObservation,
): Promise<boolean> {
  const keyRows = await tx
    .select()
    .from(reviewProviderSubjectHmacKeyVersions)
    .where(
      inArray(
        reviewProviderSubjectHmacKeyVersions.keyVersion,
        observation.subjects.map((subject) => subject.keyVersion),
      ),
    )
    .orderBy(asc(reviewProviderSubjectHmacKeyVersions.generation))
    .for('share')
  const activeKey = keyRows.find((row) => row.state === 'active')
  return activeKey != null && activeKey.keyVersion === observation.subjects[0].keyVersion
}

/** Every stored mapping one of the candidates locates, locked. */
export async function findSubjectMatches(
  tx: Tx,
  scope: SubjectLinkScope,
  observation: SubjectLinkObservation,
): Promise<readonly SubjectRow[]> {
  const matches: SubjectRow[] = []
  for (const subject of observation.subjects) {
    const rows = await tx
      .select()
      .from(reviewProviderSubjects)
      .where(
        and(
          snapshotSubjectScope(scope.organizationId, scope.propertyId, scope.sourceEpoch),
          eq(reviewProviderSubjects.keyVersion, subject.keyVersion),
          eq(reviewProviderSubjects.locatorHmac, Buffer.from(subject.locatorHmac)),
        ),
      )
      .for('update')
    matches.push(...rows)
  }
  return matches
}

/**
 * The candidate that locates `match` and whose verifier agrees with it, or
 * null when the mapping belongs to another provider resource.
 */
export function verifiedCandidateOf(
  observation: SubjectLinkObservation,
  match: SubjectRow,
): ReviewProviderSubject | null {
  const candidate = observation.subjects.find(
    (subject) =>
      subject.keyVersion === match.keyVersion &&
      hmacEquals(subject.locatorHmac, match.locatorHmac),
  )
  if (candidate == null || !hmacEquals(candidate.verifierHmac, match.verifierHmac)) {
    return null
  }
  return candidate
}

/** A linked mapping under the active candidate, seen now. */
export function linkedSubjectValues(
  scope: SubjectLinkScope,
  observation: SubjectLinkObservation,
  lastSeenSnapshotRunId: string | null,
) {
  const active = observation.subjects[0]
  return {
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    sourceEpoch: scope.sourceEpoch,
    keyVersion: active.keyVersion,
    locatorHmac: Buffer.from(active.locatorHmac),
    verifierHmac: Buffer.from(active.verifierHmac),
    reviewId: observation.reviewId,
    lastSourceRevision: observation.sourceRevision,
    state: 'linked',
    lastObservedAt: sql`transaction_timestamp()`,
    lastSeenSnapshotRunId,
  }
}

export type SubjectSightingOutcome =
  'linked' | 'already_mapped' | 'collision' | 'key_rotating'

/**
 * A linked mapping of the same review keeps the newest revision stored, seen
 * now, so the removal step's revision check matches the Review after a later
 * edit, and a run that started before the edit does not judge it missing.
 */
async function keepRevisionCurrent(
  tx: Tx,
  observation: SubjectLinkObservation,
  match: SubjectRow,
): Promise<void> {
  if (
    match.state !== 'linked' ||
    match.lastSourceRevision >= observation.sourceRevision
  ) {
    return
  }
  await tx
    .update(reviewProviderSubjects)
    .set({
      lastSourceRevision: observation.sourceRevision,
      lastObservedAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
    })
    .where(
      and(
        eq(reviewProviderSubjects.organizationId, match.organizationId),
        eq(reviewProviderSubjects.propertyId, match.propertyId),
        eq(reviewProviderSubjects.sourceEpoch, match.sourceEpoch),
        eq(reviewProviderSubjects.keyVersion, match.keyVersion),
        eq(reviewProviderSubjects.locatorHmac, match.locatorHmac),
      ),
    )
}

/** A sighting of a review some mapping already locates: the same review, or
 * a collision when that mapping (or none of them) is another resource's. */
async function sightingOfMapped(
  tx: Tx,
  observation: SubjectLinkObservation,
  matches: readonly SubjectRow[],
): Promise<SubjectSightingOutcome> {
  const match = matches.length === 1 ? matches[0] : undefined
  if (
    match == null ||
    match.reviewId !== observation.reviewId ||
    verifiedCandidateOf(observation, match) == null
  ) {
    return 'collision'
  }
  await keepRevisionCurrent(tx, observation, match)
  return 'already_mapped'
}

/**
 * Map a review stored outside a snapshot run. A review nothing maps yet is
 * linked with no run, seen at this transaction's instant: a run that started
 * earlier never judges it missing (`last_observed_at <= started_at`), and
 * removal still needs two listings and a direct read that agree it is gone.
 * A review already mapped keeps its mapping, with its revision kept current. A
 * mapping of the locator or of the review that is another's is a collision
 * and stays untouched, and nothing is written when the candidates' key is no
 * longer the active one.
 */
export async function recordSubjectSighting(
  tx: Tx,
  scope: SubjectLinkScope,
  observation: SubjectLinkObservation,
): Promise<SubjectSightingOutcome> {
  if (!(await activeSubjectKeyHolds(tx, observation))) return 'key_rotating'
  const matches = await findSubjectMatches(tx, scope, observation)
  if (matches.length > 0) return sightingOfMapped(tx, observation, matches)
  const inserted = await tx
    .insert(reviewProviderSubjects)
    .values(linkedSubjectValues(scope, observation, null))
    .onConflictDoNothing()
    .returning({ reviewId: reviewProviderSubjects.reviewId })
  if (inserted.length > 0) return 'linked'
  // A concurrent writer mapped the locator, or the review is mapped under
  // another locator: judge what is there now.
  return sightingOfMapped(
    tx,
    observation,
    await findSubjectMatches(tx, scope, observation),
  )
}

/**
 * The sightings recorder head checks and targeted reads share. It never
 * throws: the review is already stored, and the next full listing maps it if
 * this could not. A collision is counted in the log, without identifiers, as
 * a listing's `resource_collision` is counted on its run.
 */
export const createReviewProviderSubjectSightings = (
  db: Database,
  logger: Pick<LoggerPort, 'warn'>,
): ReviewProviderSubjectSightings => ({
  record: async (sighting: ReviewProviderSubjectSighting) =>
    trace('review.providerSubject.recordSighting', async () => {
      try {
        const outcome = await db.transaction((tx) =>
          recordSubjectSighting(tx, sighting, sighting),
        )
        if (outcome === 'collision') {
          logger.warn(
            { event: 'review_provider_subject_sighting_collision', count: 1 },
            'A stored review collides with another provider subject mapping',
          )
        }
        return outcome
      } catch (error) {
        logger.warn(
          { event: 'review_provider_subject_sighting_not_recorded', err: error },
          'A stored review could not be mapped to its provider subject',
        )
        return 'unavailable' as const
      }
    }),
})
