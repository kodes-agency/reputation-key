// Leaderboard context — Drizzle repository implementation
//
// ADR 0008 §Decision 2 exception (LB-01):
// This repository directly queries the `metricReadings` (metric context),
// `portals` and `portalGroups` (portal context), and `properties` (property
// context) tables. Per ADR 0008 §Decision 2, cross-context SQL is acceptable in
// the infrastructure layer when isolated behind port interfaces. The
// LeaderboardRepository port defines the contract; this Drizzle adapter is the
// sole implementation. No domain or application layer imports reach across
// context boundaries.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  leaderboardEntries,
  leaderboardSnapshots,
} from '#/shared/db/schema/leaderboard.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import {
  type LeaderboardEntryId,
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  unbrand,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { Clock } from '#/shared/domain/clock'
import { leaderboardError } from '../../domain/errors'
import {
  PORTAL_METRICS,
  compositeScore,
  normalize,
  rank,
  type ScoredTarget,
} from '../../domain/scoring'
import { periodToRange, LEADERBOARD_PERIODS } from '../../application/utils'
import type { LeaderboardRepository } from '../../application/ports/leaderboard.repository'
import type {
  LeaderboardEntryWithTarget,
  LeaderboardMetricKey,
  LeaderboardPeriod,
  LeaderboardRefreshInput,
  LeaderboardReconcileResult,
  LeaderboardRowInput,
  LeaderboardScope,
} from '../../domain/types'
import { leaderboardEntryFromRow } from '../mappers/leaderboard.mapper'

