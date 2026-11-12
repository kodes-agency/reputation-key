// Activity's rights executor against real PostgreSQL: Property A and B of one
// Organization beside a second Organization.

import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { RIGHTS_FIXTURE_AT } from '#/shared/db/testing/rights-isolation-fixture'
import { describeRightsIsolation } from '#/shared/db/testing/rights-isolation-suite'
import {
  createActivityErasureReplayers,
  createActivityRightsExecutor,
} from './activity-rights.adapter'

const SECRET = 'audit-pseudonym-test-secret'

describeRightsIsolation({
  environment: { acquireTestLease, deleteTestOrganizations },
  name: 'activity',
  context: 'activity',
  tables: [
    { table: 'recent_activity_entries', hasProperty: true },
    { table: 'recent_activity_replay_facts', hasProperty: true },
    { table: 'recent_activity_actor_label_redactions', hasProperty: false },
  ],
  executor: (db) => createActivityRightsExecutor(db, SECRET),
  replayers: createActivityErasureReplayers(SECRET),
  async seedProperty(query, organizationId, propertyId) {
    await query(
      `INSERT INTO recent_activity_entries
         (actor_id, actor_name, actor_role, action, resource_type, resource_id,
          property_id, organization_id, event_id)
       VALUES ('user:a', 'Actor', 'admin', 'created', 'review', $3, $2, $1, $3)`,
      [organizationId, propertyId, `event-${propertyId}`],
    )
    await query(
      `INSERT INTO recent_activity_replay_facts
         (replay_key, source_kind, disposition, organization_id, property_id,
          source_event_id, source_event_type, source_event_version, source_context,
          source_aggregate_id, source_occurred_at)
       VALUES ($3::text, 'durable_fact', 'obsolete', $1, $2, $3::text, 'review.created', 1,
               'review', $3::text, $4)`,
      [organizationId, propertyId, `replay-${propertyId}`, RIGHTS_FIXTURE_AT],
    )
  },
  async seedOrganization(query, organizationId) {
    await query(
      `INSERT INTO recent_activity_actor_label_redactions
         (organization_id, actor_subject_id, redacted_at, expires_at)
       VALUES ($1, 'user:a', $2, $3)`,
      [organizationId, RIGHTS_FIXTURE_AT, new Date('2027-08-01T00:00:00Z')],
    )
  },
})
