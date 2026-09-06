import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationExecutionPermit } from './authorization-execution-permit'
import {
  createGoogleContentAuthorizationAuthority,
  type GoogleContentControlState,
  type GoogleContentAuthorityStore,
  type GoogleContentRuntimeBinding,
} from './google-content-authority'

const now = new Date('2026-08-10T10:00:00.000Z')

// WP2.2 step 3: two helpers used to live here, both deriving a runtime binding
// from a signed approval candidate by omitting `approvedAt`/`expiresAt`/`status`.
// A runtime binding is now just a capability, so there is nothing to derive.
const runtimeBinding = (
  capability: GoogleContentRuntimeBinding['capability'] = 'property.import_gbp_v2',
): GoogleContentRuntimeBinding => ({ capability })

type Tx = Readonly<Record<string, never>>

function createStore() {
  let control: GoogleContentControlState = {
    policyVersion: 12,
    emergencyKillVersion: 4,
    killedCapabilities: [],
  }
  const permits = new Map<
    string,
    Readonly<{
      permit: AuthorizationExecutionPermit
      authorizationVector: Readonly<Record<string, string | number | boolean | null>>
    }>
  >()
  let drained = false

  const store: GoogleContentAuthorityStore<Tx> = {
    transaction: (run) => run({}),
    loadControl: async () => control,
    insertPermit: async (_tx, record) => {
      permits.set(record.permit.id, record)
    },
    lockPermit: async (_tx, id, organizationId) => {
      const record = permits.get(id)
      if (
        !record ||
        (organizationId !== undefined && record.permit.organizationId !== organizationId)
      ) {
        return null
      }
      return record
    },
    listElapsedAdmittedPermitIds: async (_tx, input) =>
      [...permits.values()]
        .filter(
          (record) =>
            input.capabilities.includes(record.permit.capability) &&
            record.permit.state === 'admitted' &&
            record.permit.startDeadlineAt.getTime() < input.before.getTime(),
        )
        .sort(
          (left, right) =>
            left.permit.startDeadlineAt.getTime() -
            right.permit.startDeadlineAt.getTime(),
        )
        .slice(0, input.limit)
        .map((record) => record.permit.id),
    updatePermit: async (_tx, permit) => {
      const existing = permits.get(permit.id)
      if (!existing) throw new Error('missing permit')
      permits.set(permit.id, { ...existing, permit })
    },
    denyCapability: async (_tx, capability) => {
      control = {
        ...control,
        emergencyKillVersion: control.emergencyKillVersion + 1,
        killedCapabilities: [...new Set([...control.killedCapabilities, capability])],
      }
      return control.emergencyKillVersion
    },
    allowCapability: async (_tx, capability) => {
      control = {
        ...control,
        emergencyKillVersion: control.emergencyKillVersion + 1,
        killedCapabilities: control.killedCapabilities.filter(
          (killed) => killed !== capability,
        ),
      }
      return control.emergencyKillVersion
    },
    fenceActivePermits: async (_tx, capability, at) => {
      for (const record of permits.values()) {
        if (
          record.permit.capability === capability &&
          (record.permit.state === 'admitted' || record.permit.state === 'started')
        ) {
          permits.set(record.permit.id, {
            ...record,
            permit: { ...record.permit, state: 'fenced', fencedAt: at },
          })
        }
      }
    },
    hasActiveCapabilityWork: async () => false,
    hasActiveCleanupWork: async () => false,
    markCapabilityDrained: async () => {
      drained = true
    },
  }

  return {
    store,
    permits,
    setControl(next: typeof control) {
      control = next
    },
    control: () => control,
    isDrained: () => drained,
  }
}

const admissionInput = (
  expectedAuthorizationVector: Readonly<Record<string, string | number>> = {
    grantGeneration: 3,
  },
) => ({
  runtimeBinding: runtimeBinding(),
  scope: {
    organizationId: 'org-1',
    propertyId: null,
    connectionId: 'connection-1',
    initiatorUserId: 'user-1',
  },
  expectedApprovalBindingId: 'approval-1',
  expectedAuthorizationVector,
  operationKey: 'import.start',
  routeKey: 'google.business-information.locations.list',
  routeCatalogVersion: 'google-provider-routes-1',
  quotaPolicyId: 'gbp-business-information-interactive-1',
  providerRequestBinding: {
    requestBindingSha256: 'a'.repeat(64),
    credentialBinding: 'b'.repeat(64),
    projectFingerprint: 'c'.repeat(64),
    requestBodySha256: null,
    requestBodyBytes: 0,
  },
})

