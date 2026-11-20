// Response-target server functions, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Inbox API.
// The policy and analytics rules sit in the use-case and store suites; this
// file holds the boundary: who may call, the scope each call is narrowed to and
// the policy rows left behind.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  getGoogleReviewTargetAnalyticsFn,
  getPrivateFeedbackTargetAnalyticsFn,
  getResponseTargetPolicySettingsFn,
  setResponseTargetPolicyFn,
} from './inbox-response-targets'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'inbox_private_feedback_target_property_overrides',
    'inbox_response_target_organization_policies',
    ...REVIEW_SEED_TABLES,
  ],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const other = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property, other }
}

const organizationPolicy = (expectedPolicyVersion: number | null) =>
  ({
    scope: 'organization',
    targetKind: 'private_feedback_handling',
    durationMinutes: 1_440,
    expectedPolicyVersion,
  }) as const

async function storedPolicies(organizationId: string) {
  const { rows } = await harness.pool().query<{
    target_kind: string
    duration_minutes: number
    policy_version: string
  }>(
    `SELECT target_kind, duration_minutes, policy_version
       FROM inbox_response_target_organization_policies
      WHERE organization_id = $1`,
    [organizationId],
  )
  return rows
}

async function storedOverrides(organizationId: string) {
  const { rows } = await harness.pool().query<{
    property_id: string
    duration_minutes: number | null
  }>(
    `SELECT property_id, duration_minutes
       FROM inbox_private_feedback_target_property_overrides
      WHERE organization_id = $1`,
    [organizationId],
  )
  return rows
}

describe('response-target server functions', () => {
  it('declare their methods', () => {
    expect(getResponseTargetPolicySettingsFn).toHaveProperty('method', 'GET')
    expect(getPrivateFeedbackTargetAnalyticsFn).toHaveProperty('method', 'GET')
    expect(getGoogleReviewTargetAnalyticsFn).toHaveProperty('method', 'GET')
    expect(setResponseTargetPolicyFn).toHaveProperty('method', 'POST')
  })
})

