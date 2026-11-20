// Property access administration and the policy diagnostic, called as
// signed-in members over PostgreSQL with the real tenant resolution, execution
// policy and policy-admin store.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  explainPolicyDecisionFn,
  grantPropertyAccessFn,
  revokePropertyAccessFn,
} from './policy-admin'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  return { organization, admin, manager, property }
}

const grantData = (member: TestMember, property: TestProperty) => ({
  userId: member.userId,
  propertyId: property.id,
  reason: 'covering for holiday',
  ticketRef: 'OPS-606',
})

async function grantRows(member: TestMember, property: TestProperty) {
  const { rows } = await harness.pool().query(
    `SELECT revoked_at FROM property_access_grant
     WHERE organization_id = $1 AND property_id = $2 AND user_id = $3`,
    [property.organizationId, property.id, member.userId],
  )
  return rows as { revoked_at: Date | null }[]
}

async function accessFacts(organizationId: string): Promise<number> {
  const { rows } = await harness.pool().query(
    `SELECT count(*)::int AS n FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'identity.member.property_access_changed'`,
    [organizationId],
  )
  return rows[0].n
}

describe('grantPropertyAccessFn', () => {
  it('grants a PropertyManager the Property and records the change', async () => {
    const { organization, admin, manager, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        grantPropertyAccessFn({ data: grantData(manager, property) }),
      ),
    ).resolves.toEqual({ ok: true })

    const rows = await grantRows(manager, property)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.revoked_at).toBeNull()
    expect(await accessFacts(organization.id)).toBe(1)
  })

  it('answers a grant to someone outside the Organization as not found', async () => {
    const { admin, property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'PropertyManager')

    await expect(
      harness.callAs(admin, () =>
        grantPropertyAccessFn({ data: grantData(stranger, property) }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'member_not_found',
      status: 404,
      message: 'The user is not a member of this organization',
    })
    expect(await grantRows(stranger, property)).toEqual([])
  })

  it('refuses a Property of another Organization and writes nothing', async () => {
    const { admin, manager } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreign = await harness.seedProperty(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        grantPropertyAccessFn({ data: grantData(manager, foreign) }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'The property is not in this organization',
    })
    expect(await grantRows(manager, foreign)).toEqual([])
  })

  it('refuses an expiry in the past and a reason that is too short', async () => {
    const { admin, manager, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        grantPropertyAccessFn({
          data: { ...grantData(manager, property), expiresAt: new Date('2020-01-01') },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error', status: 400 })
    await expect(
      harness.callAs(admin, () =>
        grantPropertyAccessFn({
          data: { ...grantData(manager, property), reason: 'ab' },
        }),
      ),
    ).rejects.toThrow(/reason is required/)
    expect(await grantRows(manager, property)).toEqual([])
  })

  it('refuses a PropertyManager, a staff-only login and a caller with no session', async () => {
    const { organization, manager, property } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(manager, () =>
        grantPropertyAccessFn({ data: grantData(manager, property) }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    await expect(
      harness.callAs(staff, () =>
        grantPropertyAccessFn({ data: grantData(manager, property) }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () =>
        grantPropertyAccessFn({ data: grantData(manager, property) }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(await grantRows(manager, property)).toEqual([])
  })

  it("does not let another Organization's AccountAdmin grant on this Property", async () => {
    const { manager, property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(stranger, () =>
        grantPropertyAccessFn({ data: grantData(manager, property) }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
      message: 'The property is not in this organization',
    })
    expect(await grantRows(manager, property)).toEqual([])
    expect(await accessFacts(property.organizationId)).toBe(0)
  })

  it('answers an untagged database fault as a sanitized internal error', async () => {
    const { admin, manager } = await hotel()

    const failure = await harness
      .callAs(admin, () =>
        grantPropertyAccessFn({
          data: {
            ...grantData(manager, { id: 'not-a-uuid', organizationId: '' }),
            reason: 'private reason',
          },
        }),
      )
      .then(
        () => null,
        (error: unknown) => error as Error & { code: string; status: number },
      )

    expect(failure).toMatchObject({ code: 'internal_error', status: 500 })
    expect(failure?.message).toBe('Internal server error')
  })
})

describe('revokePropertyAccessFn', () => {
  it('revokes the access and records the change', async () => {
    const { organization, admin, manager, property } = await hotel()
    await harness.callAs(admin, () =>
      grantPropertyAccessFn({ data: grantData(manager, property) }),
    )

    await harness.callAs(admin, () =>
      revokePropertyAccessFn({
        data: { userId: manager.userId, propertyId: property.id, reason: 'cover ended' },
      }),
    )

    const rows = await grantRows(manager, property)
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true)
    expect(await accessFacts(organization.id)).toBe(2)
  })

  it('answers a Property outside the Organization as the validation error it is', async () => {
    const { admin, manager } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const foreign = await harness.seedProperty(elsewhere)

    await expect(
      harness.callAs(admin, () =>
        revokePropertyAccessFn({
          data: { userId: manager.userId, propertyId: foreign.id, reason: 'cover ended' },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
    })
  })

  it('does not read an untagged failure as a refusal because of its wording', async () => {
    const { admin, manager } = await hotel()
    const reason = 'no longer required'

    const failure = await harness
      .callAs(admin, () =>
        revokePropertyAccessFn({
          data: { userId: manager.userId, propertyId: 'not-a-uuid', reason },
        }),
      )
      .then(
        () => null,
        (error: unknown) => error as Error & { code: string; status: number },
      )

    expect(failure).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
    expect(failure?.message).not.toContain(reason)
  })

  it('refuses a PropertyManager and leaves the grant alone', async () => {
    const { admin, manager, property } = await hotel()
    await harness.callAs(admin, () =>
      grantPropertyAccessFn({ data: grantData(manager, property) }),
    )

    await expect(
      harness.callAs(manager, () =>
        revokePropertyAccessFn({
          data: {
            userId: manager.userId,
            propertyId: property.id,
            reason: 'cover ended',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    expect((await grantRows(manager, property))[0]!.revoked_at).toBeNull()
  })
})

describe('explainPolicyDecisionFn', () => {
  const explain = (propertyId: string, userId?: string) => ({
    data: { action: 'property.read_gbp_performance', propertyId, userId },
  })

  it('explains the decision for the diagnosed member and adds the capability refusal report', async () => {
    const { organization, admin, manager, property } = await hotel()
    await harness.grantProperty(manager, property)
    const action = 'property.read_gbp_performance'
    const { policyAdmin } = harness.container()
    const explanation = await policyAdmin.explainPolicyDecision({
      organizationId: organization.id,
      action,
      propertyId: property.id,
      userId: manager.userId,
      now: new Date(),
    })
    const capabilityRefusal = await policyAdmin.explainCapabilityRefusal({
      capability: action,
      organizationId: organization.id,
      propertyId: property.id,
      role: 'AccountAdmin',
      userId: manager.userId,
      permissionScope: {
        allowed: explanation.checks.permission.allowed,
        scopeOutcome: explanation.checks.scope.outcome,
      },
    })

    const response = await harness.callAs(admin, () =>
      explainPolicyDecisionFn(explain(property.id, manager.userId)),
    )

    expect(explanation.checks.scope.outcome).toBe('granted')
    expect(response).toEqual({ ...explanation, capabilityRefusal })
    expect(response.capabilityRefusal).toMatchObject({
      capability: action,
      allowed: false,
    })
  })

  it('reports a missing grant for a PropertyManager who was not given the Property', async () => {
    const { admin, manager, property } = await hotel()

    const response = await harness.callAs(admin, () =>
      explainPolicyDecisionFn(explain(property.id, manager.userId)),
    )

    expect(response.checks.scope.outcome).toBe('missing_grant')
  })

  it('refuses a PropertyManager, a staff-only login and a caller with no session', async () => {
    const { organization, manager, property } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(manager, () => explainPolicyDecisionFn(explain(property.id))),
    ).rejects.toMatchObject({ code: 'permission_denied', status: 403 })
    await expect(
      harness.callAs(staff, () => explainPolicyDecisionFn(explain(property.id))),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () => explainPolicyDecisionFn(explain(property.id))),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it("explains nothing about this Organization's member to another Organization's AccountAdmin", async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    const response = await harness.callAs(stranger, () =>
      explainPolicyDecisionFn(explain(property.id, manager.userId)),
    )

    expect(response).toMatchObject({
      allowed: false,
      reason: 'not_a_member',
      checks: { scope: { outcome: 'not_applicable' } },
    })
  })

  it("reads another Organization's Property only as the caller's own Organization", async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const stranger = await harness.seedMember(elsewhere, 'AccountAdmin')

    const response = await harness.callAs(stranger, () =>
      explainPolicyDecisionFn(explain(property.id)),
    )

    expect(response.checks.scope.outcome).toBe('organization')
  })
})
