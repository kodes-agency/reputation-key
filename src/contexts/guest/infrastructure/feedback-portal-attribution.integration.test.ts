import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { feedbackId, organizationId, portalId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createFeedbackPortalAttributionLookup } from './feedback-portal-attribution'

const ORG_A = organizationId('b7200000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7200000-0000-4000-8000-000000000002')
const PROPERTY_A = 'b7200000-0000-4000-8000-000000000010'
const PORTAL_A = portalId('b7200000-0000-4000-8000-000000000020')
const RESPONSE = feedbackId('b7200000-0000-4000-8000-000000000030')
const LEGACY_FEEDBACK = feedbackId('b7200000-0000-4000-8000-000000000031')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'guest_response_private_feedback',
    'guest_responses',
    'feedback',
    'portals',
    'properties',
  ],
})

async function seedPropertyAndPortal(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Guest Property', $3, 'UTC')`,
    [PROPERTY_A, ORG_A, `property-${PROPERTY_A}`],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Guest Portal', $4)`,
    [PORTAL_A, ORG_A, PROPERTY_A, `portal-${PORTAL_A}`],
  )
}

const lookup = () =>
  createFeedbackPortalAttributionLookup(drizzle(getPool()) as unknown as Database)

describe('Guest feedback Portal attribution', () => {
  it('resolves a canonical, non-deleted response inside its Organization', async () => {
    await seedPropertyAndPortal()
    await getPool().query(
      `INSERT INTO guest_responses
         (id, organization_id, property_id, portal_id, status,
          response_consent, text_consent, retention_deadline)
       VALUES ($1, $2, $3, $4, 'submitted', true, true,
               NOW() + INTERVAL '24 months')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )
    await getPool().query(
      `INSERT INTO guest_response_private_feedback
         (response_id, organization_id, property_id, portal_id, body,
          submitted_at, expires_at)
       VALUES ($1, $2, $3, $4, 'content is not returned', NOW(),
               NOW() + INTERVAL '90 days')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )

    await expect(lookup()(ORG_A, RESPONSE)).resolves.toBe(PORTAL_A)
  })

  it('does not leak canonical attribution across Organizations', async () => {
    await seedPropertyAndPortal()
    await getPool().query(
      `INSERT INTO guest_responses
         (id, organization_id, property_id, portal_id, status,
          response_consent, text_consent, retention_deadline)
       VALUES ($1, $2, $3, $4, 'submitted', true, true,
               NOW() + INTERVAL '24 months')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )
    await getPool().query(
      `INSERT INTO guest_response_private_feedback
         (response_id, organization_id, property_id, portal_id, body,
          submitted_at, expires_at)
       VALUES ($1, $2, $3, $4, 'content is not returned', NOW(),
               NOW() + INTERVAL '90 days')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )

    await expect(lookup()(ORG_B, RESPONSE)).resolves.toBeNull()
  })

  it('does not route a delayed notification after canonical text expiry', async () => {
    await seedPropertyAndPortal()
    await getPool().query(
      `INSERT INTO guest_responses
         (id, organization_id, property_id, portal_id, status,
          response_consent, text_consent, retention_deadline)
       VALUES ($1, $2, $3, $4, 'submitted', true, true,
               NOW() + INTERVAL '24 months')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )
    await getPool().query(
      `INSERT INTO guest_response_private_feedback
         (response_id, organization_id, property_id, portal_id, body,
          submitted_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'expired content', NOW() - INTERVAL '91 days',
               NOW() - INTERVAL '1 day', NOW() - INTERVAL '91 days')`,
      [RESPONSE, ORG_A, PROPERTY_A, PORTAL_A],
    )

    await expect(lookup()(ORG_A, RESPONSE)).resolves.toBeNull()
  })

  it('preserves Portal attribution for a reconciled legacy feedback source', async () => {
    await seedPropertyAndPortal()
    await getPool().query(
      `INSERT INTO feedback
         (id, organization_id, property_id, portal_id, comment, source, created_at)
       VALUES ($1, $2, $3, $4, 'legacy text is not returned', 'qr', NOW())`,
      [LEGACY_FEEDBACK, ORG_A, PROPERTY_A, PORTAL_A],
    )

    await expect(lookup()(ORG_A, LEGACY_FEEDBACK)).resolves.toBe(PORTAL_A)
  })
})