describe('Google Content authorization authority', () => {
  // WP2.2 removed the authority policy-refresh deny path because the deleted
  // counter comparisons were its only consumer.
  // WP2.2 step 3: a test asserting that only an exact valid five-role approval
  // chain persists lived here. Approval bundles, their role signatures and
  // their storage are all deleted, so it has no subject.

  it('preauthorizes against the current control and authorization vector', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { grantGeneration: 3, connectionGeneration: 8 },
      }),
    })

    await expect(
      authority.preauthorize({
        runtimeBinding: runtimeBinding(),
        scope: admissionInput().scope,
        operationKey: 'import.discovery',
      }),
    ).resolves.toEqual({
      ok: true,
      authorizationVector: { grantGeneration: 3, connectionGeneration: 8 },
    })
  })

  it('rejects admission when the preauthorized authorization vector changed', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 4 } }),
    })

    await expect(authority.admit(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
    })
    expect(memory.permits).toHaveLength(0)
  })

  it('fails closed while the capability kill is active', async () => {
    const memory = createStore()
    memory.setControl({
      policyVersion: 12,
      emergencyKillVersion: 5,
      killedCapabilities: ['property.import_gbp_v2'],
    })
    const authorize = vi.fn(async () => ({
      allowed: true as const,
      vector: { grantGeneration: 3 },
    }))
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize,
    })

    await expect(authority.admit(admissionInput())).resolves.toEqual({
      ok: false,
      code: 'capability_killed',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(memory.permits).toHaveLength(0)
  })

  // WP2.2 step 3: the signed-cohort admission test lived here. Cohort
  // containment came from the approval binding's organization list; it is now
  // enforced per request by `policyAuthorizes` re-querying
  // `organization_capability`, which the surviving tests cover.

  it('allows a killed capability only for a named operator', async () => {
    const memory = createStore()
    memory.setControl({
      policyVersion: 12,
      emergencyKillVersion: 5,
      killedCapabilities: ['property.import_gbp_v2'],
    })
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: (operatorId) => operatorId === 'operator-1',
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })

    await expect(
      authority.allowCapability(runtimeBinding(), 'unknown', 'approved rollout'),
    ).resolves.toEqual({ ok: false, code: 'operator_not_registered' })
    // A third case used to sit between these two: the same registered operator
    // being refused `approval_unavailable` until a valid bundle was installed.
    // Operator registration is now the only thing that authorizes re-allowing a
    // killed capability, which is what an operator can actually act on.
    await expect(
      authority.allowCapability(runtimeBinding(), 'operator-1', 'approved rollout'),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 6 })
    await expect(authority.admit(admissionInput())).resolves.toMatchObject({
      ok: true,
      permit: { state: 'admitted' },
    })
  })

  it('admits and starts only against the same tenant and authorization vector', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({
        allowed: true,
        vector: { grantGeneration: 3, connectionGeneration: 8 },
      }),
    })

    const admitted = await authority.admit(
      admissionInput({ grantGeneration: 3, connectionGeneration: 8 }),
    )
    expect(admitted).toMatchObject({ ok: true, permit: { state: 'admitted' } })
    expect(memory.permits.get('permit-1')?.authorizationVector).toEqual({
      grantGeneration: 3,
      connectionGeneration: 8,
      requestBindingSha256: 'a'.repeat(64),
      credentialBinding: 'b'.repeat(64),
      projectFingerprint: 'c'.repeat(64),
      requestBodySha256: null,
      requestBodyBytes: 0,
    })
    if (!admitted.ok) throw new Error('expected admission')
    expect(admitted.permit.startDeadlineAt).toEqual(new Date('2026-08-10T10:00:10.000Z'))

    await expect(authority.start(admitted.permit.id, 'other-org')).resolves.toEqual({
      ok: false,
      code: 'permit_unavailable',
    })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('admitted')

    await expect(
      authority.start(admitted.permit.id, admissionInput().scope.organizationId),
    ).resolves.toMatchObject({ ok: true, permit: { state: 'started' } })
  })

  it('reconstructs the frozen publication identity when revalidating a permit', async () => {
    const memory = createStore()
    const publication = {
      reviewId: '11111111-1111-4111-8111-111111111111',
      replyId: '22222222-2222-4222-8222-222222222222',
      publicationCycle: 2,
      attemptNumber: 3,
      sourceEpoch: 4,
      materialReviewRevision: 5,
    }
    const publicationVector = {
      reviewId: publication.reviewId,
      replyId: publication.replyId,
      publicationCycle: publication.publicationCycle,
      publicationAttemptNumber: publication.attemptNumber,
      propertySourceEpoch: publication.sourceEpoch,
      materialReviewRevision: publication.materialReviewRevision,
    }
    const authorize = vi.fn(async (_tx: Tx, input) =>
      input.scope.publication === undefined
        ? ({ allowed: false, code: 'authorization_denied' } as const)
        : ({ allowed: true, vector: publicationVector } as const),
    )
    const publicationRuntime = { capability: 'property.publish_reply' } as const
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-publication-1',
      isRegisteredOperator: () => true,
      authorize,
    })

    const admitted = await authority.admit({
      ...admissionInput(publicationVector),
      runtimeBinding: publicationRuntime,
      scope: {
        organizationId: 'org-1',
        propertyId: '33333333-3333-4333-8333-333333333333',
        connectionId: 'connection-1',
        initiatorUserId: null,
        publication,
      },
      operationKey: 'reply.publish',
      routeKey: 'google.my-business.reviews.reply',
    })
    if (!admitted.ok) throw new Error('expected publication admission')

    await expect(
      authority.start(admitted.permit.id, admitted.permit.organizationId),
    ).resolves.toMatchObject({ ok: true, permit: { state: 'started' } })
    expect(authorize).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        capability: 'property.publish_reply',
        scope: expect.objectContaining({ publication }),
      }),
    )
  })

  it('fences a permit when an authorization generation changes before start', async () => {
    const memory = createStore()
    let grantGeneration = 3
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration } }),
    })
    const admitted = await authority.admit(admissionInput())
    if (!admitted.ok) throw new Error('expected admission')
    grantGeneration = 4

    await expect(
      authority.start(admitted.permit.id, admissionInput().scope.organizationId),
    ).resolves.toEqual({ ok: false, code: 'authorization_changed' })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
  })
  it('fences a started permit at the exact operation deadline', async () => {
    const memory = createStore()
    let currentTime = now
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => currentTime,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })
    const admitted = await authority.admit(admissionInput())
    if (!admitted.ok) throw new Error('expected admission')
    const started = await authority.start(
      admitted.permit.id,
      admissionInput().scope.organizationId,
    )
    if (!started.ok) throw new Error('expected start')
    const operationDeadline = started.permit.operationDeadlineAt
    if (!operationDeadline) throw new Error('expected operation deadline')
    currentTime = operationDeadline

    await expect(
      authority.complete(admitted.permit.id, admissionInput().scope.organizationId),
    ).resolves.toEqual({ ok: false, code: 'operation_deadline_elapsed' })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
  })

  it('increments the kill generation, fences active work, and records drain completion', async () => {
    const memory = createStore()
    const authority = createGoogleContentAuthorizationAuthority({
      store: memory.store,
      clock: () => now,
      newPermitId: () => 'permit-1',
      isRegisteredOperator: () => true,
      authorize: async () => ({ allowed: true, vector: { grantGeneration: 3 } }),
    })
    await authority.admit(admissionInput())

    await expect(
      authority.denyCapability(
        'property.import_gbp_v2',
        'operator-1',
        'incident containment',
      ),
    ).resolves.toEqual({ ok: true, emergencyKillVersion: 5, drained: true })
    expect(memory.permits.get('permit-1')?.permit.state).toBe('fenced')
    expect(memory.isDrained()).toBe(true)
  })
})
