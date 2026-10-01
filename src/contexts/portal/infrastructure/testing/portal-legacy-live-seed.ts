// Test seed — a Portal's published version written the way the old writer wrote
// it (schema 1, or a row whose stored schema version says 2 or 3), with its
// activation. Publishing writes only version 3 now, so a legacy live Portal
// can only be had by seeding its rows.

import { getDb } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { buildLegacyPortalPublicationSnapshot } from '../../application/__fixtures__/legacy-snapshot-builder'
import { GOLDEN_BUILDER_INPUTS } from '../../application/__fixtures__/publication-snapshots.golden'
import { snapshotToRow } from '../portal-publication-commands'

export type LegacySnapshotSeed = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  /** Seeds the snapshot and activation identifiers; unique per Portal and version. */
  idTail: number
  version: number
  /**
   * The schema version stored on the row. 1 and 2 are what the old builder
   * wrote and verify as they are; 3 only relabels a v1 row, enough for a
   * selection (which reads the stored version) but not for a guest read.
   */
  schemaVersion: 1 | 2 | 3
  at: Date
  /** The activation stays open (the version is the live one) or closes with a reason. */
  activation: 'open' | 'replaced' | 'disabled' | 'archived'
  createdBy?: string
  name?: string
  slug?: string
}>

const tail = (kind: string, value: number) =>
  `${kind}000000-0000-4000-8000-${String(value).padStart(12, '0')}`

export async function seedLegacySnapshot(seed: LegacySnapshotSeed): Promise<void> {
  const createdBy = seed.createdBy ?? 'manager-legacy-seed'
  const snapshot = buildLegacyPortalPublicationSnapshot({
    id: tail('f2', seed.idTail * 10 + seed.version),
    portalId: seed.portalId,
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    version: seed.version,
    source: {
      portal: {
        id: seed.portalId,
        name: seed.name ?? 'Legacy portal',
        slug: seed.slug ?? `legacy-${seed.idTail}`,
        description: null,
        heroImageUrl: null,
        theme: null,
        organizationName: 'Org',
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: 3,
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      ...(seed.schemaVersion === 2
        ? { experience: GOLDEN_BUILDER_INPUTS.v2BgPrimary.source.experience }
        : {}),
    },
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=legacy-seed',
      retrievedAt: seed.at,
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy,
    createdAt: seed.at,
  })
  const row = snapshotToRow(snapshot)
  const db = getDb()
  await db
    .insert(portalPublicationSnapshots)
    .values(
      seed.schemaVersion === 3
        ? { ...row, configuration: { ...row.configuration, schemaVersion: 3 } as never }
        : row,
    )
  const open = seed.activation === 'open'
  await db.insert(portalPublicationActivations).values({
    id: tail('f3', seed.idTail * 10 + seed.version),
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    snapshotId: snapshot.id,
    activationSequence: seed.version,
    kind: 'publish',
    activatedBy: createdBy,
    activatedAt: seed.at,
    deactivatedAt: open ? null : new Date(seed.at.getTime() + 1),
    deactivationReason: open ? null : seed.activation,
  })
}
