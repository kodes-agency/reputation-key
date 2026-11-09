// AI's rights executor against real PostgreSQL: Property A and B of one
// Organization beside a second Organization.

import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { RIGHTS_FIXTURE_AT } from '#/shared/db/testing/rights-isolation-fixture'
import { describeRightsIsolation } from '#/shared/db/testing/rights-isolation-suite'
import { createAiErasureReplayers, createAiRightsExecutor } from './ai-rights.adapter'

describeRightsIsolation({
  environment: { acquireTestLease, deleteTestOrganizations },
  name: 'ai',
  context: 'ai',
  tables: [
    { table: 'ai_property_review_population_daily', hasProperty: true },
    { table: 'ai_property_issue_groups', hasProperty: true },
    { table: 'ai_property_processing_profiles', hasProperty: true },
    { table: 'ai_organization_cost_windows', hasProperty: false },
  ],
  executor: (db) => createAiRightsExecutor(db, () => RIGHTS_FIXTURE_AT),
  replayers: createAiErasureReplayers(() => RIGHTS_FIXTURE_AT),
  async seedProperty(query, organizationId, propertyId) {
    await query(
      `INSERT INTO ai_property_review_population_daily
         (organization_id, property_id, local_date, source_epoch, property_profile_version,
          calendar_profile_version, review_count, text_review_count, rating_1_count,
          rating_2_count, rating_3_count, rating_4_count, rating_5_count,
          population_revision, updated_at)
       VALUES ($1, $2::uuid, '2026-07-31', 0, 1, 'v1', 1, 0, 0, 0, 0, 0, 1, 1, $3)`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO ai_property_issue_groups
         (organization_id, property_id, topic, canonical_key, created_at, updated_at,
          last_seen_at, expires_at, normalization_version)
       VALUES ($1, $2::uuid, 'cleanliness', '__topic__', $3, $3, $3, $4, 'v1')`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT, new Date('2027-08-01T00:00:00Z')],
    )
    await query(
      `INSERT INTO ai_property_processing_profiles
         (property_id, organization_id, country_code, timezone, processing_region,
          routing_policy_version, provider_deployment_profile_version, source_epoch,
          profile_version, lifecycle_state, updated_at)
       VALUES ($2::uuid, $1, 'US', 'UTC', 'global', 1, 'v1', 0, 1, 'active', $3)`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT],
    )
  },
  async seedOrganization(query, organizationId) {
    await query(
      `INSERT INTO ai_organization_cost_windows (organization_id, window_start)
       VALUES ($1, date_trunc('month', now()))`,
      [organizationId],
    )
  },
})
