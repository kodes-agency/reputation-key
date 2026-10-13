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
    ])
    expect(declared).toEqual(executed)
  })
})
