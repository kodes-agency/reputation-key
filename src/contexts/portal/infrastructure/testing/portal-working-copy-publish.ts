// Test-only: publish a Portal from a working-copy source through the real
// command store. Used by the suites that prove what the working-copy reader, the
// in-transaction verification and the history comparison agree on (the History
// probe is src/shared/testing/portal-history-probe.ts). Not imported by
// production code.

import { getDb } from '#/shared/db'
import {
  userId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { buildPortalPublicationSnapshot } from '../../application/portal-publication-snapshot'
import { workingCopyMatchesSnapshot } from '../../application/portal-working-copy-match'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import { portalPublicationPublished, portalUpdated } from '../../domain/events'
import { createAtomicPortalCommandStore } from '../portal-command-store'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'

const PUBLISHING_MANAGER = userId('manager-workingcopy-0000000000001')
/** When the seeds were written, which is the Portal's `updated_at` a publish expects. */
const WORKING_COPY_SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')
const WORKING_COPY_PUBLISHED_AT = new Date('2026-08-26T11:00:00.000Z')

const DESTINATION = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=working-copy',
  retrievedAt: WORKING_COPY_SEEDED_AT,
  sourceEpoch: 1,
  profileVersion: 1,
} as const

type PublishedPortal = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
}>

/** The last twelve hex digits of an id, which make the version's own ids unique per Portal. */
const idTail = (value: string) => value.slice(-12)

/**
 * Commits `source` as the Portal's first version and makes it live, the way a
 * publication does: through `updatePortal`, which verifies the snapshot against
 * the rows it is committed beside. Rejects with `revision_conflict` when the
 * working copy moved after `source` was read.
 */
export async function publishFromSource(
  portal: PublishedPortal,
  source: PortalPublicationSource,
): Promise<void> {
  const snapshot = buildPortalPublicationSnapshot({
    id: `6d000000-0000-4000-8000-${idTail(portal.portalId)}`,
    portalId: portal.portalId,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: 1,
    source,
    destination: DESTINATION,
    createdBy: PUBLISHING_MANAGER,
    createdAt: WORKING_COPY_PUBLISHED_AT,
  })
  await createAtomicPortalCommandStore(getDb()).updatePortal({
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.portalId,
    actorUserId: PUBLISHING_MANAGER,
    expectedUpdatedAt: WORKING_COPY_SEEDED_AT,
    revision: WORKING_COPY_PUBLISHED_AT,
    occurredAt: WORKING_COPY_PUBLISHED_AT,
    patch: { publicationState: 'published' },
    publication: {
      kind: 'publish',
      snapshot,
      activation: {
        id: `6e000000-0000-4000-8000-${idTail(portal.portalId)}`,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.portalId,
        snapshotId: snapshot.id,
        activationSequence: 1,
        kind: 'publish',
        activatedBy: PUBLISHING_MANAGER,
        activatedAt: WORKING_COPY_PUBLISHED_AT,
        deactivatedAt: null,
        deactivationReason: null,
      },
    },
    lifecycleEvent: portalPublicationPublished({
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.portalId,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      userId: PUBLISHING_MANAGER,
      sourceAggregateVersion: WORKING_COPY_PUBLISHED_AT.toISOString(),
      occurredAt: WORKING_COPY_PUBLISHED_AT,
    }),
    event: portalUpdated({
      portalId: portal.portalId,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      previousPublicationState: 'draft',
      publicationState: 'published',
      sourceAggregateVersion: WORKING_COPY_PUBLISHED_AT.toISOString(),
      occurredAt: WORKING_COPY_PUBLISHED_AT,
    }),
  })
}

const WORKING_COPY_REPUBLISHED_AT = new Date('2026-08-26T13:00:00.000Z')

/**
 * Commits `source` as the Portal's second version and makes it live in place of
 * the first, the way a republication does.
 */
export async function republishFromSource(
  portal: PublishedPortal,
  source: PortalPublicationSource,
): Promise<void> {
  const snapshot = buildPortalPublicationSnapshot({
    id: `6d100000-0000-4000-8000-${idTail(portal.portalId)}`,
    portalId: portal.portalId,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: 2,
    source,
    destination: DESTINATION,
    createdBy: PUBLISHING_MANAGER,
    createdAt: WORKING_COPY_REPUBLISHED_AT,
  })
  await createAtomicPortalCommandStore(getDb()).republishPortal({
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.portalId,
    actorUserId: PUBLISHING_MANAGER,
    expectedUpdatedAt: WORKING_COPY_PUBLISHED_AT,
    revision: WORKING_COPY_REPUBLISHED_AT,
    occurredAt: WORKING_COPY_REPUBLISHED_AT,
    snapshot,
    activation: {
      id: `6e100000-0000-4000-8000-${idTail(portal.portalId)}`,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.portalId,
      snapshotId: snapshot.id,
      activationSequence: 2,
      kind: 'publish',
      activatedBy: PUBLISHING_MANAGER,
      activatedAt: WORKING_COPY_REPUBLISHED_AT,
      deactivatedAt: null,
      deactivationReason: null,
    },
    lifecycleEvent: portalPublicationPublished({
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.portalId,
      publicationSnapshotId: snapshot.id,
      publicationVersion: snapshot.version,
      publicationDigest: snapshot.configurationDigest,
      userId: PUBLISHING_MANAGER,
      sourceAggregateVersion: WORKING_COPY_REPUBLISHED_AT.toISOString(),
      occurredAt: WORKING_COPY_REPUBLISHED_AT,
    }),
    event: portalUpdated({
      portalId: portal.portalId,
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: WORKING_COPY_REPUBLISHED_AT.toISOString(),
      occurredAt: WORKING_COPY_REPUBLISHED_AT,
    }),
  })
}

/**
 * Whether the Portal's working copy says something other than its live version:
 * the question History's pending test and Review's "nothing to publish" both
 * put to `workingCopyMatchesSnapshot`.
 */
export async function workingCopyDiffersFromLive(
  portal: PublishedPortal,
): Promise<boolean> {
  const repo = createPortalPublicationRepository(getDb())
  const [source, live] = await Promise.all([
    repo.loadWorkingCopy(portal.organizationId, portal.portalId),
    repo.findActiveForPortal(portal.organizationId, portal.portalId),
  ])
  if (!source || !live) throw new Error('the Portal is not live or has no working copy')
  return !workingCopyMatchesSnapshot(source, live)
}
