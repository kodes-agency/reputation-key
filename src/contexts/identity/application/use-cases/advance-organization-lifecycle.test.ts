import { describe, expect, it, vi } from 'vitest'
import type { OrganizationLifecycleCommandStore } from '../ports/organization-lifecycle-command-store.port'
import type { OrganizationLifecycleContributor } from '../ports/organization-lifecycle-contributor.port'
import {
  ORGANIZATION_LIFECYCLE_CONTEXTS,
  type OrganizationLifecycleStatus,
} from '../../domain/organization-lifecycle'
import { createOrganizationLifecycleCoordinator } from './advance-organization-lifecycle'

const NOW = new Date('2026-09-28T00:00:00.000Z')
const LINEAGE = '18deca2e-91a7-46e4-b92b-73163568ed84'

function status(
  state: OrganizationLifecycleStatus['state'],
  revision: number,
): OrganizationLifecycleStatus {
  return {
    organizationId: 'org-1',
    state,
    revision,
    closureLineageId: LINEAGE,
    closureRequestedAt: new Date('2026-08-28T00:00:00.000Z'),
    recoverableUntil: new Date('2026-09-27T00:00:00.000Z'),
    irreversibleAt:
      state === 'purging' || state === 'closed'
        ? new Date('2026-09-27T01:00:00.000Z')
        : null,
    closedAt: state === 'closed' ? NOW : null,
    reactivationRequired: true,
    lastTransitionAt: NOW,
    lastActorId: 'system:test',
    lastReasonCode: 'test_state',
    lastSupportEvidenceRef: 'test:state',
  }
}

function contributors(
  fail?: Readonly<{
    context: (typeof ORGANIZATION_LIFECYCLE_CONTEXTS)[number]
    phase: string
  }>,
): readonly OrganizationLifecycleContributor[] {
  return ORGANIZATION_LIFECYCLE_CONTEXTS.map((context) => ({
    context,
    prepareClosing: vi.fn(async () => {
      if (fail?.context === context && fail.phase === 'closing') throw new Error('down')
      return { outcome: 'complete' as const, evidenceRef: `closing:${context}:1` }
    }),
    verifyPurgeReadiness: vi.fn(async () => {
      if (fail?.context === context && fail.phase === 'readiness') throw new Error('down')
      return { outcome: 'complete' as const, evidenceRef: `ready:${context}:1` }
    }),
    purge: vi.fn(async () => {
      if (fail?.context === context && fail.phase === 'purge') throw new Error('down')
      return { outcome: 'complete' as const, evidenceRef: `purge:${context}:1` }
    }),
  }))
}

function store(candidates: readonly OrganizationLifecycleStatus[]) {
  let current = candidates[0] ?? status('closing', 2)
  const transition = vi.fn(async (command) => {
    current = status(command.to, command.expectedRevision + 1)
    return current
  })
  return {
    value: {
      requestClosure: vi.fn(),
      getStatus: vi.fn(),
      cancelClosure: vi.fn(),
      // The coordinator is the scheduled/operator path; reactivation is an
      // AccountAdmin command and must never be reachable from it.
      reactivate: vi.fn(),
      getAuthority: vi.fn(async () => current),
      listCandidates: vi.fn(async () => candidates),
      transition,
    } satisfies OrganizationLifecycleCommandStore,
    transition,
    setCurrent(next: OrganizationLifecycleStatus) {
      current = next
    },
  }
}

function coordinator(
  input: {
    candidates?: readonly OrganizationLifecycleStatus[]
    contributorSet?: readonly OrganizationLifecycleContributor[]
    authorize?: boolean
  } = {},
) {
  const lifecycleStore = store(input.candidates ?? [])
  const authorize = vi.fn(async () => input.authorize ?? true)
  return {
    value: createOrganizationLifecycleCoordinator({
      store: lifecycleStore.value,
      contributors: input.contributorSet ?? contributors(),
      supportAuthorization: { authorize },
      clock: () => NOW,
    }),
    lifecycleStore,
    authorize,
  }
}

