import { describe, expect, it } from 'vitest'
import {
  fulfilPrivacyRequest,
  receivePrivacyRequest,
  refusePrivacyRequest,
  verifyPrivacyRequest,
  type PrivacyAuditRow,
  type PrivacyRequestLifecycleDeps,
  type PrivacyRequestRecord,
  type PrivacyRequestStore,
} from './privacy-request-lifecycle'
import type {
  PrivacySubjectContributor,
  PrivacySubjectScope,
} from './privacy-subject-contributor.port'
import type { PrivacyRequestKind } from './privacy-request'
import type { BackupErasureLedgerAppend } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'

const ORG = 'org-privacy'
const OTHER_ORG = 'org-other'
const PROPERTY = '80000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '80000000-0000-4000-8000-000000000002'
const SUBJECT = 'a'.repeat(64)
const OTHER_SUBJECT = 'b'.repeat(64)
const NOW = new Date('2027-07-01T00:00:00.000Z')

type Harness = Readonly<{
  deps: PrivacyRequestLifecycleDeps
  audits: PrivacyAuditRow[]
  ledger: BackupErasureLedgerAppend[]
  calls: string[]
  transitions: { from: string; to: string; refusalReasonCode?: string }[]
}>

function harness(
  options: Readonly<{
    kind: PrivacyRequestKind
    targetField?: string
    contributors: readonly PrivacySubjectContributor[]
    undelivered?: number
  }>,
): Harness {
  const audits: PrivacyAuditRow[] = []
  const ledger: BackupErasureLedgerAppend[] = []
  const calls: string[] = []
  const transitions: { from: string; to: string; refusalReasonCode?: string }[] = []
  let record: PrivacyRequestRecord = {
    id: 'req-1',
    organizationId: ORG,
    propertyId: PROPERTY,
    subjectType: 'guest',
    subjectRef: SUBJECT,
    requestKind: options.kind,
    state: 'received',
    ...(options.targetField ? { targetField: options.targetField } : {}),
    receivedAt: NOW,
  }

  const store: PrivacyRequestStore = {
    create: async (input) => {
      record = { ...record, ...input, id: 'req-1', state: 'received' }
      return record
    },
    load: async () => record,
    transition: async (input) => {
      transitions.push({
        from: input.from,
        to: input.to,
        ...(input.refusalReasonCode
          ? { refusalReasonCode: input.refusalReasonCode }
          : {}),
      })
      record = { ...record, state: input.to }
      return record
    },
    appendAudit: async (row) => void audits.push(row),
  }

  return {
    audits,
    ledger,
    calls,
    transitions,
    deps: {
      store,
      contributors: options.contributors,
      runInTransaction: async (work) => work({} as Tx),
      deliverAggregateCorrections: async () => {
        calls.push('deliverAggregateCorrections')
        return { delivered: 1, undelivered: options.undelivered ?? 0 }
      },
      appendLedgerEntry: async (_tx, entry) => {
        calls.push('appendLedgerEntry')
        ledger.push(entry)
        return 'ledger-1'
      },
      packageTtlMs: 7 * 24 * 60 * 60 * 1_000,
      dataCellId: 'us',
      now: () => NOW,
    },
  }
}

/** A contributor bound to exactly one tenant/property/subject triple. */
function scopedContributor(
  context: string,
  calls: string[],
  overrides: Partial<PrivacySubjectContributor> = {},
): PrivacySubjectContributor {
  const inScope = (scope: PrivacySubjectScope): boolean =>
    scope.organizationId === ORG &&
    scope.propertyId === PROPERTY &&
    scope.subjectRef === SUBJECT
  return {
    context,
    resolve: async (_tx, scope) => inScope(scope),
    access: async (_tx, scope) =>
      inScope(scope)
        ? [
            {
              context,
              table: `${context}_rows`,
              classification: 'personal' as const,
              records: [{ rating: 2, field: 'own' }],
            },
          ]
        : [],
    correct: async () => {
      calls.push(`${context}.correct`)
      return { affected: 1 }
    },
    withdraw: async () => {
      calls.push(`${context}.withdraw`)
      return { affected: 1 }
    },
    erase: async () => {
      calls.push(`${context}.erase`)
      return { affected: 3 }
    },
    ...overrides,
  }
}

describe('privacy request access (LIF-01-T20)', () => {
  it('returns a tenant/property-scoped, classified, expiry-bound package', async () => {
    const h = harness({ kind: 'access', contributors: [] })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }

    await receivePrivacyRequest(deps, {
      organizationId: ORG,
      propertyId: PROPERTY,
      subjectType: 'guest',
      subjectRef: SUBJECT,
      requestKind: 'access',
      correlationId: 'corr-1',
    })
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    const result = await fulfilPrivacyRequest(deps, {
      requestId: 'req-1',
      actorRef: 'ops-privacy',
    })

    expect(result.package).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
      classification: 'personal',
      packageRef: 'privacy:package:req-1',
    })
    // Expiry-bound: an export that never expires is a permanent second copy.
    expect(result.package?.expiresAt.getTime()).toBe(NOW.getTime() + deps.packageTtlMs)
    expect(result.package?.sections).toHaveLength(1)
  })

  it('excludes other subjects and other tenants', async () => {
    for (const scope of [
      { organizationId: OTHER_ORG, propertyId: PROPERTY, subjectRef: SUBJECT },
      { organizationId: ORG, propertyId: OTHER_PROPERTY, subjectRef: SUBJECT },
      { organizationId: ORG, propertyId: PROPERTY, subjectRef: OTHER_SUBJECT },
    ]) {
      const h = harness({ kind: 'access', contributors: [] })
      const contributors = [scopedContributor('guest', h.calls)]
      const deps = { ...h.deps, contributors }
      await deps.store.create({
        ...scope,
        subjectType: 'guest',
        requestKind: 'access',
        evidenceRef: 'privacy:received:access:corr-2',
        correlationId: 'corr-2',
        receivedAt: NOW,
      })
      // A contributor that cannot see the subject in THIS scope refuses the
      // request; an empty package is indistinguishable from "you have no data".
      const refused = await verifyPrivacyRequest(deps, {
        requestId: 'req-1',
        verificationRef: 'privacy:verify:magic-link',
        actorRef: 'ops-privacy',
      })
      expect(refused.state).toBe('refused')
      expect(h.transitions.at(-1)).toMatchObject({
        to: 'refused',
        refusalReasonCode: 'subject_not_found',
      })
    }
  })
})

