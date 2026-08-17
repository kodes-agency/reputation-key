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

export function createPropertyProcessingProfileAdapter(
  db: Database,
  runtimeCatalogue: AiRuntimeCataloguePort,
): PropertyProcessingProfilePort {
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
        propertyRoutingPolicyVersion: properties.routingPolicyVersion,
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
    if (row.propertyCountryCode === null || row.propertySourceEpoch < 1) {
      return { status: 'policy_unavailable' }
    }
    const cell = resolveAiProcessingCell({
      countryCode: row.propertyCountryCode,
      timezone: row.propertyTimezone,
    })
    if (cell.status === 'policy_unavailable' || row.profileVersion === null) {
      return { status: 'policy_unavailable' }
    }
    if (row.profileSourceEpoch !== row.propertySourceEpoch) {
      return { status: 'source_epoch_changed' }
    }
    if (row.profileRoutingPolicyVersion !== row.propertyRoutingPolicyVersion) {
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
          routingPolicyVersion: properties.routingPolicyVersion,
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
      if (property.countryCode === null || property.sourceEpoch < 1) {
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
        existing.routingPolicyVersion === property.routingPolicyVersion &&
        existing.providerDeploymentProfileVersion ===
          cell.providerDeploymentProfileVersion &&
        existing.sourceEpoch === property.sourceEpoch &&
        existing.lifecycleState === 'active'
      const profileVersion = unchanged
        ? existing.profileVersion
        : (existing?.profileVersion ?? 0) + 1
      const updatedAt = new Date()

      if (!unchanged) {
        await tx
          .insert(aiPropertyProcessingProfiles)
          .values({
            propertyId: input.propertyId,
            organizationId: input.organizationId,
            countryCode: property.countryCode,
            timezone: property.timezone,
            processingRegion: cell.processingRegion,
            routingPolicyVersion: property.routingPolicyVersion,
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
              routingPolicyVersion: property.routingPolicyVersion,
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
          routingPolicyVersion: property.routingPolicyVersion,
          sourceEpoch: property.sourceEpoch,
          profileVersion,
          lifecycleState: 'active',
        },
      }
    })
  }

  return { readForAi, refreshForAi }
}
