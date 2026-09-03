import { describe, expect, it } from 'vitest'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { RETENTION_REGISTRY } from './retention-registry'

const executingTables = new Set(RETENTION_RULES.map(({ table }) => table))

// Contact Request expiry is an owning-context sweep invoked by the retention job
// rather than a generic RETENTION_RULES entry.
executingTables.add('guest_contact_requests')

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
})
