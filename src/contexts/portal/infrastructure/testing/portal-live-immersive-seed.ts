// Test seed — a Portal's Immersive Hub version (schema 3) written as a snapshot
// row and its activation (open: the live version; replaced: an earlier one), so
// a suite can prove what reads a version without running a publication. Not
// imported by production code.

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
  /** The version number; 1 unless a suite seeds several. It also makes the row ids unique. */
  version?: number
  /** `open` (the default) is the live version; `replaced` one a later version replaced. */
  activation?: 'open' | 'replaced'
}>

const idOf = (kind: string, version: number) =>
  `${kind}000000-0000-4000-8000-${String(version).padStart(12, '0')}`

export async function seedLiveImmersiveSnapshot(seed: LiveImmersiveSeed): Promise<void> {
  const at = seed.at ?? new Date('2026-09-30T09:00:00.000Z')
  const version = seed.version ?? 1
  const snapshot = immersiveSnapshot(seed.configuration, {
    id: idOf('f4', version),
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    version,
    createdAt: at,
  })
  const open = (seed.activation ?? 'open') === 'open'
  const db = getDb()
  await db.insert(portalPublicationSnapshots).values(snapshotToRow(snapshot))
  await db.insert(portalPublicationActivations).values({
    id: idOf('f5', version),
    organizationId: seed.organizationId,
    propertyId: seed.propertyId,
    portalId: seed.portalId,
    snapshotId: snapshot.id,
    activationSequence: version,
    kind: 'publish',
    activatedBy: 'manager-live-seed',
    activatedAt: at,
    deactivatedAt: open ? null : new Date(at.getTime() + 1),
    deactivationReason: open ? null : 'replaced',
  })
}