export const createLeaderboardRepository = (
  db: Database,
  clock: Clock,
  idGen: () => LeaderboardEntryId,
): LeaderboardRepository => {
  const listPropertiesWithMetricEvents = async () => {
    return trace('leaderboard.listPropertiesWithMetricEvents', async () => {
      const rows = await db
        .selectDistinct({ propertyId: metricReadings.propertyId })
        .from(metricReadings)
        .where(sql`${metricReadings.occurredAt} >= NOW() - INTERVAL '90 days'`)
      return rows.map((row) => propertyId(row.propertyId))
    })
  }

  const listTargets = async (
    orgId: string,
    propertyIdValue: string,
    scope: LeaderboardScope,
  ): Promise<ReadonlyArray<LeaderboardRowInput>> => {
    return trace('leaderboard.listTargets', async () => {
      if (scope === 'portal') {
        const rows = await db
          .select({ id: portals.id })
          .from(portals)
          .where(
            and(
              eq(portals.organizationId, orgId),
              eq(portals.propertyId, propertyIdValue),
              isNull(portals.deletedAt),
            ),
          )
        return rows.map((row) => ({
          organizationId: organizationId(orgId),
          propertyId: propertyId(propertyIdValue),
          targetType: 'portal' as const,
          targetId: portalId(row.id),
          portalId: portalId(row.id),
          metricValue: 0,
        }))
      }

      const rows = await db
        .select({ id: portalGroups.id })
        .from(portalGroups)
        .where(
          and(
            eq(portalGroups.organizationId, orgId),
            eq(portalGroups.propertyId, propertyIdValue),
            isNull(portalGroups.deletedAt),
          ),
        )
      return rows.map((row) => ({
        organizationId: organizationId(orgId),
        propertyId: propertyId(propertyIdValue),
        targetType: 'portal_group' as const,
        targetId: portalGroupId(row.id),
        portalGroupId: portalGroupId(row.id),
        metricValue: 0,
      }))
    })
  }

  const refreshAllForProperty = async (
    propertyIdValue: string,
  ): Promise<LeaderboardReconcileResult> => {
    const orgRows = await db
      .select({ organizationId: properties.organizationId })
      .from(properties)
      .where(and(eq(properties.id, propertyIdValue), isNull(properties.deletedAt)))
      .limit(1)

    if (!orgRows[0]) {
      return { snapshotsRefreshed: 0, entriesWritten: 0 }
    }

    return refresh({
      organizationId: organizationId(orgRows[0].organizationId),
      propertyId: propertyId(propertyIdValue),
    })
  }

  const refresh = async (
    input: LeaderboardRefreshInput,
  ): Promise<LeaderboardReconcileResult> => {
    return trace('leaderboard.refresh', async () => {
      const periods: LeaderboardPeriod[] = input.period
        ? [input.period]
        : [...LEADERBOARD_PERIODS]
      const scopes: LeaderboardScope[] = input.scope
        ? [input.scope]
        : ['portal', 'portal_group']
      const metrics: LeaderboardMetricKey[] = input.metricKey
        ? [input.metricKey]
        : ['overall', ...PORTAL_METRICS]
      let snapshotsRefreshed = 0
      let entriesWritten = 0

      for (const period of periods) {
        for (const scope of scopes) {
          for (const metricKey of metrics) {
            const result = await refreshOne({
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              period,
              scope,
              metricKey,
            })
            snapshotsRefreshed += 1
            entriesWritten += result.entriesWritten
          }
        }
      }

      return { snapshotsRefreshed, entriesWritten }
    })
  }

  const refreshOne = async (
    input: Required<LeaderboardRefreshInput>,
  ): Promise<{ entriesWritten: number }> => {
    const range = periodToRange(input.period, clock())
    const targets = await listTargets(
      unbrand(input.organizationId),
      unbrand(input.propertyId),
      input.scope,
    )

    if (targets.length === 0) {
      return { entriesWritten: 0 }
    }

    if (input.metricKey === 'overall') {
      return refreshOverall(input, range, targets)
    }

    const values = normalize(await queryValues(input, range, targets, input.metricKey))
    return writeSnapshot(input, values)
  }

  const refreshOverall = async (
    input: Required<LeaderboardRefreshInput>,
    range: { start?: Date; end?: Date },
    targets: ReadonlyArray<LeaderboardRowInput>,
  ): Promise<{ entriesWritten: number }> => {
    const componentNormalized = new Map<string, ReadonlyArray<ScoredTarget>>()

    for (const metricKey of PORTAL_METRICS) {
      const values = normalize(await queryValues(input, range, targets, metricKey))
      componentNormalized.set(metricKey, values)
    }

    const scored = compositeScore(targets, componentNormalized)
    return writeSnapshot({ ...input, metricKey: 'overall' }, scored)
  }

  const queryValues = async (
    input: Required<LeaderboardRefreshInput>,
    range: { start?: Date; end?: Date },
    targets: ReadonlyArray<LeaderboardRowInput>,
    metricKey: Exclude<LeaderboardMetricKey, 'overall'>,
  ): Promise<ReadonlyArray<ScoredTarget>> => {
    if (targets.length === 0) return []

    const isPortal = input.scope === 'portal'
    const targetIds = targets.map((t) => unbrand(t.targetId))
    const targetColumn = isPortal ? metricReadings.portalId : metricReadings.groupId

    const conditions = [
      eq(metricReadings.organizationId, unbrand(input.organizationId)),
      eq(metricReadings.propertyId, unbrand(input.propertyId)),
      eq(metricReadings.metricKey, metricKey),
      inArray(targetColumn, targetIds),
      ...(range.start ? [sql`${metricReadings.occurredAt} >= ${range.start}`] : []),
      ...(range.end ? [sql`${metricReadings.occurredAt} <= ${range.end}`] : []),
    ]

    const rows = await db
      .select({
        targetId: targetColumn,
        sum: sql<number>`COALESCE(SUM(${metricReadings.value}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(metricReadings)
      .where(and(...conditions))
      .groupBy(targetColumn)

    const lookup = new Map<string, { sum: number; count: number }>()
    for (const row of rows) {
      if (row.targetId) {
        lookup.set(row.targetId, { sum: Number(row.sum), count: Number(row.count) })
      }
    }

    return targets.map((target) => {
      const agg = lookup.get(unbrand(target.targetId)) ?? { sum: 0, count: 0 }
      const raw =
        metricKey === 'portal.rating'
          ? agg.count > 0
            ? agg.sum / agg.count
            : 0
          : agg.sum
      return { row: target, value: raw, normalized: 0 }
    })
  }

  const writeSnapshot = async (
    input: Required<LeaderboardRefreshInput>,
    values: ReadonlyArray<ScoredTarget>,
  ): Promise<{ entriesWritten: number }> => {
    const now = clock()
    const scoreKey = input.metricKey === 'overall' ? 'overall' : input.metricKey
    // Domain rank() sorts by normalized (desc), then raw value (desc), and
    // assigns standard competition ranks (equal scores share a rank).
    const ranked = rank(values)
    const entryRows = ranked.map((value) => ({
      id: unbrand(idGen()),
      rank: value.rank,
      targetType: value.row.targetType,
      targetId: unbrand(value.row.targetId),
      organizationId: unbrand(value.row.organizationId),
      propertyId: unbrand(value.row.propertyId),
      score: value.normalized,
      metricValue: value.value,
      normalizedScore: value.normalized,
      updatedAt: now,
      createdAt: now,
    }))

    // Snapshot upsert + entry replacement must be atomic together (leaderboard
    // CONTEXT.md invariant). A crash between them would leave lastUpdatedAt
    // newer than the entries, so both run inside one transaction. Entry ids
    // come from the injected idGen (deterministic for simulation replay).
    await db.transaction(async (tx) => {
      const snapshotRows = await tx
        .insert(leaderboardSnapshots)
        .values({
          organizationId: unbrand(input.organizationId),
          propertyId: unbrand(input.propertyId),
          period: input.period,
          scope: input.scope,
          metricKey: input.metricKey,
          scoreKey,
          lastUpdatedAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            leaderboardSnapshots.organizationId,
            leaderboardSnapshots.propertyId,
            leaderboardSnapshots.period,
            leaderboardSnapshots.scope,
            leaderboardSnapshots.metricKey,
            leaderboardSnapshots.scoreKey,
          ],
          set: { lastUpdatedAt: now },
        })
        .returning()

      const snapshot = snapshotRows[0]
      if (!snapshot) {
        throw leaderboardError('repo_insert_failed', 'Leaderboard snapshot upsert failed')
      }

      await tx
        .delete(leaderboardEntries)
        .where(eq(leaderboardEntries.snapshotId, unbrand(snapshot.id)))
      if (entryRows.length > 0) {
        await tx
          .insert(leaderboardEntries)
          .values(entryRows.map((row) => ({ ...row, snapshotId: unbrand(snapshot.id) })))
      }
    })

    return { entriesWritten: entryRows.length }
  }

  return {
    refresh,
    reconcileAll: async () => {
      return trace('leaderboard.reconcileAll', async () => {
        const propertyIds = await listPropertiesWithMetricEvents()
        let snapshotsRefreshed = 0
        let entriesWritten = 0

        for (const propertyIdValue of propertyIds) {
          const result = await refreshAllForProperty(unbrand(propertyIdValue))
          snapshotsRefreshed += result.snapshotsRefreshed
          entriesWritten += result.entriesWritten
        }

        return { snapshotsRefreshed, entriesWritten }
      })
    },

    getLeaderboard: async (input) => {
      return trace('leaderboard.getLeaderboard', async () => {
        const rows = await db
          .select({
            entry: leaderboardEntries,
            targetName: sql<string>`COALESCE(${portals.name}, ${portalGroups.name})`,
          })
          .from(leaderboardEntries)
          .innerJoin(
            leaderboardSnapshots,
            eq(leaderboardSnapshots.id, leaderboardEntries.snapshotId),
          )
          .leftJoin(
            portals,
            and(
              eq(leaderboardEntries.targetType, 'portal'),
              eq(portals.id, leaderboardEntries.targetId),
            ),
          )
          .leftJoin(
            portalGroups,
            and(
              eq(leaderboardEntries.targetType, 'portal_group'),
              eq(portalGroups.id, leaderboardEntries.targetId),
            ),
          )
          .where(
            and(
              eq(leaderboardEntries.organizationId, unbrand(input.organizationId)),
              eq(leaderboardEntries.propertyId, unbrand(input.propertyId)),
              eq(leaderboardSnapshots.period, input.period),
              eq(leaderboardSnapshots.scope, input.scope),
              eq(leaderboardSnapshots.metricKey, input.metricKey),
              eq(
                leaderboardSnapshots.scoreKey,
                input.metricKey === 'overall' ? 'overall' : input.metricKey,
              ),
            ),
          )
          // LB-07: secondary sort on metricValue/score for display stability
          // when multiple targets share the same rank.
          .orderBy(
            leaderboardEntries.rank,
            desc(leaderboardEntries.metricValue),
            desc(leaderboardEntries.score),
          )
          .limit(input.limit ?? 50)

        return rows.map((row) => {
          const entry = leaderboardEntryFromRow(row.entry)
          return {
            ...entry,
            targetName: row.targetName,
            targetLabel: row.targetName,
          } satisfies LeaderboardEntryWithTarget
        })
      })
    },
  }
}
