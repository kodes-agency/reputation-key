import { describe, expect, it } from 'vitest'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { RETENTION_REGISTRY } from './retention-registry'

const executingTables = new Set(RETENTION_RULES.map(({ table }) => table))

// Contact Request expiry is an owning-context sweep invoked by the retention job
// rather than a generic RETENTION_RULES entry.
executingTables.add('guest_contact_requests')

// Consumer receipts are deleted by the outbox_events.published rule, through
// the cascade from the event row. A rule of their own could remove a receipt
// before its event (retention-sweep-consumer-receipts.integration.test.ts).
executingTables.add('event_consumer_receipts')

// The Review Analysis v3 mention rows are deleted by the cascade from the
// analysis (or the aggregate contribution) that ai_review_analyses.v3_expired
// removes. ai-review-analysis-v3-retention.test.ts proves the cascade path from
// the schema, so naming them here cannot hide a table nothing deletes.
for (const table of [
  'ai_review_analysis_mentions',
  'ai_review_analysis_mention_sentences',
  'ai_property_aggregate_contribution_mentions',
  'ai_property_issue_members',
]) {
  executingTables.add(table)
}

describe('retention registry execution parity', () => {
  it('declares every table targeted by the executing retention rules', () => {
    const declaredTables = new Set(
      RETENTION_REGISTRY.filter(({ sourceKind }) => sourceKind === 'table').map(
        ({ source }) => source,
      ),
    )
    const missing = [...new Set(RETENTION_RULES.map(({ table }) => table))].filter(
      (table) => !declaredTables.has(table),
    )

    expect(missing).toEqual([])
  })

  it('executes every declared table rule with a fixed day or month horizon', () => {
    const unexecuted = RETENTION_REGISTRY.filter(
      (registryRule) =>
        registryRule.sourceKind === 'table' &&
        (registryRule.eligibility.horizon.kind === 'days' ||
          registryRule.eligibility.horizon.kind === 'months') &&
        !executingTables.has(registryRule.source),
    ).map(({ id, source }) => ({ id, source }))

    expect(unexecuted).toEqual([])
  })

  it('executes each rule stated in months exactly as the registry declares it', () => {
    const executed = RETENTION_RULES.filter(
      ({ olderThanMonths }) => olderThanMonths !== undefined,
    ).map(({ subject, table, tsColumn, olderThanMonths }) => ({
      evidenceSubject: subject,
      source: table,
      anchorColumn: tsColumn,
      horizon: { kind: 'months', months: olderThanMonths },
    }))
    const declared = executed.map(({ evidenceSubject }) => {
      const registryRule = RETENTION_REGISTRY.find(
        (candidate) => candidate.evidenceSubject === evidenceSubject,
      )
      return {
        evidenceSubject,
        source: registryRule?.source,
        anchorColumn: registryRule?.eligibility.anchorColumn,
        horizon: registryRule?.eligibility.horizon,
      }
    })

    expect(executed.map(({ evidenceSubject }) => evidenceSubject)).toEqual([
      'guest_qualified_scans.deidentified_fact',
      'scan_events.deidentified_fact',
      'ai_property_review_population_daily.expired',
    ])
    expect(declared).toEqual(executed)
  })
})
