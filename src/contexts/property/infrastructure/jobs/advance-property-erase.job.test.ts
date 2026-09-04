import { describe, expect, it, vi } from 'vitest'
import {
  advancePropertyErase,
  type AdvancePropertyEraseDeps,
} from './advance-property-erase.job'
import type {
  PropertyEraseAuthority,
  PropertyEraseCommandStore,
  PropertyEraseContextReceipt,
} from '../../application/ports/property-erase-command-store.port'
import type {
  PropertyEraseContext,
  PropertyEraseContributor,
} from '../../application/ports/property-erase-contributor.port'
import type { BackupErasureLedgerAppend } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'

const ORG = 'org-erase-job'
const PROPERTY_A = '50000000-0000-4000-8000-000000000001'
const PROPERTY_B = '50000000-0000-4000-8000-000000000002'
const AUTHORITY_A = '50000000-0000-4000-8000-0000000000aa'
const NOW = new Date('2027-05-01T00:00:00.000Z')

type Harness = Readonly<{
  deps: AdvancePropertyEraseDeps
  receipts: PropertyEraseContextReceipt[]
  transitions: { from: string; to: string }[]
  ledger: BackupErasureLedgerAppend[]
  erasedFor: string[]
}>

function harness(
  options: Readonly<{
    queue: readonly PropertyEraseAuthority[]
    contributors: readonly PropertyEraseContributor[]
    existingReceipts?: readonly PropertyEraseContext[]
  }>,
): Harness {
  const receipts: PropertyEraseContextReceipt[] = []
  const transitions: { from: string; to: string }[] = []
  const ledger: BackupErasureLedgerAppend[] = []
  const erasedFor: string[] = []
  const done = new Set<PropertyEraseContext>(options.existingReceipts ?? [])
  const queue = [...options.queue]

  const store: PropertyEraseCommandStore = {
    request: async () => {
      throw new Error('unused')
    },
    load: async (_authorityId, organizationId) => {
      const authority = queue[0]
      return authority?.organizationId === organizationId ? authority : null
    },
    // One Property per pass, by construction: the store hands back one row.
    nextAdvanceable: async () => queue.shift() ?? null,
    recordPreview: async () => {
      throw new Error('unused')
    },
    confirm: async () => {
      throw new Error('unused')
    },
    transition: async (input) => {
      transitions.push({ from: input.from, to: input.to })
      return { ...(options.queue[0] as PropertyEraseAuthority), state: input.to }
    },
    recordContextReceipt: async (receipt) => {
      receipts.push(receipt)
      done.add(receipt.context)
    },
    completedContexts: async () => [...done],
    readInventory: async () => [],
  }

  const contributors = options.contributors.map((contributor) => ({
    ...contributor,
    erase: async (tx: Tx, scope: { organizationId: string; propertyId: string }) => {
      erasedFor.push(`${contributor.context}:${scope.propertyId}`)
      return contributor.erase(tx, scope)
    },
  }))

  return {
    receipts,
    transitions,
    ledger,
    erasedFor,
    deps: {
      store,
      storeIn: () => store,
      contributors,
      runInTransaction: async (work) => work({} as Tx),
      appendLedgerEntry: async (_tx, entry) => {
        ledger.push(entry)
        return 'ledger-entry-id'
      },
      dataCellId: 'us',
      now: () => NOW,
    },
  }
}

const authority = (
  state: PropertyEraseAuthority['state'],
  overrides: Partial<PropertyEraseAuthority> = {},
): PropertyEraseAuthority => ({
  id: AUTHORITY_A,
  organizationId: ORG,
  propertyId: PROPERTY_A,
  state,
  requestedByUserId: 'user-admin',
  identityVerificationRef: 'identity:webauthn',
  supportOperatorId: 'ops-erase',
  supportAuthorizationRef: 'support:auth:zd-1',
  inventoryRevision: 1,
  requestedAt: NOW,
  stateChangedAt: NOW,
  ...overrides,
})

