import { describe, expect, it, vi } from 'vitest'
import {
  ORGANIZATION_REACTIVATION_CHECKS,
  type OrganizationLifecycleStatus,
  type OrganizationReactivationAcknowledgement,
  type OrganizationReactivationCheckId,
} from '../../domain/organization-lifecycle'
import { createOrganizationReactivationReadiness } from '../ports/organization-reactivation-readiness.port'
import {
  OrganizationReactivationBlocked,
  reactivateOrganization,
} from './reactivate-organization'

const ORGANIZATION = 'org-1'
const ACTOR = 'user-admin'
const LINEAGE = '11111111-1111-4111-8111-111111111111'
const OPERATION = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-08-28T12:00:00.000Z')

const awaitingReactivation: OrganizationLifecycleStatus = {
  organizationId: ORGANIZATION,
  state: 'active',
  revision: 4,
  closureLineageId: LINEAGE,
  closureRequestedAt: new Date('2026-07-01T00:00:00.000Z'),
  recoverableUntil: new Date('2026-07-31T00:00:00.000Z'),
  irreversibleAt: null,
  closedAt: null,
  reactivationRequired: true,
  lastTransitionAt: new Date('2026-07-10T00:00:00.000Z'),
  lastActorId: ACTOR,
  lastReasonCode: 'closure_cancelled',
  lastSupportEvidenceRef: 'support:ticket-1',
}

const reactivated: OrganizationLifecycleStatus = {
  ...awaitingReactivation,
  revision: 5,
  closureLineageId: null,
  closureRequestedAt: null,
  recoverableUntil: null,
  reactivationRequired: false,
  lastReasonCode: 'explicit_reactivation',
}

const acknowledgements: readonly OrganizationReactivationAcknowledgement[] = [
  { id: 'portal_republished', actorUserId: ACTOR, reasonCode: 'portal_restored' },
  { id: 'ai_capability_reviewed', actorUserId: ACTOR, reasonCode: 'ai_left_disabled' },
  { id: 'google_reauthorized', actorUserId: ACTOR, reasonCode: 'fresh_consent' },
]

const readinessOf = (unsatisfied: readonly OrganizationReactivationCheckId[] = []) => ({
  evaluate: async () =>
    ORGANIZATION_REACTIVATION_CHECKS.map((id) => ({
      id,
      satisfied: !unsatisfied.includes(id),
      detailCode: unsatisfied.includes(id) ? 'not_ready' : 'ready',
    })),
})

function harness(
  overrides: Readonly<{
    status?: OrganizationLifecycleStatus
    unsatisfied?: readonly OrganizationReactivationCheckId[]
  }> = {},
) {
  const reactivate = vi.fn(async () => reactivated)
  const getStatus = vi.fn(async () => overrides.status ?? awaitingReactivation)
  const refreshPolicy = vi.fn(async () => {})
  const useCase = reactivateOrganization({
    store: { getStatus, reactivate },
    readiness: readinessOf(overrides.unsatisfied),
    clock: () => NOW,
    refreshPolicy,
  })
  return { useCase, reactivate, getStatus, refreshPolicy }
}

const run = (
  useCase: ReturnType<typeof reactivateOrganization>,
  ack: readonly OrganizationReactivationAcknowledgement[] = acknowledgements,
) =>
  useCase({
    operationId: OPERATION,
    organizationId: ORGANIZATION,
    actorUserId: ACTOR,
    acknowledgements: ack,
  })

