// Test seed — a Portal's live Immersive Hub version (schema 3) written as a
// snapshot row and its open activation, so a suite can prove what reads the live
// version without running a publication. Not imported by production code.

import { getDb } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { immersiveSnapshot } from '../../application/__fixtures__/immersive-snapshot'
import type { ImmersivePortalPublicationConfiguration } from '../../domain/portal-publication-snapshot'
import { snapshotToRow } from '../portal-publication-commands'

export type LiveImmersiveSeed = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  configuration: ImmersivePortalPublicationConfiguration
  at?: Date
}>

const SNAPSHOT_ID = 'f4000000-0000-4000-8000-000000000001'
const ACTIVATION_ID = 'f5000000-0000-4000-8000-000000000001'

export async function seedLiveImmersiveSnapshot(seed: LiveImmersiveSeed): Promise<void> {
  const at = seed.at ?? new Date('2026-09-30T09:00:00.000Z')
  const snapshot = immersiveSnapshot(seed.configuration, {
    id: SNAPSHOT_ID,
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    version: 1,
    createdAt: at,
  })
  const db = getDb()
  await db.insert(portalPublicationSnapshots).values(snapshotToRow(snapshot))
  await db.insert(portalPublicationActivations).values({
    id: ACTIVATION_ID,
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    snapshotId: snapshot.id,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: 'manager-live-seed',
    activatedAt: at,
    deactivatedAt: null,
    deactivationReason: null,
  })
}
