import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiPropertyProcessingProfiles, properties } from '#/shared/db/schema'
import type { AiPropertyProfileResult } from '../../domain/types'
import { resolveAiProcessingCell } from '../../domain/rules'
import type { PropertyProcessingProfilePort } from '../../application/ports/property-processing-profile.port'
import type { AiRuntimeCataloguePort } from '../../application/ports/ai-runtime-catalogue.port'

function compareExpected(
  result: Extract<AiPropertyProfileResult, Readonly<{ status: 'available' }>>,
  expected:
    | Readonly<{
        sourceEpoch: number
        propertyProfileVersion: number
        routingPolicyVersion: number
      }>
    | undefined,
): AiPropertyProfileResult {
  if (!expected) return result
  if (result.profile.sourceEpoch !== expected.sourceEpoch) {
    return { status: 'source_epoch_changed' }
  }
  if (result.profile.profileVersion !== expected.propertyProfileVersion) {
    return { status: 'property_profile_changed' }
  }
  if (result.profile.routingPolicyVersion !== expected.routingPolicyVersion) {
    return { status: 'routing_policy_changed' }
  }
  return result
}

export const createPropertyProcessingProfileAdapter = (
  db: Database,
  runtimeCatalogue: AiRuntimeCataloguePort,
  clock: () => Date,
): PropertyProcessingProfilePort => {
  const readForAi: PropertyProcessingProfilePort['readForAi'] = async (input) => {
    if (!(await runtimeCatalogue.assertComplete()))
      return { status: 'policy_unavailable' }
    const [row] = await db
      .select({
        propertyOrganizationId: properties.organizationId,
        propertyId: properties.id,
        propertyCountryCode: properties.countryCode,
        propertyTimezone: properties.timezone,
        propertySourceEpoch: properties.sourceEpoch,
        propertyLifecycleState: properties.lifecycleState,
        profileOrganizationId: aiPropertyProcessingProfiles.organizationId,
        profileCountryCode: aiPropertyProcessingProfiles.countryCode,
        profileTimezone: aiPropertyProcessingProfiles.timezone,
        profileProcessingRegion: aiPropertyProcessingProfiles.processingRegion,
        profileRoutingPolicyVersion: aiPropertyProcessingProfiles.routingPolicyVersion,
        profileProviderVersion:
          aiPropertyProcessingProfiles.providerDeploymentProfileVersion,
        profileSourceEpoch: aiPropertyProcessingProfiles.sourceEpoch,
        profileVersion: aiPropertyProcessingProfiles.profileVersion,
        profileLifecycleState: aiPropertyProcessingProfiles.lifecycleState,
      })
      .from(properties)
      .leftJoin(
        aiPropertyProcessingProfiles,
        and(
          eq(aiPropertyProcessingProfiles.organizationId, properties.organizationId),
          eq(aiPropertyProcessingProfiles.propertyId, properties.id),
        ),
      )
      .where(
        and(
          eq(properties.organizationId, input.organizationId),
          eq(properties.id, input.propertyId),
          isNull(properties.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return { status: 'not_found' }
    if (row.propertyLifecycleState !== 'active') return { status: 'deleting' }
    // 0-based source epoch (drizzle/0060). Only a missing country blocks profile
    // resolution; the sibling guard in `refreshForAi` says the same.
    if (row.propertyCountryCode === null) {
      return { status: 'policy_unavailable' }
    }
    const cell = resolveAiProcessingCell({
      countryCode: row.propertyCountryCode,
      timezone: row.propertyTimezone,
    })
    if (cell.status === 'policy_unavailable') return { status: 'policy_unavailable' }

    const drifted =
      row.profileVersion === null ||
      row.profileSourceEpoch !== row.propertySourceEpoch ||
      row.profileRoutingPolicyVersion !== cell.routingPolicyVersion ||
      row.profileOrganizationId !== row.propertyOrganizationId ||
      row.profileCountryCode !== row.propertyCountryCode ||
      row.profileTimezone !== row.propertyTimezone ||
      row.profileProcessingRegion !== cell.processingRegion ||
      row.profileProviderVersion !== cell.providerDeploymentProfileVersion ||
      row.profileLifecycleState !== 'active'

    // Self-healing read. An unfenced read asks for the property's CURRENT AI
    // profile, and this adapter is the only writer of the row, so materialize
    // it here: otherwise a property that never had a row (or whose country,
    // timezone, source epoch or routing policy changed) resolves
    // `policy_unavailable` forever and every AI operation terminal-skips.
    // A FENCED read (expected supplied) must never self-heal — the caller is
    // checking for drift mid-operation and has to observe it.
    if (drifted && !input.expected) {
      return refreshForAi({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
      })
    }

    if (row.profileVersion === null) return { status: 'policy_unavailable' }
    if (row.profileSourceEpoch !== row.propertySourceEpoch) {
      return { status: 'source_epoch_changed' }
    }
    // Against the AI ROUTING policy the cell resolver applied, not against the
    // Property's data-cell CATALOGUE version. They are independent sequences —
    // the catalogue is at 3, the AI routing policy at 1 — and this column is a
    // foreign key into ai_routing_policies.
    if (row.profileRoutingPolicyVersion !== cell.routingPolicyVersion) {
      return { status: 'routing_policy_changed' }
    }
    if (
      row.profileOrganizationId !== row.propertyOrganizationId ||
      row.profileCountryCode !== row.propertyCountryCode ||
      row.profileTimezone !== row.propertyTimezone ||
      row.profileProcessingRegion !== cell.processingRegion ||
      row.profileProviderVersion !== cell.providerDeploymentProfileVersion ||
      row.profileLifecycleState !== 'active'
    ) {
      return { status: 'property_profile_changed' }
    }
    return compareExpected(
      {
        status: 'available',
        profile: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          countryCode: row.profileCountryCode,
          timezone: row.profileTimezone,
          processingRegion: 'global',
          routingPolicyVersion: row.profileRoutingPolicyVersion,
          sourceEpoch: row.profileSourceEpoch,
          profileVersion: row.profileVersion,
          lifecycleState: 'active',
        },
      },
      input.expected,
    )
  }

  const refreshForAi: PropertyProcessingProfilePort['refreshForAi'] = async (input) => {
    if (!(await runtimeCatalogue.assertComplete()))
      return { status: 'policy_unavailable' }
    return db.transaction(async (tx) => {
      const [property] = await tx
        .select({
          organizationId: properties.organizationId,
          id: properties.id,
          countryCode: properties.countryCode,
          timezone: properties.timezone,
          sourceEpoch: properties.sourceEpoch,
          lifecycleState: properties.lifecycleState,
        })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1)
        .for('update')

      if (!property) return { status: 'not_found' }
      if (property.lifecycleState !== 'active') return { status: 'deleting' }
      // Source epoch is a 0-based generation tag (see drizzle/0060): a property
      // that has never been edited sits at 0 and is perfectly eligible. Only a
      // missing country blocks profile resolution.
      if (property.countryCode === null) {
        return { status: 'policy_unavailable' }
      }
      const cell = resolveAiProcessingCell({
        countryCode: property.countryCode,
        timezone: property.timezone,
      })
      if (cell.status === 'policy_unavailable') return cell

      const [existing] = await tx
        .select()
        .from(aiPropertyProcessingProfiles)
        .where(eq(aiPropertyProcessingProfiles.propertyId, input.propertyId))
        .limit(1)
        .for('update')

      const unchanged =
        existing !== undefined &&
        existing.organizationId === property.organizationId &&
        existing.countryCode === property.countryCode &&
        existing.timezone === property.timezone &&
        existing.processingRegion === cell.processingRegion &&
        existing.routingPolicyVersion === cell.routingPolicyVersion &&
        existing.providerDeploymentProfileVersion ===
          cell.providerDeploymentProfileVersion &&
        existing.sourceEpoch === property.sourceEpoch &&
        existing.lifecycleState === 'active'
      const profileVersion = unchanged
        ? existing.profileVersion
        : (existing?.profileVersion ?? 0) + 1
      const updatedAt = clock()

      if (!unchanged) {
        await tx
          .insert(aiPropertyProcessingProfiles)
          .values({
            propertyId: input.propertyId,
            organizationId: input.organizationId,
            countryCode: property.countryCode,
            timezone: property.timezone,
            processingRegion: cell.processingRegion,
            routingPolicyVersion: cell.routingPolicyVersion,
            providerDeploymentProfileVersion: cell.providerDeploymentProfileVersion,
            sourceEpoch: property.sourceEpoch,
            profileVersion,
            lifecycleState: 'active',
            updatedAt,
          })
          .onConflictDoUpdate({
            target: aiPropertyProcessingProfiles.propertyId,
            set: {
              organizationId: input.organizationId,
              countryCode: property.countryCode,
              timezone: property.timezone,
              processingRegion: cell.processingRegion,
              routingPolicyVersion: cell.routingPolicyVersion,
              providerDeploymentProfileVersion: cell.providerDeploymentProfileVersion,
              sourceEpoch: property.sourceEpoch,
              profileVersion,
              lifecycleState: 'active',
              updatedAt,
            },
          })
      }

      return {
        status: 'available',
        profile: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          countryCode: property.countryCode,
          timezone: property.timezone,
          processingRegion: 'global',
          routingPolicyVersion: cell.routingPolicyVersion,
          sourceEpoch: property.sourceEpoch,
          profileVersion,
          lifecycleState: 'active',
        },
      }
    })
  }

  return { readForAi, refreshForAi }
}