describe('reactivateOrganization', () => {
  it.each(ORGANIZATION_REACTIVATION_CHECKS)(
    'refuses reactivation while the %s check fails',
    async (failing) => {
      const { useCase, reactivate } = harness({ unsatisfied: [failing] })

      const error = await run(useCase).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(OrganizationReactivationBlocked)
      expect((error as OrganizationReactivationBlocked).unsatisfiedChecks).toEqual([
        failing,
      ])
      expect(reactivate).not.toHaveBeenCalled()
    },
  )

  it('refuses when a probe cannot answer rather than treating silence as ready', async () => {
    const readiness = createOrganizationReactivationReadiness({
      data_cell_health: async () => ({ satisfied: true, detailCode: 'ready' }),
      responsible_manager: async () => {
        throw new Error('lookup unavailable')
      },
      google_authorization: async () => ({ satisfied: true, detailCode: 'ready' }),
      portal_reactivation: async () => ({ satisfied: true, detailCode: 'ready' }),
      schedule_quarantine_cleared: async () => ({ satisfied: true, detailCode: 'ready' }),
    })

    const checks = await readiness.evaluate({
      organizationId: ORGANIZATION,
      closureLineageId: LINEAGE,
      now: NOW,
    })

    expect(
      checks.find(
        (check: { id: OrganizationReactivationCheckId }) =>
          check.id === 'responsible_manager',
      ),
    ).toEqual({
      id: 'responsible_manager',
      satisfied: false,
      detailCode: 'probe_unavailable',
    })
  })

  it.each([
    'portal_republished',
    'ai_capability_reviewed',
    'google_reauthorized',
  ] as const)(
    'never performs %s itself — a missing deliberate action refuses reactivation',
    async (missing) => {
      const { useCase, reactivate } = harness()

      const error = await run(
        useCase,
        acknowledgements.filter((entry) => entry.id !== missing),
      ).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(OrganizationReactivationBlocked)
      expect((error as OrganizationReactivationBlocked).missingAcknowledgements).toEqual([
        missing,
      ])
      expect(reactivate).not.toHaveBeenCalled()
    },
  )

  it('refuses a machine-authored deliberate action', async () => {
    const { useCase, reactivate } = harness()

    const error = await run(useCase, [
      { id: 'portal_republished', actorUserId: 'system:lifecycle', reasonCode: 'auto' },
      ...acknowledgements.slice(1),
    ]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OrganizationReactivationBlocked)
    expect((error as OrganizationReactivationBlocked).missingAcknowledgements).toEqual([
      'portal_republished',
    ])
    expect(reactivate).not.toHaveBeenCalled()
  })

  it('clears the fence with compare-and-set evidence once every check passes', async () => {
    const { useCase, reactivate, refreshPolicy } = harness()

    const result = await run(useCase)

    expect(reactivate).toHaveBeenCalledWith({
      operationId: OPERATION,
      organizationId: ORGANIZATION,
      actorUserId: ACTOR,
      expectedRevision: 4,
      closureLineageId: LINEAGE,
      supportEvidenceRef: expect.stringMatching(/^lifecycle:reactivation:[a-f0-9]{64}$/u),
      now: NOW,
    })
    expect(result.status.reactivationRequired).toBe(false)
    expect(result.status.revision).toBe(5)
    expect(refreshPolicy).toHaveBeenCalledOnce()
  })

  it('digests the same decision to the same evidence regardless of input order', async () => {
    const first = await run(harness().useCase)
    const second = await run(harness().useCase, [...acknowledgements].reverse())

    expect(second.evidenceRef).toBe(first.evidenceRef)
  })

  it('refuses an Organization that is not awaiting explicit reactivation', async () => {
    const { useCase, reactivate } = harness({
      status: { ...awaitingReactivation, reactivationRequired: false },
    })

    await expect(run(useCase)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'forbidden',
    })
    expect(reactivate).not.toHaveBeenCalled()
  })

  it('refuses a closing Organization — cancel comes first, reactivation second', async () => {
    const { useCase, reactivate } = harness({
      status: { ...awaitingReactivation, state: 'closing' },
    })

    await expect(run(useCase)).rejects.toMatchObject({ code: 'forbidden' })
    expect(reactivate).not.toHaveBeenCalled()
  })

  it('requires a UUID operation id so a retry replays instead of double-lifting', async () => {
    const { useCase, getStatus } = harness()

    await expect(
      useCase({
        operationId: 'not-a-uuid',
        organizationId: ORGANIZATION,
        actorUserId: ACTOR,
        acknowledgements,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect(getStatus).not.toHaveBeenCalled()
  })
})