describe('Organization lifecycle staged coordinator', () => {
  it('refuses to start without every bounded-context contributor', () => {
    expect(() =>
      createOrganizationLifecycleCoordinator({
        store: store([]).value,
        contributors: contributors().slice(1),
        supportAuthorization: { authorize: vi.fn(async () => true) },
        clock: () => NOW,
      }),
    ).toThrow(/contributors are incomplete: activity/)
  })

  it('advances only complete closing, readiness, and purge receipt sets', async () => {
    const candidates = [
      status('closure_requested', 1),
      status('closing', 2),
      status('purging', 4),
    ]
    const harness = coordinator({ candidates })

    await expect(harness.value.runScheduledPass()).resolves.toEqual({
      examined: 3,
      transitioned: 3,
      failed: 0,
      closingPrepared: 1,
      purgePending: 1,
      closed: 1,
    })
    expect(harness.lifecycleStore.transition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ from: 'closure_requested', to: 'closing' }),
    )
    expect(harness.lifecycleStore.transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ from: 'closing', to: 'purge_pending' }),
    )
    expect(harness.lifecycleStore.transition).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ from: 'purging', to: 'closed' }),
    )
    for (const command of harness.lifecycleStore.transition.mock.calls) {
      expect(command[0].supportEvidenceRef).toMatch(
        /^lifecycle:(closing|purge_readiness|purge):[a-f0-9]{64}$/,
      )
    }
  })

  it('leaves the authority unchanged when any context does not produce a receipt', async () => {
    const harness = coordinator({
      candidates: [status('closure_requested', 1)],
      contributorSet: contributors({ context: 'integration', phase: 'closing' }),
    })

    await expect(harness.value.runScheduledPass()).resolves.toMatchObject({
      examined: 1,
      transitioned: 0,
      failed: 1,
    })
    expect(harness.lifecycleStore.transition).not.toHaveBeenCalled()
  })

  it('requires independent authorization, exact lineage/revision, and typed waiver', async () => {
    const harness = coordinator({ authorize: true })
    harness.lifecycleStore.setCurrent(status('closing', 2))

    await expect(
      harness.value.waiveRecoveryWindow({
        organizationId: 'org-1',
        closureLineageId: LINEAGE,
        expectedRevision: 2,
        operatorUserId: 'operator-1',
        supportEvidenceRef: 'support:CASE-1',
        authorizationEvidenceRef: 'legal:APPROVAL-1',
        typedConfirmation: 'WAIVE RECOVERY org-1',
      }),
    ).resolves.toMatchObject({ state: 'purge_pending', revision: 3 })
    expect(harness.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'waive_recovery' }),
    )
    expect(harness.lifecycleStore.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'closing',
        to: 'purge_pending',
        reasonCode: 'recovery_window_waived',
        supportEvidenceRef: expect.stringMatching(
          /^lifecycle:waive_recovery:[a-f0-9]{64}$/,
        ),
      }),
    )
  })

  it('crosses the irreversible boundary only from purge pending under exact confirmation', async () => {
    const harness = coordinator({ authorize: true })
    harness.lifecycleStore.setCurrent(status('purge_pending', 3))

    await expect(
      harness.value.beginIrreversiblePurge({
        organizationId: 'org-1',
        closureLineageId: LINEAGE,
        expectedRevision: 3,
        operatorUserId: 'operator-1',
        supportEvidenceRef: 'support:CASE-1',
        authorizationEvidenceRef: 'security:APPROVAL-1',
        typedConfirmation: 'BEGIN IRREVERSIBLE PURGE org-1',
      }),
    ).resolves.toMatchObject({ state: 'purging', revision: 4 })
    expect(harness.lifecycleStore.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'purge_pending',
        to: 'purging',
        reasonCode: 'irreversible_purge_authorized',
        supportEvidenceRef: expect.stringMatching(
          /^lifecycle:begin_irreversible_purge:[a-f0-9]{64}$/,
        ),
      }),
    )
  })

  it('allows support to cancel Purge Pending before the irreversible boundary without reactivation', async () => {
    const harness = coordinator({ authorize: true })
    harness.lifecycleStore.setCurrent(status('purge_pending', 3))

    await expect(
      harness.value.cancelPendingPurge({
        organizationId: 'org-1',
        closureLineageId: LINEAGE,
        expectedRevision: 3,
        operatorUserId: 'operator-1',
        supportEvidenceRef: 'support:CASE-2',
        authorizationEvidenceRef: 'support:APPROVAL-2',
        typedConfirmation: 'CANCEL PENDING PURGE org-1',
      }),
    ).resolves.toMatchObject({
      state: 'active',
      revision: 4,
      reactivationRequired: true,
    })
    expect(harness.lifecycleStore.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'purge_pending',
        to: 'active',
        reasonCode: 'purge_cancelled_before_irreversible',
        supportEvidenceRef: expect.stringMatching(
          /^lifecycle:cancel_pending_purge:[a-f0-9]{64}$/,
        ),
      }),
    )
  })

  it('denies the irreversible boundary without support authorization', async () => {
    const harness = coordinator({ authorize: false })
    harness.lifecycleStore.setCurrent(status('purge_pending', 3))

    await expect(
      harness.value.beginIrreversiblePurge({
        organizationId: 'org-1',
        closureLineageId: LINEAGE,
        expectedRevision: 3,
        operatorUserId: 'operator-1',
        supportEvidenceRef: 'support:CASE-1',
        authorizationEvidenceRef: 'security:DENIED-1',
        typedConfirmation: 'BEGIN IRREVERSIBLE PURGE org-1',
      }),
    ).rejects.toThrow(/authorization denied/)
    expect(harness.lifecycleStore.transition).not.toHaveBeenCalled()
  })
})
