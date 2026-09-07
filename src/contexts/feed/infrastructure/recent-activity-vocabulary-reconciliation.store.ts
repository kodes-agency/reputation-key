import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type {
  RecentActivityVocabularyApplyCommand,
  RecentActivityVocabularyApplyOutcome,
  RecentActivityVocabularyReconciliationStore,
  RecentActivityVocabularyTargetGroup,
} from '../ports/recent-activity-vocabulary-reconciliation.port'

type Row = Readonly<Record<string, unknown>>

const stringField = (row: Row, field: string): string => {
  const value = row[field]
  if (typeof value !== 'string')
    throw new Error('recent_activity_vocabulary_store_row_invalid')
  return value
}

const integerField = (row: Row, field: string): number => {
  const value = row[field]
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('recent_activity_vocabulary_store_row_invalid')
  }
  return parsed
}

const targetGroup = (row: Row): RecentActivityVocabularyTargetGroup => ({
  action: stringField(row, 'action'),
  resourceType: stringField(row, 'resource_type'),
  count: integerField(row, 'target_count'),
  targetFingerprintSha256: stringField(row, 'target_fingerprint_sha256'),
})

const receiptMatches = (
  row: Row,
  command: RecentActivityVocabularyApplyCommand,
): boolean =>
  stringField(row, 'organization_id') === command.organizationId &&
  stringField(row, 'source_action') === command.source.action &&
  stringField(row, 'source_resource_type') === command.source.resourceType &&
  stringField(row, 'target_action') === command.target.action &&
  stringField(row, 'target_resource_type') === command.target.resourceType &&
  stringField(row, 'target_fingerprint_sha256') ===
    command.expectedTargetFingerprintSha256 &&
  integerField(row, 'target_count') === command.expectedTargetCount &&
  stringField(row, 'authorized_by') === command.authorizedBy &&
  stringField(row, 'authorization_evidence_ref') === command.authorizationEvidenceRef

export type RecentActivityVocabularyReconciliationFaults = Readonly<{
  afterUpdateBeforeReceipt?: () => Promise<void>
}>

export const createRecentActivityVocabularyReconciliationStore = (
  db: Database,
  faults: RecentActivityVocabularyReconciliationFaults = {},
): RecentActivityVocabularyReconciliationStore => ({
  report: async (organizationId) => {
    const result = await db.execute(sql`
      SELECT action,
             resource_type,
             count(*)::integer AS target_count,
             encode(sha256(convert_to(
               action || E'\n' || resource_type || E'\n' ||
               string_agg(id::text, E'\n' ORDER BY id::text),
               'UTF8'
             )), 'hex') AS target_fingerprint_sha256
      FROM recent_activity_entries
      WHERE organization_id = ${organizationId as string}
      GROUP BY action, resource_type
      ORDER BY action, resource_type
    `)
    return result.rows.map((row) => targetGroup(row as Row))
  },

  apply: (command) =>
    db.transaction(async (transaction): Promise<RecentActivityVocabularyApplyOutcome> => {
      // Operation IDs are global. Take this lock before the tenant lock so the
      // same ID cannot mutate two Organizations and race at the receipt PK.
      await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`recent-activity-vocabulary-operation:${command.operationId}`}, 0)
          )
        `)
      await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`recent-activity-vocabulary:${command.organizationId}`}, 0)
          )
        `)

      const prior = await transaction.execute(sql`
          SELECT payload->>'organizationId' AS organization_id,
                 payload->>'sourceAction' AS source_action,
                 payload->>'sourceResourceType' AS source_resource_type,
                 payload->>'targetAction' AS target_action,
                 payload->>'targetResourceType' AS target_resource_type,
                 payload->>'targetFingerprintSha256' AS target_fingerprint_sha256,
                 payload->>'targetCount' AS target_count,
                 payload->>'updatedCount' AS updated_count,
                 payload->>'authorizedBy' AS authorized_by,
                 payload->>'authorizationEvidenceRef' AS authorization_evidence_ref
          FROM idempotency_receipts
          WHERE scope = 'activity_vocabulary_reconciliation'
            AND key = ${command.operationId}
          FOR UPDATE
        `)
      if (prior.rows.length > 0) {
        const row = prior.rows[0] as Row
        return receiptMatches(row, command)
          ? {
              status: 'replayed',
              updatedCount: integerField(row, 'updated_count'),
            }
          : { status: 'operation_conflict' }
      }

      const currentResult = await transaction.execute(sql`
          SELECT count(*)::integer AS target_count,
                 COALESCE(
                   encode(sha256(convert_to(
                     ${command.source.action} || E'\n' ||
                     ${command.source.resourceType} || E'\n' ||
                     string_agg(id::text, E'\n' ORDER BY id::text),
                     'UTF8'
                   )), 'hex'),
                   encode(sha256(convert_to('', 'UTF8')), 'hex')
                 ) AS target_fingerprint_sha256
          FROM recent_activity_entries
          WHERE organization_id = ${command.organizationId as string}
            AND action = ${command.source.action}
            AND resource_type = ${command.source.resourceType}
        `)
      const current = currentResult.rows[0] as Row
      const currentCount = integerField(current, 'target_count')
      const currentTargetFingerprintSha256 = stringField(
        current,
        'target_fingerprint_sha256',
      )
      if (currentCount === 0) return { status: 'no_rows' }
      if (
        currentCount !== command.expectedTargetCount ||
        currentTargetFingerprintSha256 !== command.expectedTargetFingerprintSha256
      ) {
        return {
          status: 'stale_target',
          currentCount,
          currentTargetFingerprintSha256,
        }
      }

      const updated = await transaction.execute(sql`
          UPDATE recent_activity_entries
          SET action = ${command.target.action},
              resource_type = ${command.target.resourceType}
          WHERE organization_id = ${command.organizationId as string}
            AND action = ${command.source.action}
            AND resource_type = ${command.source.resourceType}
          RETURNING id
        `)
      if (updated.rows.length !== command.expectedTargetCount) {
        throw new Error('recent_activity_vocabulary_update_count_mismatch')
      }

      await faults.afterUpdateBeforeReceipt?.()

      await transaction.execute(sql`
          INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
          VALUES (
            'activity_vocabulary_reconciliation',
            ${command.operationId},
            jsonb_build_object(
              'organizationId', ${command.organizationId as string}::text,
              'sourceAction', ${command.source.action}::text,
              'sourceResourceType', ${command.source.resourceType}::text,
              'targetAction', ${command.target.action}::text,
              'targetResourceType', ${command.target.resourceType}::text,
              'targetFingerprintSha256', ${command.expectedTargetFingerprintSha256}::text,
              'targetCount', ${command.expectedTargetCount}::integer,
              'updatedCount', ${updated.rows.length}::integer,
              'authorizedBy', ${command.authorizedBy}::text,
              'authorizationEvidenceRef', ${command.authorizationEvidenceRef}::text
            ),
            ${command.appliedAt}
          )
        `)
      return { status: 'applied', updatedCount: updated.rows.length }
    }),
})