describe('privacy request correction and withdrawal (LIF-01-T20)', () => {
  it('corrects only the named field and reaches the aggregate', async () => {
    const h = harness({
      kind: 'correction',
      targetField: 'rating',
      contributors: [],
    })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    const result = await fulfilPrivacyRequest(deps, {
      requestId: 'req-1',
      actorRef: 'ops-privacy',
      correctionValue: 4,
    })
    expect(result.affected).toBe(1)
    expect(h.calls).toEqual(['guest.correct', 'deliverAggregateCorrections'])
    // A correction is not an erasure: no ledger entry, no purge.
    expect(h.ledger).toEqual([])
  })

  it('withdraws and leaves the retraction to the contributor tombstone', async () => {
    const h = harness({ kind: 'withdrawal', contributors: [] })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    await fulfilPrivacyRequest(deps, { requestId: 'req-1', actorRef: 'ops-privacy' })
    expect(h.calls).toEqual(['guest.withdraw', 'deliverAggregateCorrections'])
  })
})

describe('privacy request erasure ordering (LIF-01-T20)', () => {
  it('reaches the anonymous lifetime aggregate BEFORE appending the ledger entry', async () => {
    const h = harness({ kind: 'erasure', contributors: [] })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    const result = await fulfilPrivacyRequest(deps, {
      requestId: 'req-1',
      actorRef: 'ops-privacy',
    })

    // The ordering the Guest lifecycle readiness gate requires: once the source
    // fact is gone, the correction that would have fixed the aggregate is gone
    // with it.
    expect(h.calls).toEqual([
      'guest.erase',
      'deliverAggregateCorrections',
      'appendLedgerEntry',
    ])
    expect(h.ledger).toEqual([
      {
        subjectClass: 'privacy_subject',
        organizationId: ORG,
        propertyId: PROPERTY,
        subjectRef: SUBJECT,
        context: 'guest',
        closureLineageId: 'req-1',
        lifecycleRevision: 1,
        effectiveErasureAt: NOW,
        erasedRowCount: 3,
        evidenceRef: 'privacy:erasure:req-1',
        dataCellId: 'us',
      },
    ])
    expect(result.ledgerEntryId).toBe('ledger-1')
  })

  it('blocks fulfilment while a correction has not reached the aggregate', async () => {
    const h = harness({ kind: 'erasure', contributors: [], undelivered: 2 })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    await expect(
      fulfilPrivacyRequest(deps, { requestId: 'req-1', actorRef: 'ops-privacy' }),
    ).rejects.toMatchObject({ code: 'correction_not_delivered' })
    // A retryable stall beats a permanently wrong aggregate.
    expect(h.ledger).toEqual([])
    expect(h.transitions.map((t) => t.to)).not.toContain('fulfilled')
  })
})

describe('privacy request audit (LIF-01-T20)', () => {
  it('appends received and fulfilled rows carrying no subject content', async () => {
    const h = harness({ kind: 'access', contributors: [] })
    const contributors = [scopedContributor('guest', h.calls)]
    const deps = { ...h.deps, contributors }
    await receivePrivacyRequest(deps, {
      organizationId: ORG,
      propertyId: PROPERTY,
      subjectType: 'guest',
      subjectRef: SUBJECT,
      requestKind: 'access',
      correlationId: 'corr-1',
    })
    await verifyPrivacyRequest(deps, {
      requestId: 'req-1',
      verificationRef: 'privacy:verify:magic-link',
      actorRef: 'ops-privacy',
    })
    await fulfilPrivacyRequest(deps, { requestId: 'req-1', actorRef: 'ops-privacy' })

    expect(h.audits.map((row) => row.action)).toEqual([
      'privacy_request.received',
      'privacy_request.fulfilled',
    ])
    for (const row of h.audits) {
      expect(row.resourceType).toBe('privacy_request')
      // The request id, never the subject digest and never the identifier.
      expect(row.resourceId).toBe('req-1')
      expect(JSON.stringify(row)).not.toContain(SUBJECT)
    }
  })

  it('records an explicit refusal reason code', async () => {
    const h = harness({ kind: 'erasure', contributors: [] })
    const deps = { ...h.deps, contributors: [scopedContributor('guest', h.calls)] }
    const refused = await refusePrivacyRequest(deps, {
      requestId: 'req-1',
      reasonCode: 'legal_hold',
      actorRef: 'ops-privacy',
    })
    expect(refused.state).toBe('refused')
    expect(h.transitions.at(-1)).toMatchObject({ refusalReasonCode: 'legal_hold' })
  })
})