const contributor = (
  context: PropertyEraseContext,
  rows: number,
): PropertyEraseContributor => ({
  context,
  inventory: async () => [{ context, table: `${context}_rows`, rowCount: rows }],
  erase: async () => rows,
})

describe('advance property erase job (LIF-01-T19)', () => {
  it('is idle when nothing is ready', async () => {
    const { deps } = harness({ queue: [], contributors: [contributor('guest', 3)] })
    await expect(advancePropertyErase(deps)).resolves.toMatchObject({
      authorityId: null,
      rowsErased: 0,
    })
  })

  it('crosses the irreversible boundary as its own pass', async () => {
    const { deps, transitions, ledger } = harness({
      queue: [authority('purge_pending')],
      contributors: [contributor('guest', 3)],
    })
    await expect(advancePropertyErase(deps)).resolves.toMatchObject({
      fromState: 'purge_pending',
      toState: 'purging',
      rowsErased: 0,
    })
    expect(transitions).toEqual([{ from: 'purge_pending', to: 'purging' }])
    // Crossing the boundary erases nothing yet, and appends no ledger entry.
    expect(ledger).toEqual([])
  })

  it('is bounded to one Property per pass', async () => {
    const { deps, erasedFor } = harness({
      queue: [authority('purging'), authority('purging', { propertyId: PROPERTY_B })],
      contributors: [contributor('guest', 2)],
    })
    await advancePropertyErase(deps)
    expect(erasedFor).toEqual([`guest:${PROPERTY_A}`])
  })

  it('replays from persisted receipts after an interruption', async () => {
    const { deps, erasedFor, receipts } = harness({
      queue: [authority('purging')],
      contributors: [contributor('guest', 2), contributor('review', 5)],
      // `guest` already answered before the process died.
      existingReceipts: ['guest'],
    })
    const result = await advancePropertyErase(deps)
    expect(erasedFor).toEqual([`review:${PROPERTY_A}`])
    expect(result.contextsSkippedAsReplayed).toBe(1)
    expect(result.rowsErased).toBe(5)
    expect(receipts.map((receipt) => receipt.context)).toEqual(['review'])
  })

  it('records a no_data receipt for a context with nothing to erase', async () => {
    const { deps, receipts } = harness({
      queue: [authority('purging')],
      contributors: [contributor('guest', 0)],
    })
    await advancePropertyErase(deps)
    // A context with nothing to erase must be distinguishable from a context
    // that was never asked.
    expect(receipts[0]).toMatchObject({ context: 'guest', outcome: 'no_data' })
  })

  it('appends exactly one backup-erasure ledger entry on completion', async () => {
    const { deps, ledger, transitions } = harness({
      queue: [authority('purging')],
      contributors: [contributor('guest', 2), contributor('review', 5)],
    })
    const result = await advancePropertyErase(deps)
    expect(transitions).toEqual([{ from: 'purging', to: 'purged' }])
    expect(ledger).toEqual([
      {
        subjectClass: 'property',
        organizationId: ORG,
        propertyId: PROPERTY_A,
        context: 'property',
        closureLineageId: AUTHORITY_A,
        lifecycleRevision: 1,
        effectiveErasureAt: NOW,
        erasedRowCount: 7,
        evidenceRef: `property-erase:complete:${AUTHORITY_A}`,
        dataCellId: 'us',
      },
    ])
    expect(result.ledgerEntryId).toBe('ledger-entry-id')
  })

  it('does not complete or ledger a partial pass', async () => {
    // A contributor whose receipt did not persist leaves the authority in
    // `purging`; declaring it purged would ledger an erasure that never ran.
    const { deps, ledger, transitions } = harness({
      queue: [authority('purging')],
      contributors: [contributor('guest', 2), contributor('review', 5)],
    })
    const store = deps.store as { recordContextReceipt: unknown }
    store.recordContextReceipt = vi.fn(async () => undefined)
    const result = await advancePropertyErase(deps)
    expect(result.toState).toBe('purging')
    expect(transitions).toEqual([])
    expect(ledger).toEqual([])
  })
})
