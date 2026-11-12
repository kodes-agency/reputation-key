// The provider subject mapping a stored Review is judged by when it vanishes
// from Google (`review_provider_subjects`).
//
// A snapshot page maps every review it lists, strictly: a collision, a
// rotating key or an older revision fails the run. A head check or a push
// stores reviews outside any run, and records only that a review exists on
// Google: it inserts a missing mapping and never changes one, so the snapshot
// run stays the only writer that moves a mapping.
//
// Both take the locks in the same order: the subject key versions, then the
// subject rows.

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

/**
 * Lock the key versions the candidates were derived under and say whether the
 * first candidate is under the one active key with no rotation staged. A
 * mapping written under any other key would outlive the rotation unmatched.
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
    .for('update')
  const activeKey = keyRows.find((row) => row.state === 'active')
  return (
    activeKey != null &&
    activeKey.keyVersion === observation.subjects[0].keyVersion &&
    !keyRows.some((row) => row.state === 'trusted_next')
  )
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

export type SubjectSightingOutcome = 'linked' | 'already_mapped' | 'key_rotating'

/**
 * Map a review stored outside a snapshot run, if nothing maps it yet. It is
 * linked with no run, seen at this transaction's instant: a run that started
 * earlier never judges it missing (`last_observed_at <= started_at`), and
 * removal still needs two listings and a direct read that agree it is gone.
 * Any existing mapping of the locator or of the review wins untouched, and
 * nothing is written while a key rotation is staged.
 */
export async function recordSubjectSighting(
  tx: Tx,
  scope: SubjectLinkScope,
  observation: SubjectLinkObservation,
): Promise<SubjectSightingOutcome> {
  if (!(await activeSubjectKeyHolds(tx, observation))) return 'key_rotating'
  const matches = await findSubjectMatches(tx, scope, observation)
  if (matches.length > 0) return 'already_mapped'
  const inserted = await tx
    .insert(reviewProviderSubjects)
    .values(linkedSubjectValues(scope, observation, null))
    .onConflictDoNothing()
    .returning({ reviewId: reviewProviderSubjects.reviewId })
  return inserted.length > 0 ? 'linked' : 'already_mapped'
}

/**
 * The sightings recorder head checks and targeted reads share. It never
 * throws: the review is already stored, and the next full listing maps it if
 * this could not.
 */
export const createReviewProviderSubjectSightings = (
  db: Database,
  logger: Pick<LoggerPort, 'warn'>,
): ReviewProviderSubjectSightings => ({
  record: async (sighting: ReviewProviderSubjectSighting) =>
    trace('review.providerSubject.recordSighting', async () => {
      try {
        return await db.transaction((tx) => recordSubjectSighting(tx, sighting, sighting))
      } catch {
        logger.warn(
          { event: 'review_provider_subject_sighting_not_recorded' },
          'A stored review could not be mapped to its provider subject',
        )
        return 'unavailable' as const
      }
    }),
})
