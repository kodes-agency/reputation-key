// Portal context — what a Property look edit reaches (ADR 0070).
//
// Every Brand Profile write that moved something is recorded here, inside the
// writer's transaction and under the Property's publication lock it already
// holds. The public display name is every Portal's, so a name change fences
// every Portal of the Property. A look facet reaches only the Portals that
// follow the group it belongs to: a Portal with its own colours never sees the
// Property's new accent, so it gets no pending change and its draft does not
// move. For each facet the fence opens on those followers alone, and each
// follower that has an override row has its effective look version moved once
// for the save (not once per facet), as the Brand Profile's own moves once.
//
// With no override rows every Portal follows everything, and the fence is the
// one every Portal with a snapshot got before Portals could have a look of
// their own. The Property-wide ledger row is written whoever follows: History
// keeps the edit even when no Portal shows it.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { portalLookOverrides } from '#/shared/db/schema/portal-look.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { unbrand, type OrganizationId, type PropertyId } from '#/shared/domain/ids'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { portalPropertyBrandProfileUpdated } from '../domain/events'
import {
  facetReachesPortal,
  lookSourcesOf,
  portalLookOverrideOf,
  PROPERTY_LOOK_SOURCES,
  type PortalLookSources,
} from '../domain/portal-look'
import { lookPendingKey, type LookFacet } from '../domain/property-look'
import { recordPortalContentChange } from './portal-page-edits'

export type PropertyScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** What a Brand Profile write moved, and so what it has to fence and announce. */
export type ProfileChange = Readonly<{
  /** The public display name changed, or the profile was just created. */
  nameChanged: boolean
  /** The display name before and after, kept in the page-edit ledger when it changed. */
  previousName: string | null
  displayName: string
  /** The facets of the look that changed. */
  facets: readonly LookFacet[]
  version: number
  lookVersion: number
  /** Who made the change; null when the system did (the automatic name). */
  actorUserId: string | null
}>

/** One Portal of the Property and where its look groups come from. */
type PortalLookFollowing = Readonly<{
  portalId: string
  /** Whether the Portal has an override row, whose version a Property edit it sees moves. */
  hasRow: boolean
  sources: PortalLookSources
}>

/**
 * Every Portal of the Property, archived and deleted ones too (they may have a
 * snapshot, and the fence decides by snapshot), with the sources of its look.
 */
async function propertyPortalLooks(
  tx: Tx,
  scope: PropertyScope,
): Promise<readonly PortalLookFollowing[]> {
  const rows = await tx
    .select({ portalId: portals.id, look: portalLookOverrides })
    .from(portals)
    .leftJoin(
      portalLookOverrides,
      and(
        eq(portalLookOverrides.organizationId, portals.organizationId),
        eq(portalLookOverrides.portalId, portals.id),
      ),
    )
    .where(
      and(
        eq(portals.organizationId, unbrand(scope.organizationId)),
        eq(portals.propertyId, unbrand(scope.propertyId)),
      ),
    )
  return rows.map(({ portalId, look }) => ({
    portalId,
    hasRow: look !== null,
    sources:
      look === null ? PROPERTY_LOOK_SOURCES : lookSourcesOf(portalLookOverrideOf(look)),
  }))
}

/**
 * Where a facet's fence opens: on every Portal with a snapshot when every
 * Portal follows it (the fence as it always was), else on its followers alone.
 * An empty list opens nothing.
 */
function fenceScopeOf(
  looks: readonly PortalLookFollowing[],
  facet: LookFacet,
): Readonly<{ portalIds?: readonly string[] }> {
  const followers = looks
    .filter((look) => facetReachesPortal(facet, look.sources))
    .map((look) => look.portalId)
  return followers.length === looks.length ? {} : { portalIds: followers }
}

/** The fence scope of one Property look facet, read under the caller's Property lock. */
export async function lookFenceScope(
  tx: Tx,
  scope: PropertyScope,
  facet: LookFacet,
): Promise<Readonly<{ portalIds?: readonly string[] }>> {
  return fenceScopeOf(await propertyPortalLooks(tx, scope), facet)
}

/**
 * Move the effective look version of every override row that follows at least
 * one of the changed facets, once for the whole save. Who last saved the row
 * stays: the Portal's own look did not change hands.
 */
async function bumpFollowerLookVersions(
  tx: Tx,
  scope: PropertyScope & Readonly<{ at: Date }>,
  looks: readonly PortalLookFollowing[],
  facets: readonly LookFacet[],
): Promise<void> {
  const followerIds = looks
    .filter(
      (look) =>
        look.hasRow && facets.some((facet) => facetReachesPortal(facet, look.sources)),
    )
    .map((look) => look.portalId)
  if (followerIds.length === 0) return
  await tx
    .update(portalLookOverrides)
    .set({
      lookVersion: sql`${portalLookOverrides.lookVersion} + 1`,
      updatedAt: scope.at,
    })
    .where(
      and(
        eq(portalLookOverrides.organizationId, unbrand(scope.organizationId)),
        eq(portalLookOverrides.propertyId, unbrand(scope.propertyId)),
        inArray(portalLookOverrides.portalId, followerIds),
      ),
    )
}

type FenceBase = Readonly<{
  organizationId: string
  propertyId: string
  kind: 'property_brand_profile'
  changedAt: Date
  actorUserId: string | null
}>

/** Each changed facet: one Property-wide ledger row, and the fence on the Portals that follow it. */
async function recordLookFacets(
  tx: Tx,
  input: PropertyScope & Readonly<{ at: Date }>,
  change: ProfileChange,
  fence: FenceBase,
): Promise<void> {
  // The facet list is final here, so a save of several facets moves a follower once.
  const looks = await propertyPortalLooks(tx, input)
  await bumpFollowerLookVersions(tx, input, looks, change.facets)
  for (const facet of change.facets) {
    await recordPortalContentChange(tx, {
      ...fence,
      ...fenceScopeOf(looks, facet),
      key: lookPendingKey(facet),
      ledger: [{ key: lookPendingKey(facet) }],
      sourceVersion: `v${change.lookVersion}`,
    })
  }
}

/**
 * Every Brand Profile write that moved something fences Portal publication:
 * a name change with one row under `all` (sourced at `version`), each look
 * facet with its own `look:<facet>` row (sourced at `lookVersion`) on the
 * Portals that follow it. The fact announces the profile version, which look
 * edits leave where it was.
 */
export async function recordPropertyProfileChange(
  tx: Tx,
  input: PropertyScope & Readonly<{ at: Date }>,
  change: ProfileChange,
): Promise<void> {
  const fence: FenceBase = {
    organizationId: unbrand(input.organizationId),
    propertyId: unbrand(input.propertyId),
    kind: 'property_brand_profile',
    changedAt: input.at,
    actorUserId: change.actorUserId,
  }
  if (change.nameChanged) {
    await recordPortalContentChange(tx, {
      ...fence,
      ledger: [
        { key: 'all', previousText: change.previousName, newText: change.displayName },
      ],
      sourceVersion: `v${change.version}`,
    })
  }
  if (change.facets.length > 0) await recordLookFacets(tx, input, change, fence)
  if (!change.nameChanged && change.facets.length === 0) return
  const event = portalPropertyBrandProfileUpdated({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    profileVersion: change.version,
    sourceAggregateVersion: input.at.toISOString(),
    occurredAt: input.at,
  })
  await insertOutboxRow(tx, event, { recordedAt: input.at })
}
