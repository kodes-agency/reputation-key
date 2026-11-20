// Property setup, read as signed-in members over PostgreSQL with the real
// tenant resolution and execution policy.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  type Capability,
} from '#/shared/auth/beta-capabilities'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestPortal,
  type TestProperty,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getPropertySetupFn, listPropertySetupSummariesFn } from './property-setup'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'property_responsible_managers',
  ],
})

async function withCapabilitiesOff<T>(
  capabilities: readonly Capability[],
  run: () => Promise<T>,
): Promise<T> {
  initCapabilityPolicyStore({
    isCapabilityKilled: (capability) => capabilities.includes(capability),
    isOrgSuspended: () => false,
  })
  try {
    return await run()
  } finally {
    initCapabilityPolicyStore(harness.container().capabilityPolicyStore)
  }
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

const setup = (propertyId: string) => getPropertySetupFn({ data: { propertyId } })

function statuses(result: Awaited<ReturnType<typeof setup>>) {
  return Object.fromEntries(result.steps.map((step) => [step.key, step.status]))
}

async function responsibleManager(property: TestProperty, member: TestMember) {
  await harness.pool().query(
    `INSERT INTO property_responsible_managers
       (organization_id, property_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $3, NOW() - interval '1 day', $3)`,
    [property.organizationId, property.id, member.userId],
  )
}

async function publishPortal(portal: TestPortal, by: TestMember) {
  const snapshot = randomUUID()
  await harness
    .pool()
    .query(`UPDATE portals SET publication_state = 'published' WHERE id = $1`, [
      portal.id,
    ])
  await harness.pool().query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version,
       configuration_digest, configuration, guest_locale,
       language_pack_version, private_feedback_threshold, destination_uri,
       destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES (
       $1, $2, $3, $4, 1, repeat('a', 64), '{}'::jsonb, 'en',
       'guest-ui-en-v1', 3, 'https://example.test/review', NOW(), 0, 1, $5, NOW()
     )`,
    [snapshot, portal.organizationId, portal.propertyId, portal.id, by.userId],
  )
  await harness.pool().query(
    `INSERT INTO portal_publication_activations (
       id, organization_id, property_id, portal_id, snapshot_id,
       activation_sequence, kind, activated_by, activated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'publish', $6, NOW())`,
    [
      randomUUID(),
      portal.organizationId,
      portal.propertyId,
      portal.id,
      snapshot,
      by.userId,
    ],
  )
}

async function googleReviewCount(property: TestProperty, reviewCount: number) {
  await harness.pool().query(
    `INSERT INTO metric_current_google_reputation_snapshots
       (property_id, organization_id, source_epoch, source_run_id, source_event_id,
        review_count, average_rating, evaluated_at)
     VALUES ($1, $2, 0, $3, $4, $5, 4.3, NOW())`,
    [property.id, property.organizationId, randomUUID(), randomUUID(), reviewCount],
  )
}

describe('getPropertySetupFn', () => {
  it('gives an AccountAdmin the setup steps of a new Property as work to do', async () => {
    const { admin, property } = await hotel()

    const result = await harness.callAs(admin, () => setup(property.id))

    expect(result.propertyId).toBe(property.id)
    expect(statuses(result)).toEqual({
      google_linked: 'pending',
      reviews_synced: 'pending',
      reply_language: 'pending',
      ai_decision: 'pending',
      responsible_manager: 'pending',
      reply_voice: 'pending',
      portal_published: 'pending',
    })
  })

  it('leaves Google linking and the AI decision to an AccountAdmin when a PropertyManager reads', async () => {
    const { manager, property } = await hotel()

    const result = await harness.callAs(manager, () => setup(property.id))

    expect(statuses(result)).toMatchObject({
      google_linked: 'needs_admin',
      ai_decision: 'needs_admin',
      reply_language: 'pending',
    })
  })

  it('reflects the facts of the Property', async () => {
    const { admin, property } = await hotel()
    await harness
      .pool()
      .query(`UPDATE properties SET default_reply_language = 'en-Latn' WHERE id = $1`, [
        property.id,
      ])
    await responsibleManager(property, admin)
    await publishPortal(await harness.seedPortal(property), admin)

    const result = await harness.callAs(admin, () => setup(property.id))

    expect(statuses(result)).toMatchObject({
      reply_language: 'complete',
      responsible_manager: 'complete',
      portal_published: 'complete',
      google_linked: 'pending',
    })
  })

  it('offers the rating goal step once Google counts ten reviews, and counts "Not now" as decided', async () => {
    const { admin, property } = await hotel()
    await googleReviewCount(property, 10)

    const offered = await harness.callAs(admin, () => setup(property.id))
    await harness.pool().query(
      `INSERT INTO property_rating_goal_deferrals
         (property_id, organization_id, deferred_by, deferred_at)
       VALUES ($1, $2, $3, NOW())`,
      [property.id, property.organizationId, admin.userId],
    )
    const deferred = await harness.callAs(admin, () => setup(property.id))

    expect(statuses(offered).rating_goal).toBe('pending')
    expect(statuses(deferred).rating_goal).toBe('deferred')
  })

  it('leaves the rating goal step out while Goals are off', async () => {
    const { admin, property } = await hotel()
    await googleReviewCount(property, 10)

    const result = await harness.callAs(admin, () =>
      withCapabilitiesOff(['goal.use'], () => setup(property.id)),
    )

    expect(statuses(result)).not.toHaveProperty('rating_goal')
    expect(statuses(result)).toHaveProperty('reply_language')
  })

  it('leaves the rating goal step out of the summaries while Goals are off', async () => {
    const { admin, property } = await hotel()
    await googleReviewCount(property, 10)

    const on = await harness.callAs(admin, () => listPropertySetupSummariesFn())
    const off = await harness.callAs(admin, () =>
      withCapabilitiesOff(['goal.use'], () => listPropertySetupSummariesFn()),
    )

    expect(on[0]?.stepCount).toBe(8)
    expect(off[0]?.stepCount).toBe(7)
  })

  it('offers the rating goal step to a PropertyManager, whose role may set goals', async () => {
    const { manager, property } = await hotel()
    await googleReviewCount(property, 10)

    const result = await harness.callAs(manager, () => setup(property.id))

    expect(statuses(result).rating_goal).toBe('pending')
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () => setup(property.id)),
    ).rejects.toMatchObject({
      code: 'scope_denied',
      status: 403,
    })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => setup(property.id)),
    ).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(harness.callAs(member, () => setup(property.id))).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(harness.callAs(null, () => setup(property.id))).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })
})

describe('listPropertySetupSummariesFn', () => {
  async function twoHotels() {
    const { organization, admin, manager, property } = await hotel()
    const other = await harness.seedProperty(organization)
    return { organization, admin, manager, property, other }
  }

  it('lists every Property of the Organization for an AccountAdmin', async () => {
    const { admin, property, other } = await twoHotels()

    const summaries = await harness.callAs(admin, () => listPropertySetupSummariesFn())

    expect(summaries.map((summary) => summary.propertyId).sort()).toEqual(
      [property.id, other.id].sort(),
    )
    expect(summaries[0]).toMatchObject({ stepCount: 7, completedCount: 0 })
  })

  it('lists only the Properties granted to a PropertyManager', async () => {
    const { manager, property } = await twoHotels()

    const summaries = await harness.callAs(manager, () => listPropertySetupSummariesFn())

    expect(summaries.map((summary) => summary.propertyId)).toEqual([property.id])
  })

  it('lists nothing for a PropertyManager with no grants', async () => {
    const { organization } = await twoHotels()
    const ungranted = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(ungranted, () => listPropertySetupSummariesFn()),
    ).resolves.toEqual([])
  })

  it('never lists the Properties of another Organization', async () => {
    const { property, other } = await twoHotels()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const foreign = await harness.seedProperty(elsewhere)

    const summaries = await harness.callAs(otherAdmin, () =>
      listPropertySetupSummariesFn(),
    )

    expect(summaries.map((summary) => summary.propertyId)).toEqual([foreign.id])
    expect(summaries.map((summary) => summary.propertyId)).not.toContain(property.id)
    expect(summaries.map((summary) => summary.propertyId)).not.toContain(other.id)
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await twoHotels()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => listPropertySetupSummariesFn()),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('refuses a caller with no session', async () => {
    await expect(
      harness.callAs(null, () => listPropertySetupSummariesFn()),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})
