// Identity's rights executor against real PostgreSQL: Property A and B of one
// Organization beside a second Organization. A Property erasure removes that
// Property's access grants and AI decision deferrals; a closure also removes the
// Organization's AI notice and product update receipts and settings, and its
// memberships and invitations.

import { randomUUID } from 'node:crypto'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { RIGHTS_FIXTURE_AT } from '#/shared/db/testing/rights-isolation-fixture'
import { describeRightsIsolation } from '#/shared/db/testing/rights-isolation-suite'
import {
  createIdentityRightsExecutor,
  identityOrganizationErasureReplayer,
  identityPropertyErasureReplayer,
} from './identity-rights.adapter'

const userOf = (organizationId: string) => `user-${organizationId}`

describeRightsIsolation({
  environment: { acquireTestLease, deleteTestOrganizations },
  name: 'identity',
  context: 'identity',
  tables: [
    { table: 'merchant_ai_decision_deferrals', hasProperty: true },
    { table: 'property_access_grant', hasProperty: true },
    { table: 'merchant_ai_notice_update_receipts', hasProperty: false },
    { table: 'product_update_receipts', hasProperty: false },
    { table: 'product_update_settings', hasProperty: false },
    { table: 'invitation', hasProperty: false, organizationColumn: 'organizationId' },
    { table: 'member', hasProperty: false, organizationColumn: 'organizationId' },
  ],
  executor: (db) => createIdentityRightsExecutor(db),
  replayers: [identityPropertyErasureReplayer, identityOrganizationErasureReplayer],
  async seedProperty(query, organizationId, propertyId) {
    await query(
      `INSERT INTO merchant_ai_decision_deferrals
         (organization_id, property_id, deferred_at, deferred_by)
       VALUES ($1, $2, $3, 'manager')`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT],
    )
    const grantee = `grantee-${propertyId}`
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Sam Lee', $2, true, $3, $3)`,
      [grantee, `${randomUUID()}@example.test`, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO property_access_grant (organization_id, property_id, user_id, source)
       VALUES ($1, $2, $3, 'operator')`,
      [organizationId, propertyId, grantee],
    )
  },
  async seedOrganization(query, organizationId) {
    const userId = userOf(organizationId)
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Dana Rivera', $2, true, $3, $3)`,
      [userId, `${randomUUID()}@example.test`, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO merchant_ai_notice_update_receipts
         (user_id, organization_id, notice_version, notice_digest)
       VALUES ($1, $2, 'merchant-ai-notice-2026-11-06.v1', $3)`,
      [userId, organizationId, 'e'.repeat(64)],
    )
    await query(
      `INSERT INTO product_update_receipts (user_id, organization_id, entry_id)
       VALUES ($1, $2, 'entry-1')`,
      [userId, organizationId],
    )
    await query(
      `INSERT INTO product_update_settings (user_id, organization_id, auto_show)
       VALUES ($1, $2, false)`,
      [userId, organizationId],
    )
    await query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'admin', $4)`,
      [randomUUID(), userId, organizationId, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO invitation
         (id, "organizationId", email, role, status, "expiresAt", "propertyIds", "inviterId", "createdAt")
       VALUES ($1, $2, $3, 'member', 'pending', $4, $5, $6, $4)`,
      [
        randomUUID(),
        organizationId,
        `${randomUUID()}@example.test`,
        RIGHTS_FIXTURE_AT,
        JSON.stringify([randomUUID()]),
        userId,
      ],
    )
  },
  async cleanupOrganization(query, organizationId) {
    await query(
      `DELETE FROM "user" WHERE id = $1 OR id IN (
         SELECT 'grantee-' || id::text FROM properties WHERE organization_id = $1)`,
      [userOf(organizationId)],
    )
  },
})
