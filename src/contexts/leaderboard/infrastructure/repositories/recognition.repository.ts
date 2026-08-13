import { and, desc, eq, inArray, isNull, lt, lte, gte, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import {
  recognitionActivationGroups,
  recognitionActivations,
  recognitionBoardEntries,
  recognitionBoardSnapshots,
  recognitionReconciliationEvents,
} from '#/shared/db/schema/leaderboard.schema'
import {
  metricCorrections,
  metricDefinitions,
  metricDefinitionVersions,
  metricReadings,
} from '#/shared/db/schema/metric.schema'
import {
  badgeDefinitionVersions,
  governedBadgeAwards,
  governedBadgeAwardStatusFacts,
} from '#/shared/db/schema/badge.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import {
  portalGroupMemberships,
  portalResponsibilities,
  staffParticipations,
  teamMemberships,
  teamPortalGroupScopes,
} from '#/shared/db/schema/people-access.schema'
import {
  evaluateRecognitionBoard,
  isRecognitionMetricEligible,
  transitionRecognitionActivation,
  type GovernedRecognitionMetric,
  type RecognitionActivation,
  type RecognitionAggregation,
  type RecognitionBoardEntry,
  type RecognitionCandidate,
} from '../../domain/governed-recognition'
import type {
  RecognitionBoardView,
  RecognitionRepository,
} from '../../application/ports/recognition.repository'
import type { ScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import type {
  PropertyFactsPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'

function aggregationFromRule(rule: string): RecognitionAggregation | null {
  const normalized = rule.trim().toLowerCase()
  if (normalized === 'sum' || normalized === 'latest' || normalized === 'ratio') {
    return normalized
  }
  return null
}

function metricFromRows(
  input: Readonly<{
    definitionId: string
    definitionVersionId: string
    metricKey: string
    aggregationRule: string
    allowedScopes: readonly string[]
    sourcePolicyAllowlist: readonly string[]
    permittedConsumers: readonly string[]
    employmentDecisionEligible: boolean
    minimumSample: number
  }>,
): GovernedRecognitionMetric | null {
  const aggregation = aggregationFromRule(input.aggregationRule)
  if (!aggregation) return null
  return {
    definitionId: input.definitionId,
    definitionVersionId: input.definitionVersionId,
    metricKey: input.metricKey,
    aggregation,
    allowedScopes: input.allowedScopes,
    sourcePolicyAllowlist: input.sourcePolicyAllowlist,
    permittedConsumers: input.permittedConsumers,
    employmentDecisionEligible: input.employmentDecisionEligible,
    minimumSample: input.minimumSample,
  }
}

function activationFromRow(
  row: typeof recognitionActivations.$inferSelect,
  selectedPortalGroupIds: readonly string[],
): RecognitionActivation {
  return {
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    policyVersion: row.capabilityPolicyVersion,
    jurisdiction: row.jurisdiction,
    noticeStatus: 'completed',
    consultationStatus: row.consultationStatus as 'completed' | 'not_required',
    audience: 'property_managers_and_scoped_staff',
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    selectedPortalGroupIds,
    metricDefinitionVersionId: row.metricDefinitionVersionId,
    aggregation: row.aggregation as RecognitionAggregation,
    periodKind: row.periodKind as 'weekly' | 'monthly' | 'quarterly',
    minimumExposure: row.minimumExposure,
    minimumSample: row.minimumSample,
    freshnessSeconds: row.freshnessSeconds,
    minimumCompleteness: row.minimumCompleteness,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status as 'active' | 'inactive',
    deactivationReason: row.deactivationReason,
    employmentDecisionEligible: false,
  }
}

function boardStatus(entries: readonly RecognitionBoardEntry[]) {
  if (entries.some((entry) => entry.status === 'corrected')) return 'corrected' as const
  if (entries.some((entry) => entry.status === 'ranked')) return 'ready' as const
  if (entries.some((entry) => entry.status === 'stale')) return 'stale' as const
  return 'insufficient' as const
}

export function createRecognitionRepository({
  db,
  clock,
  authorizeBoardScope,
  propertyApi,
  authorizeAwardScope,
}: {
  db: Database
  clock: Clock
  authorizeBoardScope: ScheduledScopeAuthorizer
  authorizeAwardScope: ScheduledScopeAuthorizer
  propertyApi: Pick<PropertyPublicApi, 'propertyExists'> & PropertyFactsPublicApi
}): RecognitionRepository {
  const loadActive = async (
    executor: Pick<Database, 'select'>,
    organizationId: string,
    propertyId: string,
  ) => {
    const [activation] = await executor
      .select()
      .from(recognitionActivations)
      .where(
        and(
          eq(recognitionActivations.organizationId, organizationId),
          eq(recognitionActivations.propertyId, propertyId),
          eq(recognitionActivations.status, 'active'),
          isNull(recognitionActivations.effectiveTo),
        ),
      )
      .limit(1)
    if (!activation) return null
    const groups = await executor
      .select({ id: recognitionActivationGroups.portalGroupId })
      .from(recognitionActivationGroups)
      .where(
        and(
          eq(recognitionActivationGroups.organizationId, organizationId),
          eq(recognitionActivationGroups.propertyId, propertyId),
          eq(recognitionActivationGroups.activationId, activation.id),
        ),
      )
    return activationFromRow(
      activation,
      groups.map((group) => group.id),
    )
  }

  const listEligibleMetrics = async (executor: Pick<Database, 'select'>) => {
    const rows = await executor
      .select({
        definitionId: metricDefinitions.id,
        definitionVersionId: metricDefinitionVersions.id,
        metricKey: metricDefinitions.metricKey,
        displayName: metricDefinitions.displayName,
        lifecycleStatus: metricDefinitions.lifecycleStatus,
        aggregationRule: metricDefinitionVersions.aggregationRule,
        allowedScopes: metricDefinitionVersions.allowedScopes,
        sourcePolicyAllowlist: metricDefinitionVersions.sourcePolicyAllowlist,
        permittedConsumers: metricDefinitionVersions.permittedConsumers,
        employmentDecisionEligible: metricDefinitionVersions.employmentDecisionEligible,
        minimumSample: metricDefinitionVersions.minimumSample,
      })
      .from(metricDefinitionVersions)
      .innerJoin(
        metricDefinitions,
        eq(metricDefinitions.id, metricDefinitionVersions.definitionId),
      )
      .where(eq(metricDefinitions.lifecycleStatus, 'approved'))

    return rows.flatMap((row) => {
      const metric = metricFromRows(row)
      if (!metric || !isRecognitionMetricEligible(metric).eligible) return []
      return [
        {
          definitionId: metric.definitionId,
          definitionVersionId: metric.definitionVersionId,
          metricKey: metric.metricKey,
          displayName: row.displayName,
          aggregation: metric.aggregation,
          minimumSample: metric.minimumSample,
          metric,
        },
      ]
    })
  }

  return {
    getSettings: async (organizationId, propertyId) => {
      const [activation, groups, metrics] = await Promise.all([
        loadActive(db, organizationId, propertyId),
        db
          .select({ id: portalGroups.id, name: portalGroups.name })
          .from(portalGroups)
          .where(
            and(
              eq(portalGroups.organizationId, organizationId),
              eq(portalGroups.propertyId, propertyId),
              isNull(portalGroups.deletedAt),
            ),
          )
          .orderBy(portalGroups.name),
        listEligibleMetrics(db),
      ])
      return {
        activation,
        availablePortalGroups: groups,
        availableMetrics: metrics.map(({ metric: _metric, ...metric }) => metric),
      }
    },

    activate: async (command) => {
      const next = transitionRecognitionActivation(null, command)
      if (
        !(await propertyApi.propertyExists(
          toOrganizationId(command.organizationId),
          toPropertyId(command.propertyId),
        ))
      ) {
        throw new Error('recognition_property_not_found')
      }
      return db.transaction(async (tx) => {
        const selectedGroups = await tx
          .select({ id: portalGroups.id })
          .from(portalGroups)
          .where(
            and(
              eq(portalGroups.organizationId, command.organizationId),
              eq(portalGroups.propertyId, command.propertyId),
              inArray(portalGroups.id, [...next.selectedPortalGroupIds]),
              isNull(portalGroups.deletedAt),
            ),
          )
        if (selectedGroups.length !== next.selectedPortalGroupIds.length) {
          throw new Error('recognition_group_not_found')
        }

        const metrics = await listEligibleMetrics(tx)
        const metric = metrics.find(
          (candidate) => candidate.definitionVersionId === next.metricDefinitionVersionId,
        )
        if (!metric || metric.aggregation !== next.aggregation) {
          throw new Error('recognition_metric_not_eligible')
        }
        if (next.minimumSample < metric.minimumSample) {
          throw new Error('recognition_minimum_sample_too_low')
        }

        await tx
          .update(recognitionActivations)
          .set({
            status: 'inactive',
            effectiveTo: command.now,
            deactivationReason: 'superseded_by_activation',
          })
          .where(
            and(
              eq(recognitionActivations.organizationId, command.organizationId),
              eq(recognitionActivations.propertyId, command.propertyId),
              eq(recognitionActivations.status, 'active'),
              isNull(recognitionActivations.effectiveTo),
            ),
          )

        const [row] = await tx
          .insert(recognitionActivations)
          .values({
            organizationId: next.organizationId,
            propertyId: next.propertyId,
            capabilityPolicyVersion: next.policyVersion,
            jurisdiction: next.jurisdiction,
            noticeStatus: next.noticeStatus,
            consultationStatus: next.consultationStatus,
            metricDefinitionVersionId: next.metricDefinitionVersionId,
            aggregation: next.aggregation,
            periodKind: next.periodKind,
            minimumExposure: next.minimumExposure,
            minimumSample: next.minimumSample,
            freshnessSeconds: next.freshnessSeconds,
            minimumCompleteness: next.minimumCompleteness,
            audience: next.audience,
            acknowledgedBy: next.acknowledgedBy,
            acknowledgedAt: next.acknowledgedAt,
            effectiveFrom: next.effectiveFrom,
            effectiveTo: null,
            status: 'active',
            deactivationReason: null,
            employmentDecisionEligible: false,
            createdAt: command.now,
          })
          .returning()
        if (!row) throw new Error('recognition_activation_insert_failed')
        await tx.insert(recognitionActivationGroups).values(
          next.selectedPortalGroupIds.map((portalGroupId) => ({
            organizationId: next.organizationId,
            propertyId: next.propertyId,
            activationId: row.id,
            portalGroupId,
            createdAt: command.now,
          })),
        )
        return activationFromRow(row, next.selectedPortalGroupIds)
      })
    },

    deactivate: async (input) =>
      db.transaction(async (tx) => {
        const current = await loadActive(tx, input.organizationId, input.propertyId)
        const next = transitionRecognitionActivation(current, {
          kind: 'deactivate',
          reason: input.reason,
          actorId: input.actorId,
          now: input.now,
        })
        await tx
          .update(recognitionActivations)
          .set({
            status: 'inactive',
            effectiveTo: input.now,
            deactivationReason: next.deactivationReason,
          })
          .where(
            and(
              eq(recognitionActivations.organizationId, input.organizationId),
              eq(recognitionActivations.propertyId, input.propertyId),
              eq(recognitionActivations.status, 'active'),
              isNull(recognitionActivations.effectiveTo),
            ),
          )
        return next
      }),

    resolveVisiblePortalGroupIds: async (input) => {
      const activation = await loadActive(db, input.organizationId, input.propertyId)
      if (!activation) return []
      if (input.role === 'AccountAdmin' || input.role === 'PropertyManager') {
        return activation.selectedPortalGroupIds
      }
      if (input.role !== 'Staff') return []

      const [leadRows, responsibilityRows] = await Promise.all([
        db
          .selectDistinct({ portalGroupId: teamPortalGroupScopes.portalGroupId })
          .from(staffParticipations)
          .innerJoin(
            teamMemberships,
            and(
              eq(teamMemberships.staffParticipationId, staffParticipations.id),
              eq(teamMemberships.organizationId, staffParticipations.organizationId),
              eq(teamMemberships.propertyId, staffParticipations.propertyId),
              eq(teamMemberships.role, 'lead'),
              isNull(teamMemberships.effectiveTo),
            ),
          )
          .innerJoin(
            teamPortalGroupScopes,
            and(
              eq(teamPortalGroupScopes.teamId, teamMemberships.teamId),
              eq(teamPortalGroupScopes.organizationId, teamMemberships.organizationId),
              eq(teamPortalGroupScopes.propertyId, teamMemberships.propertyId),
              isNull(teamPortalGroupScopes.effectiveTo),
            ),
          )
          .where(
            and(
              eq(staffParticipations.organizationId, input.organizationId),
              eq(staffParticipations.propertyId, input.propertyId),
              eq(staffParticipations.userId, input.userId),
              eq(staffParticipations.status, 'active'),
            ),
          ),
        db
          .selectDistinct({ portalGroupId: portalGroupMemberships.portalGroupId })
          .from(staffParticipations)
          .innerJoin(
            portalResponsibilities,
            and(
              eq(portalResponsibilities.staffParticipationId, staffParticipations.id),
              eq(
                portalResponsibilities.organizationId,
                staffParticipations.organizationId,
              ),
              eq(portalResponsibilities.propertyId, staffParticipations.propertyId),
              isNull(portalResponsibilities.effectiveTo),
            ),
          )
          .innerJoin(
            portalGroupMemberships,
            and(
              eq(portalGroupMemberships.portalId, portalResponsibilities.portalId),
              eq(
                portalGroupMemberships.organizationId,
                portalResponsibilities.organizationId,
              ),
              eq(portalGroupMemberships.propertyId, portalResponsibilities.propertyId),
              isNull(portalGroupMemberships.effectiveTo),
            ),
          )
          .where(
            and(
              eq(staffParticipations.organizationId, input.organizationId),
              eq(staffParticipations.propertyId, input.propertyId),
              eq(staffParticipations.userId, input.userId),
              eq(staffParticipations.status, 'active'),
            ),
          ),
      ])
      const activated = new Set(activation.selectedPortalGroupIds)
      return [
        ...new Set(
          [...leadRows, ...responsibilityRows]
            .map((row) => row.portalGroupId)
            .filter((groupId) => activated.has(groupId)),
        ),
      ]
    },

    getBoard: async (input) => {
      if (input.visiblePortalGroupIds.length === 0) return null
      const allowedGroups = input.portalGroupId
        ? [input.portalGroupId]
        : [...input.visiblePortalGroupIds]
      const [snapshot] = await db
        .select()
        .from(recognitionBoardSnapshots)
        .where(
          and(
            eq(recognitionBoardSnapshots.organizationId, input.organizationId),
            eq(recognitionBoardSnapshots.propertyId, input.propertyId),
          ),
        )
        .orderBy(desc(recognitionBoardSnapshots.periodEnd))
        .limit(1)
      if (!snapshot) return null
      const rows = await db
        .select({ entry: recognitionBoardEntries, name: portalGroups.name })
        .from(recognitionBoardEntries)
        .innerJoin(
          portalGroups,
          and(
            eq(portalGroups.id, recognitionBoardEntries.portalGroupId),
            eq(portalGroups.organizationId, recognitionBoardEntries.organizationId),
            eq(portalGroups.propertyId, recognitionBoardEntries.propertyId),
          ),
        )
        .where(
          and(
            eq(recognitionBoardEntries.organizationId, input.organizationId),
            eq(recognitionBoardEntries.propertyId, input.propertyId),
            eq(recognitionBoardEntries.snapshotId, snapshot.id),
            inArray(recognitionBoardEntries.portalGroupId, allowedGroups),
          ),
        )
        .orderBy(recognitionBoardEntries.rank, portalGroups.name)

      return {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        metricDefinitionVersionId: snapshot.metricDefinitionVersionId,
        periodKind: snapshot.periodKind as RecognitionBoardView['periodKind'],
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        timezone: snapshot.timezone,
        status: snapshot.status as RecognitionBoardView['status'],
        sourceWatermark: snapshot.sourceWatermark,
        correctionGeneration: snapshot.correctionGeneration,
        entries: rows.map(({ entry, name }) => ({
          portalGroupId: entry.portalGroupId,
          portalGroupLabel: name,
          value: entry.value,
          numerator: entry.numerator,
          denominator: entry.denominator,
          sampleCount: entry.sampleCount,
          exposureCount: entry.exposureCount,
          rank: entry.rank,
          tieGroup: entry.tieGroup,
          eligibilityReason:
            entry.eligibilityReason as RecognitionBoardEntry['eligibilityReason'],
          status: entry.status as RecognitionBoardEntry['status'],
          sourceWatermark: entry.sourceWatermark,
          completeness: entry.completeness,
          correctionGeneration: entry.correctionGeneration,
          employmentDecisionEligible: false,
        })),
        employmentDecisionEligible: false,
      }
    },

    listActivePropertyScopes: async () =>
      db
        .selectDistinct({
          organizationId: recognitionActivations.organizationId,
          propertyId: recognitionActivations.propertyId,
        })
        .from(recognitionActivations)
        .where(
          and(
            eq(recognitionActivations.status, 'active'),
            isNull(recognitionActivations.effectiveTo),
          ),
        ),

    reconcileProperty: async (organizationId, propertyId) => {
      if (
        !(await authorizeBoardScope(organizationId, propertyId)) ||
        !(await authorizeAwardScope(organizationId, propertyId))
      ) {
        return { snapshotsReconciled: 0, entriesUpserted: 0, sourceFactsRecorded: 0 }
      }
      const timezone = await propertyApi.getPropertyTimezone(
        toOrganizationId(organizationId),
        toPropertyId(propertyId),
      )
      if (!timezone) {
        return { snapshotsReconciled: 0, entriesUpserted: 0, sourceFactsRecorded: 0 }
      }
      return db.transaction(async (tx) => {
        const activation = await loadActive(tx, organizationId, propertyId)
        if (!activation) {
          return { snapshotsReconciled: 0, entriesUpserted: 0, sourceFactsRecorded: 0 }
        }
        const metrics = await listEligibleMetrics(tx)
        const metricRow = metrics.find(
          (candidate) =>
            candidate.definitionVersionId === activation.metricDefinitionVersionId,
        )
        if (!metricRow || metricRow.aggregation !== activation.aggregation) {
          return { snapshotsReconciled: 0, entriesUpserted: 0, sourceFactsRecorded: 0 }
        }
        const period = calendarPeriodRange(clock(), timezone, activation.periodKind)
        const property = {
          timezone,
          periodStart: period.start,
          periodEnd: period.end,
        }

        const readingRows = await tx
          .select({
            reading: metricReadings,
            correction: metricCorrections,
          })
          .from(metricReadings)
          .leftJoin(metricCorrections, eq(metricCorrections.readingId, metricReadings.id))
          .where(
            and(
              eq(metricReadings.organizationId, organizationId),
              eq(metricReadings.propertyId, propertyId),
              eq(
                metricReadings.definitionVersionId,
                activation.metricDefinitionVersionId,
              ),
              inArray(metricReadings.groupId, [...activation.selectedPortalGroupIds]),
              gte(metricReadings.eventAt, property.periodStart),
              lt(metricReadings.eventAt, property.periodEnd),
            ),
          )

        type ReadingState = {
          reading: typeof metricReadings.$inferSelect
          corrections: (typeof metricCorrections.$inferSelect)[]
        }
        const readingsById = new Map<string, ReadingState>()
        for (const row of readingRows) {
          const state = readingsById.get(row.reading.id) ?? {
            reading: row.reading,
            corrections: [],
          }
          if (row.correction) state.corrections.push(row.correction)
          readingsById.set(row.reading.id, state)
        }

        const groupNames = await tx
          .select({ id: portalGroups.id, name: portalGroups.name })
          .from(portalGroups)
          .where(
            and(
              eq(portalGroups.organizationId, organizationId),
              eq(portalGroups.propertyId, propertyId),
              inArray(portalGroups.id, [...activation.selectedPortalGroupIds]),
              isNull(portalGroups.deletedAt),
            ),
          )
        const nameByGroup = new Map(groupNames.map((group) => [group.id, group.name]))
        const candidates: RecognitionCandidate[] = []
        let sourceFactsRecorded = 0
        for (const groupId of activation.selectedPortalGroupIds) {
          const states = [...readingsById.values()].filter(
            ({ reading }) => reading.groupId === groupId,
          )
          let exactValue = 0
          let numerator = 0
          let denominator = 0
          let sampleCount = 0
          let exposureCount = 0
          let correctionGeneration = 0
          let exactAttributionCount = 0
          let latestAt = property.periodStart
          let latestValue = 0

          for (const state of states) {
            let effectiveValue = state.reading.exactValue ?? 0
            const corrections = state.corrections.sort(
              (left, right) => left.recordedAt.getTime() - right.recordedAt.getTime(),
            )
            for (const correction of corrections) {
              correctionGeneration += 1
              if (correction.kind === 'retract') effectiveValue = 0
              if (correction.kind === 'replace') {
                effectiveValue = correction.replacementValue ?? effectiveValue
              }
              if (correction.kind === 'adjust') {
                effectiveValue += correction.exactDelta ?? 0
              }
            }
            const eventAt = state.reading.eventAt ?? state.reading.occurredAt
            if (eventAt >= latestAt) {
              latestAt = eventAt
              latestValue = effectiveValue
            }
            exactValue += effectiveValue
            const readingExposure =
              state.reading.denominator ?? state.reading.sampleCount ?? 0
            numerator +=
              activation.aggregation === 'ratio'
                ? effectiveValue * readingExposure
                : (state.reading.numerator ?? 0)
            denominator +=
              activation.aggregation === 'ratio'
                ? readingExposure
                : (state.reading.denominator ?? 0)
            sampleCount += state.reading.sampleCount ?? 0
            exposureCount += readingExposure
            if (state.reading.attributionQuality === 'exact') exactAttributionCount += 1

            const sourceFacts = [
              ...(state.reading.sourceEventId ? [state.reading.sourceEventId] : []),
              ...corrections.map((correction) => correction.sourceEventId),
            ]
            for (const sourceEventId of sourceFacts) {
              const inserted = await tx
                .insert(recognitionReconciliationEvents)
                .values({
                  organizationId,
                  propertyId,
                  metricDefinitionVersionId: activation.metricDefinitionVersionId,
                  sourceEventId,
                  correctionReference: corrections.find(
                    (correction) => correction.sourceEventId === sourceEventId,
                  )?.id,
                  sourceWatermark: eventAt,
                  processedAt: clock(),
                })
                .onConflictDoNothing()
                .returning({ id: recognitionReconciliationEvents.id })
              sourceFactsRecorded += inserted.length
            }
          }
          if (activation.aggregation === 'latest') exactValue = latestValue
          if (activation.aggregation === 'ratio') {
            exactValue = denominator > 0 ? numerator / denominator : 0
          }
          candidates.push({
            portalGroupId: groupId,
            portalGroupLabel: nameByGroup.get(groupId) ?? 'Unavailable group',
            exactValue,
            numerator: activation.aggregation === 'ratio' ? numerator : null,
            denominator: activation.aggregation === 'ratio' ? denominator : null,
            sampleCount,
            exposureCount,
            sourceWatermark: latestAt,
            completeness: states.length > 0 ? exactAttributionCount / states.length : 0,
            correctionGeneration,
            attributionQuality: states.some(
              ({ reading }) => reading.attributionQuality === 'unresolved',
            )
              ? 'unresolved'
              : 'exact',
          })
        }

        const entries = evaluateRecognitionBoard({
          metric: {
            ...metricRow.metric,
            minimumSample: Math.max(
              metricRow.metric.minimumSample,
              activation.minimumSample,
            ),
          },
          candidates,
          minimumExposure: activation.minimumExposure,
          minimumCompleteness: activation.minimumCompleteness,
          freshAfter: new Date(clock().getTime() - activation.freshnessSeconds * 1_000),
        })
        const sourceWatermark = entries.reduce(
          (latest, entry) =>
            entry.sourceWatermark > latest ? entry.sourceWatermark : latest,
          property.periodStart,
        )
        const correctionGeneration = entries.reduce(
          (total, entry) => total + entry.correctionGeneration,
          0,
        )
        const status = boardStatus(entries)
        const insertedSnapshots = await tx
          .insert(recognitionBoardSnapshots)
          .values({
            organizationId,
            propertyId,
            activationId: (
              await tx
                .select({ id: recognitionActivations.id })
                .from(recognitionActivations)
                .where(
                  and(
                    eq(recognitionActivations.organizationId, organizationId),
                    eq(recognitionActivations.propertyId, propertyId),
                    eq(recognitionActivations.status, 'active'),
                    isNull(recognitionActivations.effectiveTo),
                  ),
                )
                .limit(1)
            )[0]!.id,
            metricDefinitionId: metricRow.definitionId,
            metricDefinitionVersionId: metricRow.definitionVersionId,
            aggregation: activation.aggregation,
            periodKind: activation.periodKind,
            periodStart: property.periodStart,
            periodEnd: property.periodEnd,
            timezone: property.timezone,
            minimumExposure: activation.minimumExposure,
            minimumSample: activation.minimumSample,
            freshnessSeconds: activation.freshnessSeconds,
            minimumCompleteness: activation.minimumCompleteness,
            sourceWatermark,
            status,
            eligibilityReason:
              status === 'insufficient'
                ? (entries[0]?.eligibilityReason ?? 'insufficient_sample')
                : null,
            correctionGeneration,
            employmentDecisionEligible: false,
            reconciledAt: clock(),
            createdAt: clock(),
          })
          .onConflictDoNothing()
          .returning()
        const snapshot = insertedSnapshots[0]
        if (!snapshot) {
          return {
            snapshotsReconciled: 0,
            entriesUpserted: 0,
            sourceFactsRecorded,
          }
        }

        for (const entry of entries) {
          await tx
            .insert(recognitionBoardEntries)
            .values({
              organizationId,
              propertyId,
              snapshotId: snapshot.id,
              portalGroupId: entry.portalGroupId,
              value: entry.value,
              numerator: entry.numerator,
              denominator: entry.denominator,
              sampleCount: entry.sampleCount,
              exposureCount: entry.exposureCount,
              completeness: entry.completeness,
              rank: entry.rank,
              tieGroup: entry.tieGroup,
              eligibilityReason: entry.eligibilityReason,
              status: entry.status,
              sourceWatermark: entry.sourceWatermark,
              correctionGeneration: entry.correctionGeneration,
              employmentDecisionEligible: false,
              reconciledAt: clock(),
              createdAt: clock(),
            })
            .onConflictDoNothing()
        }

        const awardDefinitions = await tx
          .select()
          .from(badgeDefinitionVersions)
          .where(
            and(
              eq(
                badgeDefinitionVersions.metricDefinitionVersionId,
                activation.metricDefinitionVersionId,
              ),
              eq(badgeDefinitionVersions.employmentDecisionEligible, false),
              lte(badgeDefinitionVersions.effectiveFrom, property.periodEnd),
              or(
                isNull(badgeDefinitionVersions.effectiveTo),
                gte(badgeDefinitionVersions.effectiveTo, property.periodStart),
              ),
            ),
          )
        for (const definition of awardDefinitions) {
          for (const entry of entries) {
            const qualifies =
              entry.value !== null &&
              entry.eligibilityReason === 'eligible' &&
              entry.sampleCount >= definition.minimumSample &&
              entry.exposureCount >= definition.minimumExposure &&
              entry.completeness >= definition.minimumCompleteness &&
              entry.sourceWatermark >=
                new Date(clock().getTime() - definition.freshnessSeconds * 1_000) &&
              entry.value >= definition.threshold
            if (qualifies) {
              await tx
                .insert(governedBadgeAwards)
                .values({
                  organizationId,
                  propertyId,
                  portalGroupId: entry.portalGroupId,
                  definitionVersionId: definition.id,
                  metricDefinitionVersionId: activation.metricDefinitionVersionId,
                  sourceSnapshotId: snapshot.id,
                  sourceFactId: `${snapshot.id}:${definition.id}:${entry.portalGroupId}`,
                  sourceWatermark: entry.sourceWatermark,
                  periodStart: property.periodStart,
                  periodEnd: property.periodEnd,
                  timezone: property.timezone,
                  sampleCount: entry.sampleCount,
                  exposureCount: entry.exposureCount,
                  completeness: entry.completeness,
                  eligibilityReason: entry.eligibilityReason,
                  definitionSnapshot: {
                    name: definition.name,
                    icon: definition.icon,
                    criteria: definition.criteria,
                    rule: definition.rule,
                    metricVersion: activation.metricDefinitionVersionId,
                  },
                  awardedAt: clock(),
                  employmentDecisionEligible: false,
                  createdAt: clock(),
                })
                .onConflictDoNothing()
              continue
            }

            if (entry.correctionGeneration === 0) continue
            const priorAwards = await tx
              .select({ id: governedBadgeAwards.id })
              .from(governedBadgeAwards)
              .where(
                and(
                  eq(governedBadgeAwards.organizationId, organizationId),
                  eq(governedBadgeAwards.propertyId, propertyId),
                  eq(governedBadgeAwards.portalGroupId, entry.portalGroupId),
                  eq(governedBadgeAwards.definitionVersionId, definition.id),
                  eq(governedBadgeAwards.periodStart, property.periodStart),
                  eq(governedBadgeAwards.periodEnd, property.periodEnd),
                ),
              )
            for (const award of priorAwards) {
              await tx
                .insert(governedBadgeAwardStatusFacts)
                .values({
                  organizationId,
                  propertyId,
                  awardId: award.id,
                  status: 'invalidated',
                  correctionReference: snapshot.id,
                  replacementAwardId: null,
                  replacementOrganizationId: null,
                  replacementPropertyId: null,
                  reason: 'Corrected governed reading no longer meets the award rule',
                  occurredAt: clock(),
                  createdAt: clock(),
                })
                .onConflictDoNothing()
            }
          }
        }
        return {
          snapshotsReconciled: 1,
          entriesUpserted: entries.length,
          sourceFactsRecorded,
        }
      })
    },
  }
}
