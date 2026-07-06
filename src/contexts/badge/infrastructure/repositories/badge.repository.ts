// Badge context — Drizzle repository implementation

import { and, eq, inArray, isNull, isNotNull, or, sql, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import {
  badgeAwards,
  badgeDefinitions,
  organizationBadgeEnablements,
} from '#/shared/db/schema/badge.schema'
import { portals, portalGroupMembers } from '#/shared/db/schema/portal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  unbrand,
  unbrandAll,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { badgeError } from '../../domain/errors'
import type { BadgeRepository } from '../../application/ports/badge.repository'
import type { BadgeDefinition } from '../../domain/types'
import {
  badgeAwardFromRow,
  badgeAwardWithTargetFromRow,
  badgeDefinitionFromRow,
  organizationBadgeEnablementFromRow,
} from '../mappers/badge.mapper'

export const createBadgeRepository = (db: Database, clock: Clock): BadgeRepository => ({
  seedDefinitions: async (definitions) => {
    return trace('badge.seedDefinitions', async () => {
      const now = clock()
      const inserted: BadgeDefinition[] = []

      for (const definition of definitions) {
        const rows = await db
          .insert(badgeDefinitions)
          .values({
            key: definition.key,
            name: definition.name,
            description: definition.description,
            icon: definition.icon,
            targetScope: definition.targetScope,
            criteriaVersion: definition.criteriaVersion ?? 1,
            criteriaJson: definition.criteria,
            enabled: definition.enabled ?? true,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: badgeDefinitions.key,
            set: {
              name: definition.name,
              description: definition.description,
              icon: definition.icon,
              targetScope: definition.targetScope,
              criteriaVersion: definition.criteriaVersion ?? 1,
              criteriaJson: definition.criteria,
              updatedAt: now,
            },
          })
          .returning()

        if (!rows[0]) {
          throw badgeError('repo_insert_failed', 'Badge definition upsert failed')
        }
        inserted.push(badgeDefinitionFromRow(rows[0]))
      }

      return inserted
    })
  },

  findDefinitionByKey: async (key) => {
    return trace('badge.findDefinitionByKey', async () => {
      const row = await db
        .select()
        .from(badgeDefinitions)
        .where(and(eq(badgeDefinitions.key, key), eq(badgeDefinitions.enabled, true)))
        .limit(1)
      return row[0] ? badgeDefinitionFromRow(row[0]) : null
    })
  },

  listEnabledDefinitionsForOrg: async (orgId) => {
    return trace('badge.listEnabledDefinitionsForOrg', async () => {
      const rows = await db
        .select({
          definition: badgeDefinitions,
          enablement: organizationBadgeEnablements,
        })
        .from(badgeDefinitions)
        .leftJoin(
          organizationBadgeEnablements,
          and(
            eq(organizationBadgeEnablements.organizationId, unbrand(orgId)),
            eq(organizationBadgeEnablements.badgeDefinitionId, badgeDefinitions.id),
          ),
        )
        .where(
          and(
            eq(badgeDefinitions.enabled, true),
            or(
              isNull(organizationBadgeEnablements.id),
              eq(organizationBadgeEnablements.enabled, true),
            ),
          ),
        )
        .orderBy(desc(badgeDefinitions.name))

      return rows.map((row) => badgeDefinitionFromRow(row.definition))
    })
  },
  listDefinitionsWithEnablement: async (orgId) => {
    return trace('badge.listDefinitionsWithEnablement', async () => {
      const rows = await db
        .select({
          definition: badgeDefinitions,
          enablement: organizationBadgeEnablements,
        })
        .from(badgeDefinitions)
        .leftJoin(
          organizationBadgeEnablements,
          and(
            eq(organizationBadgeEnablements.organizationId, unbrand(orgId)),
            eq(organizationBadgeEnablements.badgeDefinitionId, badgeDefinitions.id),
          ),
        )
        .where(eq(badgeDefinitions.enabled, true))
        .orderBy(desc(badgeDefinitions.name))

      return rows.map((row) => ({
        definition: badgeDefinitionFromRow(row.definition),
        orgEnabled: row.enablement?.enabled ?? true,
      }))
    })
  },

  findDefinition: async (orgId, id) => {
    return trace('badge.findDefinition', async () => {
      const rows = await db
        .select({
          definition: badgeDefinitions,
          enablement: organizationBadgeEnablements,
        })
        .from(badgeDefinitions)
        .leftJoin(
          organizationBadgeEnablements,
          and(
            eq(organizationBadgeEnablements.organizationId, unbrand(orgId)),
            eq(organizationBadgeEnablements.badgeDefinitionId, badgeDefinitions.id),
          ),
        )
        .where(
          and(
            eq(badgeDefinitions.id, unbrand(id)),
            eq(badgeDefinitions.enabled, true),
            or(
              isNull(organizationBadgeEnablements.id),
              eq(organizationBadgeEnablements.enabled, true),
            ),
          ),
        )
        .limit(1)
      return rows[0] ? badgeDefinitionFromRow(rows[0].definition) : null
    })
  },

  listOrgIdsWithBadges: async () => {
    return trace('badge.listOrgIdsWithBadges', async () => {
      const rows = await db
        .selectDistinct({ organizationId: badgeAwards.organizationId })
        .from(badgeAwards)
      return rows.map((row) => organizationId(row.organizationId))
    })
  },

  setOrganizationEnablement: async (orgId, badgeDefinitionId, enabled) => {
    return trace('badge.setOrganizationEnablement', async () => {
      const now = clock()
      const rows = await db
        .insert(organizationBadgeEnablements)
        .values({
          organizationId: unbrand(orgId),
          badgeDefinitionId: unbrand(badgeDefinitionId),
          enabled,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            organizationBadgeEnablements.organizationId,
            organizationBadgeEnablements.badgeDefinitionId,
          ],
          set: { enabled, updatedAt: now },
        })
        .returning()
      if (!rows[0]) {
        throw badgeError('repo_insert_failed', 'Badge enablement upsert failed')
      }
      return organizationBadgeEnablementFromRow(rows[0])
    })
  },

  isOrgDefinitionEnabled: async (orgId, badgeDefinitionId) => {
    return trace('badge.isOrgDefinitionEnabled', async () => {
      const rows = await db
        .select()
        .from(organizationBadgeEnablements)
        .where(
          and(
            eq(organizationBadgeEnablements.organizationId, unbrand(orgId)),
            eq(
              organizationBadgeEnablements.badgeDefinitionId,
              unbrand(badgeDefinitionId),
            ),
          ),
        )
        .limit(1)
      return rows[0]?.enabled ?? true
    })
  },

  findAwardByUniqueKey: async (uniqueKey) => {
    return trace('badge.findAwardByUniqueKey', async () => {
      const rows = await db
        .select()
        .from(badgeAwards)
        .where(eq(badgeAwards.uniqueKey, uniqueKey))
        .limit(1)
      return rows[0] ? badgeAwardFromRow(rows[0]) : null
    })
  },

  insertAward: async (input) => {
    return trace('badge.insertAward', async () => {
      const rows = await db
        .insert(badgeAwards)
        .values({
          id: unbrand(input.id),
          badgeDefinitionId: unbrand(input.badgeDefinitionId),
          criteriaVersion: input.criteriaVersion,
          targetType: input.targetType,
          targetId: unbrand(input.targetId),
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          portalId: input.portalId ? unbrand(input.portalId) : null,
          portalGroupId: input.portalGroupId ? unbrand(input.portalGroupId) : null,
          awardedAt: input.awardedAt,
          uniqueKey: input.uniqueKey,
          createdAt: input.createdAt,
        })
        .returning()
      if (!rows[0]) {
        throw badgeError('repo_insert_failed', 'Badge award insert failed')
      }
      return badgeAwardFromRow(rows[0])
    })
  },

  listTargetAwards: async (input) => {
    return trace('badge.listTargetAwards', async () => {
      const rows = await db
        .select({
          award: badgeAwards,
          definitionKey: badgeDefinitions.key,
          definitionName: badgeDefinitions.name,
          definitionIcon: badgeDefinitions.icon,
          definitionDescription: badgeDefinitions.description,
          definitionCriteria: badgeDefinitions.criteriaJson,
          definitionTargetScope: badgeDefinitions.targetScope,
          definitionCriteriaVersion: badgeDefinitions.criteriaVersion,
          definitionEnabled: badgeDefinitions.enabled,
          definitionCreatedAt: badgeDefinitions.createdAt,
          definitionUpdatedAt: badgeDefinitions.updatedAt,
          targetLabel: sql<string>`COALESCE(${portals.name}, ${portalGroups.name})`,
        })
        .from(badgeAwards)
        .innerJoin(
          badgeDefinitions,
          eq(badgeDefinitions.id, badgeAwards.badgeDefinitionId),
        )
        .leftJoin(portals, eq(portals.id, badgeAwards.portalId))
        .leftJoin(portalGroups, eq(portalGroups.id, badgeAwards.portalGroupId))
        .where(
          and(
            eq(badgeAwards.organizationId, unbrand(input.organizationId)),
            eq(badgeAwards.propertyId, unbrand(input.propertyId)),
            eq(badgeAwards.targetType, input.targetType),
            eq(badgeAwards.targetId, unbrand(input.targetId)),
          ),
        )
        .orderBy(desc(badgeAwards.awardedAt))
        .limit(20)

      return rows.map(badgeAwardWithTargetFromRow)
    })
  },

  listStaffAwards: async (input) => {
    return trace('badge.listStaffAwards', async () => {
      const assignmentRows = await db
        .selectDistinct({ portalId: staffAssignments.portalId })
        .from(staffAssignments)
        .where(
          and(
            eq(staffAssignments.organizationId, unbrand(input.organizationId)),
            eq(staffAssignments.userId, unbrand(input.userId)),
            eq(staffAssignments.propertyId, unbrand(input.propertyId)),
            isNull(staffAssignments.deletedAt),
            isNotNull(staffAssignments.portalId),
          ),
        )

      const portalIds = assignmentRows
        .map((row) => row.portalId)
        .filter((id): id is string => !!id)

      const groupRows =
        portalIds.length > 0
          ? await db
              .selectDistinct({ portalGroupId: portalGroupMembers.portalGroupId })
              .from(portalGroupMembers)
              .where(inArray(portalGroupMembers.portalId, portalIds))
          : []

      const groupIds = groupRows.map((row) => row.portalGroupId)
      if (portalIds.length === 0 && groupIds.length === 0) {
        return []
      }

      // Each award carries exactly one of portalId / portalGroupId (the other
      // is null), so the portal and group predicates must be OR-combined — an
      // AND would match no row. orgId/propertyId stay AND-scoped.
      const targetPredicates = [
        ...(portalIds.length > 0 ? [inArray(badgeAwards.portalId, portalIds)] : []),
        ...(groupIds.length > 0
          ? [inArray(badgeAwards.portalGroupId, unbrandAll(groupIds))]
          : []),
      ]
      const targetMatch =
        targetPredicates.length > 1
          ? or(...targetPredicates)
          : (targetPredicates[0] ?? sql`false`)

      const rows = await db
        .select({
          award: badgeAwards,
          definitionKey: badgeDefinitions.key,
          definitionName: badgeDefinitions.name,
          definitionIcon: badgeDefinitions.icon,
          definitionDescription: badgeDefinitions.description,
          definitionCriteria: badgeDefinitions.criteriaJson,
          definitionTargetScope: badgeDefinitions.targetScope,
          definitionCriteriaVersion: badgeDefinitions.criteriaVersion,
          definitionEnabled: badgeDefinitions.enabled,
          definitionCreatedAt: badgeDefinitions.createdAt,
          definitionUpdatedAt: badgeDefinitions.updatedAt,
          targetLabel: sql<string>`COALESCE(${portals.name}, ${portalGroups.name})`,
        })
        .from(badgeAwards)
        .innerJoin(
          badgeDefinitions,
          eq(badgeDefinitions.id, badgeAwards.badgeDefinitionId),
        )
        .leftJoin(portals, eq(portals.id, badgeAwards.portalId))
        .leftJoin(portalGroups, eq(portalGroups.id, badgeAwards.portalGroupId))
        .where(
          and(
            eq(badgeAwards.organizationId, unbrand(input.organizationId)),
            eq(badgeAwards.propertyId, unbrand(input.propertyId)),
            targetMatch,
          ),
        )
        .orderBy(desc(badgeAwards.awardedAt))
        .limit(input.limit ?? 10)

      return rows.map(badgeAwardWithTargetFromRow)
    })
  },

  resolveStaffVisibility: async (input) => {
    return trace('badge.resolveStaffVisibility', async () => {
      // Any non-deleted assignment to (org, user, property) grants property-level
      // access (PropertyManager). portalId may be null on a property-only
      // assignment, so we don't require it here — unlike listStaffAwards, which
      // only wants portal-scoped awards.
      const assignmentRows = await db
        .selectDistinct({ portalId: staffAssignments.portalId })
        .from(staffAssignments)
        .where(
          and(
            eq(staffAssignments.organizationId, unbrand(input.organizationId)),
            eq(staffAssignments.userId, unbrand(input.userId)),
            eq(staffAssignments.propertyId, unbrand(input.propertyId)),
            isNull(staffAssignments.deletedAt),
          ),
        )

      const hasPropertyAssignment = assignmentRows.length > 0
      const portalIds = assignmentRows
        .map((row) => row.portalId)
        .filter((id): id is string => !!id)

      // Resolve the portal groups that contain this staff member's assigned
      // portals — Staff may view badges for those groups too.
      const groupRows =
        portalIds.length > 0
          ? await db
              .selectDistinct({ portalGroupId: portalGroupMembers.portalGroupId })
              .from(portalGroupMembers)
              .where(inArray(portalGroupMembers.portalId, portalIds))
          : []

      return {
        hasPropertyAssignment,
        portalIds: portalIds.map((id) => portalId(id)),
        groupIds: groupRows.map((row) => portalGroupId(row.portalGroupId)),
      }
    })
  },

  listPropertiesForOrg: async (orgId) => {
    return trace('badge.listPropertiesForOrg', async () => {
      const rows = await db
        .selectDistinct({ propertyId: portals.propertyId })
        .from(portals)
        .where(and(eq(portals.organizationId, unbrand(orgId)), isNull(portals.deletedAt)))
      return rows.map((row) => propertyId(row.propertyId))
    })
  },

  listPortalTargets: async (orgId, propertyIdValue) => {
    return trace('badge.listPortalTargets', async () => {
      const rows = await db
        .select({ id: portals.id })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, unbrand(orgId)),
            eq(portals.propertyId, unbrand(propertyIdValue)),
            isNull(portals.deletedAt),
          ),
        )
      return rows.map((row) => portalId(row.id))
    })
  },

  listGroupTargets: async (orgId, propertyIdValue) => {
    return trace('badge.listGroupTargets', async () => {
      const rows = await db
        .select({ id: portalGroups.id })
        .from(portalGroups)
        .where(
          and(
            eq(portalGroups.organizationId, unbrand(orgId)),
            eq(portalGroups.propertyId, unbrand(propertyIdValue)),
            isNull(portalGroups.deletedAt),
          ),
        )
      return rows.map((row) => portalGroupId(row.id))
    })
  },

  findGroupForPortal: async (orgId, portalIdValue) => {
    return trace('badge.findGroupForPortal', async () => {
      const rows = await db
        .select({
          portalGroupId: portalGroupMembers.portalGroupId,
          propertyId: portals.propertyId,
        })
        .from(portalGroupMembers)
        .innerJoin(portals, eq(portals.id, portalGroupMembers.portalId))
        .where(
          and(
            eq(portalGroupMembers.portalId, unbrand(portalIdValue)),
            eq(portals.organizationId, unbrand(orgId)),
            isNull(portals.deletedAt),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row
        ? {
            portalGroupId: portalGroupId(row.portalGroupId),
            propertyId: propertyId(row.propertyId),
          }
        : null
    })
  },

  findPropertyTimezone: async (orgId, propertyIdValue) => {
    return trace('badge.findPropertyTimezone', async () => {
      const rows = await db
        .select({ timezone: properties.timezone })
        .from(properties)
        .where(
          and(
            eq(properties.id, unbrand(propertyIdValue)),
            eq(properties.organizationId, unbrand(orgId)),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1)
      return rows[0]?.timezone ?? 'UTC'
    })
  },

  queryDailyCounts: async (input) => {
    return trace('badge.queryDailyCounts', async () => {
      const scope =
        input.targetType === 'portal'
          ? input.portalId
            ? eq(metricReadings.portalId, unbrand(input.portalId))
            : sql`false`
          : input.portalGroupId
            ? eq(metricReadings.groupId, unbrand(input.portalGroupId))
            : sql`false`
      const rows = await db.execute(sql`
        SELECT date_trunc('day', ${metricReadings.occurredAt} AT TIME ZONE ${input.timezone}::text)::date AS day, COUNT(*)::int AS count
        FROM ${metricReadings}
        WHERE ${metricReadings.organizationId} = ${unbrand(input.organizationId)}
          AND ${metricReadings.propertyId} = ${unbrand(input.propertyId)}
          AND ${metricReadings.metricKey} = ${input.metricKey}
          AND ${scope}
          AND ${metricReadings.occurredAt} >= NOW() - (${input.days} * INTERVAL '1 day')
        GROUP BY 1
      `)

      const counts = new Map<string, number>()
      for (const row of rows.rows as Array<{
        day: string | Date
        count: number | string
      }>) {
        const day =
          row.day instanceof Date
            ? row.day.toISOString().slice(0, 10).replaceAll('-', '_')
            : new Date(row.day).toISOString().slice(0, 10).replaceAll('-', '_')
        counts.set(day, Number(row.count ?? 0))
      }
      return counts
    })
  },
})
