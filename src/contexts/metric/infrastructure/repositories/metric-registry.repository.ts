import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  metricDefinitions,
  metricDefinitionVersions,
} from '#/shared/db/schema/metric.schema'
import type { MetricRegistryRepository } from '../../application/ports/metric-registry.repository.port'
import type {
  InsufficientDataBehavior,
  MetricLifecycleStatus,
  MetricScope,
  MetricValueKind,
  PermittedConsumer,
  SourcePolicyClass,
} from '../../domain/metric-registry'
import type { MetricKey } from '#/shared/domain/metric-keys'

export const createMetricRegistryRepository = (
  db: Database,
): MetricRegistryRepository => ({
  findVersionById: async (definitionVersionId) => {
    const rows = await db
      .select({ definition: metricDefinitions, version: metricDefinitionVersions })
      .from(metricDefinitionVersions)
      .innerJoin(
        metricDefinitions,
        eq(metricDefinitions.id, metricDefinitionVersions.definitionId),
      )
      .where(eq(metricDefinitionVersions.id, definitionVersionId))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      definition: {
        id: row.definition.id,
        key: row.definition.metricKey as MetricKey,
        name: row.definition.displayName,
        description: row.definition.description ?? '',
        valueKind: row.definition.valueKind as MetricValueKind,
        workerDataFlag: row.definition.workerDataFlag,
        privacyClass: row.definition.privacyClass,
        retentionClass: row.definition.retentionClass,
        lifecycleStatus: row.definition.lifecycleStatus as MetricLifecycleStatus,
        approvalOwner: row.definition.approvalOwner,
      },
      version: {
        id: row.version.id,
        definitionId: row.version.definitionId,
        version: row.version.version,
        effectiveFrom: row.version.effectiveFrom,
        effectiveTo: row.version.effectiveTo,
        numeratorDescription: row.version.numeratorDescription,
        denominatorDescription: row.version.denominatorDescription,
        unit: row.version.unit,
        precision: row.version.precision,
        aggregationRule: row.version.aggregationRule,
        lateArrivalRule: row.version.lateArrivalRule,
        allowedScopes: row.version.allowedScopes as readonly MetricScope[],
        attributionRule: row.version.attributionRule,
        minimumSample: row.version.minimumSample,
        insufficientDataBehavior: row.version
          .insufficientDataBehavior as InsufficientDataBehavior,
        sourcePolicyAllowlist: row.version
          .sourcePolicyAllowlist as readonly SourcePolicyClass[],
        permittedConsumers: row.version
          .permittedConsumers as readonly PermittedConsumer[],
        employmentDecisionEligible: false,
        correctionBehavior: row.version.correctionBehavior,
        fairnessReviewStatus: row.version.fairnessReviewStatus,
      },
    }
  },
})
