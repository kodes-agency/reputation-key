// Database adapter for the RecognitionLookupPort.
//
// `goal.completed` and `badge.awarded` carry ids only, so without this seam a
// recognition notification can say no more than "Goal completed" — and the
// badge handler used to paste the raw badge-definition UUID into the body to
// compensate. Reads the registered display names ADR 0046 r.8 permits and
// nothing else: no criteria, no award history, no person.
//
// `goals.property_id`, `portals.property_id` and `portal_groups.property_id`
// are all uuid, so these joins compare uuid to uuid (unlike inbox_items).
import type { Database } from '#/shared/db'
import { and, eq, isNull } from 'drizzle-orm'
import { badgeDefinitions } from '#/shared/db/schema/badge.schema'
import { goals } from '#/shared/db/schema/goal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import {
  unbrand,
  type BadgeId,
  type GoalId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
} from '#/shared/domain/ids'
import type {
  BadgeFacts,
  GoalFacts,
} from '../../application/ports/recognition-lookup.port'

/** The award target: a portal or a portal group, each named by its own table. */
type BadgeTarget =
  | Readonly<{ kind: 'portal'; id: PortalId }>
  | Readonly<{ kind: 'portal_group'; id: PortalGroupId }>

export const createRecognitionLookupAdapter = (db: Database) => {
  const readTargetName = async (
    target: BadgeTarget,
    orgId: OrganizationId,
  ): Promise<string | null> => {
    if (target.kind === 'portal') {
      const rows = await db
        .select({ name: portals.name })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, unbrand(orgId)),
            eq(portals.id, unbrand(target.id)),
            isNull(portals.deletedAt),
          ),
        )
        .limit(1)
      return rows[0]?.name ?? null
    }
    const rows = await db
      .select({ name: portalGroups.name })
      .from(portalGroups)
      .where(
        and(
          eq(portalGroups.organizationId, unbrand(orgId)),
          eq(portalGroups.id, unbrand(target.id)),
          isNull(portalGroups.deletedAt),
        ),
      )
      .limit(1)
    return rows[0]?.name ?? null
  }

  return {
    async findGoalFacts(
      goalIdValue: GoalId,
      orgId: OrganizationId,
    ): Promise<GoalFacts | null> {
      const rows = await db
        .select({ goalName: goals.name, propertyName: properties.name })
        .from(goals)
        .leftJoin(
          properties,
          and(
            eq(properties.organizationId, goals.organizationId),
            eq(properties.id, goals.propertyId),
          ),
        )
        .where(
          and(
            eq(goals.organizationId, unbrand(orgId)),
            eq(goals.id, unbrand(goalIdValue)),
          ),
        )
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return { goalName: row.goalName, propertyName: row.propertyName ?? null }
    },

    async findBadgeFacts(
      input: Readonly<{
        badgeDefinitionId: BadgeId
        target: BadgeTarget
        orgId: OrganizationId
      }>,
    ): Promise<BadgeFacts | null> {
      // badge_definitions is a global catalogue (no organization_id): the
      // tenant boundary for this notification is the award target, which is
      // org-scoped below.
      const [definitions, recipientName] = await Promise.all([
        db
          .select({ name: badgeDefinitions.name })
          .from(badgeDefinitions)
          .where(eq(badgeDefinitions.id, unbrand(input.badgeDefinitionId)))
          .limit(1),
        readTargetName(input.target, input.orgId),
      ])
      const definition = definitions[0]
      if (!definition) return null
      return { badgeName: definition.name, recipientName }
    },
  }
}
