// Staff's rights executor against real PostgreSQL: Property A and B of one
// Organization beside a second Organization. A Property erasure removes that
// Property's Staff rows; the people stay for the participant scope.

import { randomUUID } from 'node:crypto'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { RIGHTS_FIXTURE_AT } from '#/shared/db/testing/rights-isolation-fixture'
import { describeRightsIsolation } from '#/shared/db/testing/rights-isolation-suite'
import {
  createStaffRightsExecutor,
  staffOrganizationErasureReplayer,
  staffPropertyErasureReplayer,
} from './identity-rights.adapter'

describeRightsIsolation({
  environment: { acquireTestLease, deleteTestOrganizations },
  name: 'staff',
  context: 'staff',
  tables: [
    { table: 'staff_onboardings', hasProperty: true },
    { table: 'staff_property_settings', hasProperty: true },
    { table: 'portal_responsibilities', hasProperty: true },
    { table: 'portal_group_memberships', hasProperty: true },
    { table: 'staff_participations', hasProperty: true },
    { table: 'staff_user_links', hasProperty: false },
    { table: 'staff_participants', hasProperty: false },
  ],
  executor: (db) => createStaffRightsExecutor(db),
  replayers: [staffOrganizationErasureReplayer, staffPropertyErasureReplayer],
  async seedProperty(query, organizationId, propertyId) {
    const portalId = randomUUID()
    const groupId = randomUUID()
    const participationId = randomUUID()
    await query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Front desk')`,
      [groupId, organizationId, propertyId],
    )
    await query(
      `INSERT INTO portals (id, organization_id, property_id, name, entity_id, slug)
       VALUES ($1, $2, $3, 'Lobby', $4, $4)`,
      [portalId, organizationId, propertyId, `portal-${portalId}`],
    )
    await query(
      `INSERT INTO staff_participations
         (id, organization_id, property_id, user_id, display_name, created_by)
       VALUES ($1, $2, $3, 'staff-user', 'Dana Rivera', 'manager')`,
      [participationId, organizationId, propertyId],
    )
    await query(
      `INSERT INTO portal_responsibilities
         (organization_id, property_id, portal_id, staff_participation_id,
          effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'manager')`,
      [organizationId, propertyId, portalId, participationId, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO portal_group_memberships
         (organization_id, property_id, portal_id, portal_group_id, created_by)
       VALUES ($1, $2, $3, $4, 'manager')`,
      [organizationId, propertyId, portalId, groupId],
    )
    await query(
      `INSERT INTO staff_onboardings
         (id, organization_id, property_id, email, display_name, requested_by, step)
       VALUES ($1, $2, $3, 'dana@example.test', 'Dana Rivera', 'manager', 'invite')`,
      [randomUUID(), organizationId, propertyId],
    )
    await query(
      `INSERT INTO staff_property_settings (organization_id, property_id, updated_by)
       VALUES ($1, $2, 'manager')`,
      [organizationId, propertyId],
    )
  },
  async seedOrganization(query, organizationId) {
    await query(
      `INSERT INTO staff_participants (id, organization_id, display_name, status, created_by)
       VALUES ($1, $2, 'Dana Rivera', 'active', 'manager')`,
      [randomUUID(), organizationId],
    )
  },
  async cleanupOrganization(query, organizationId) {
    await query('DELETE FROM portals WHERE organization_id = $1', [organizationId])
    await query('DELETE FROM portal_groups WHERE organization_id = $1', [organizationId])
  },
})