describe('getResponseTargetPolicySettingsFn', () => {
  it('reads the Organization policy with no Property override when no Property is named', async () => {
    const { admin } = await hotel()

    const settings = await harness.callAs(admin, () =>
      getResponseTargetPolicySettingsFn({ data: {} }),
    )

    expect(settings.privateFeedbackPropertyOverride).toBeNull()
    expect(settings.organization.privateFeedbackHandling).toMatchObject({
      policySource: 'builtin_default',
      policyVersion: null,
    })
  })

  it('narrows to the named Property', async () => {
    const { admin, property } = await hotel()

    const settings = await harness.callAs(admin, () =>
      getResponseTargetPolicySettingsFn({ data: { propertyId: property.id } }),
    )

    expect(settings.privateFeedbackPropertyOverride).toMatchObject({
      propertyId: property.id,
      durationMinutes: null,
      effectiveSource: 'builtin_default',
    })
  })

  it('is refused to a PropertyManager, who cannot update the Organization', async () => {
    const { manager } = await hotel()

    await expect(
      harness.callAs(manager, () => getResponseTargetPolicySettingsFn({ data: {} })),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => getResponseTargetPolicySettingsFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => getResponseTargetPolicySettingsFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('setResponseTargetPolicyFn', () => {
  it('writes the Organization policy for an AccountAdmin without a Property scope', async () => {
    const { organization, admin } = await hotel()

    const written = await harness.callAs(admin, () =>
      setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
    )

    expect(written).toMatchObject({
      scope: 'organization',
      targetKind: 'private_feedback_handling',
      propertyId: null,
      durationMinutes: 1_440,
      policyVersion: 1,
    })
    expect(await storedPolicies(organization.id)).toEqual([
      expect.objectContaining({
        target_kind: 'private_feedback_handling',
        duration_minutes: 1_440,
        policy_version: '1',
      }),
    ])
    expect(await storedOverrides(organization.id)).toEqual([])
  })

  it('writes a Property override and then the null that clears it', async () => {
    const { organization, admin, property } = await hotel()

    const written = await harness.callAs(admin, () =>
      setResponseTargetPolicyFn({
        data: {
          scope: 'property',
          propertyId: property.id,
          durationMinutes: 60,
          expectedPolicyVersion: null,
        },
      }),
    )
    expect(written).toMatchObject({
      scope: 'property',
      propertyId: property.id,
      durationMinutes: 60,
    })
    expect(await storedOverrides(organization.id)).toEqual([
      expect.objectContaining({ property_id: property.id, duration_minutes: 60 }),
    ])

    await harness.callAs(admin, () =>
      setResponseTargetPolicyFn({
        data: {
          scope: 'property',
          propertyId: property.id,
          durationMinutes: null,
          expectedPolicyVersion: written.policyVersion,
        },
      }),
    )
    expect(await storedOverrides(organization.id)).toEqual([
      expect.objectContaining({ property_id: property.id, duration_minutes: null }),
    ])
  })

  it('surfaces a stale policy version as a 409 and shows the stored version on the next read', async () => {
    const { organization, admin } = await hotel()
    await harness.callAs(admin, () =>
      setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
    )

    await expect(
      harness.callAs(admin, () =>
        setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
      ),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'revision_conflict',
      status: 409,
    })

    const settings = await harness.callAs(admin, () =>
      getResponseTargetPolicySettingsFn({ data: {} }),
    )
    expect(settings.organization.privateFeedbackHandling).toMatchObject({
      policySource: 'organization_policy',
      policyVersion: 1,
    })
    expect(await storedPolicies(organization.id)).toHaveLength(1)
  })

  it('is refused to a PropertyManager and writes nothing', async () => {
    const { organization, manager } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(await storedPolicies(organization.id)).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await storedPolicies(organization.id)).toEqual([])
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () =>
        setResponseTargetPolicyFn({ data: organizationPolicy(null) }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('does not write a Property override for a Property of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        setResponseTargetPolicyFn({
          data: {
            scope: 'property',
            propertyId: property.id,
            durationMinutes: 60,
            expectedPolicyVersion: null,
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(await storedOverrides(elsewhere.id)).toEqual([])
  })
})

describe('target analytics reads', () => {
  it('keeps the two reads on their own measures', async () => {
    const { admin } = await hotel()

    const privateFeedback = await harness.callAs(admin, () =>
      getPrivateFeedbackTargetAnalyticsFn({ data: {} }),
    )
    const google = await harness.callAs(admin, () =>
      getGoogleReviewTargetAnalyticsFn({ data: {} }),
    )

    expect(privateFeedback).toMatchObject({ targetKind: 'private_feedback_handling' })
    expect(google).toMatchObject({ targetKind: 'google_review_response' })
  })

  it('counts only the named Property when one is given', async () => {
    const { admin, property, other } = await hotel()
    await harness.seedInboxItem({ feedback: property })
    await harness.seedInboxItem({ feedback: other })

    const everywhere = await harness.callAs(admin, () =>
      getPrivateFeedbackTargetAnalyticsFn({ data: {} }),
    )
    const named = await harness.callAs(admin, () =>
      getPrivateFeedbackTargetAnalyticsFn({ data: { propertyId: property.id } }),
    )

    expect(everywhere.activeCount).toBe(2)
    expect(named.activeCount).toBe(1)
  })

  it('answers a PropertyManager over the granted Properties, though the policy is refused', async () => {
    const { manager, property, other } = await hotel()
    await harness.seedInboxItem({ feedback: property })
    await harness.seedInboxItem({ feedback: other })

    const privateFeedback = await harness.callAs(manager, () =>
      getPrivateFeedbackTargetAnalyticsFn({ data: {} }),
    )
    const google = await harness.callAs(manager, () =>
      getGoogleReviewTargetAnalyticsFn({ data: {} }),
    )

    expect(privateFeedback.activeCount).toBe(1)
    expect(google.targetKind).toBe('google_review_response')
  })

  it('refuses a PropertyManager a Property that was not granted', async () => {
    const { manager, other } = await hotel()

    await expect(
      harness.callAs(manager, () =>
        getPrivateFeedbackTargetAnalyticsFn({ data: { propertyId: other.id } }),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => getGoogleReviewTargetAnalyticsFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => getPrivateFeedbackTargetAnalyticsFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})
