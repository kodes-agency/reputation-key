import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

const ROOT = process.cwd()
const migration = readFileSync(
  resolve(ROOT, 'drizzle/0124_google_organization_ownership.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> }

function between(start: string, end: string): string {
  const startIndex = migration.indexOf(start)
  const endIndex = migration.indexOf(end, startIndex + start.length)
  expect(startIndex, `missing migration marker: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing migration marker: ${end}`).toBeGreaterThan(startIndex)
  return migration.slice(startIndex, endIndex)
}

describe('0124 Google Organization ownership cutover artifact', () => {
  it('reconciles every legacy row without rewriting connectedBy provenance', () => {
    const reconciliation = between(
      'UPDATE "google_connections" AS connection',
      'ALTER TABLE "google_connections"',
    )
    expect(reconciliation).toContain('"visibility" = \'organization\'')
    expect(reconciliation).toContain('"access_version" = connection."access_version" + 1')
    expect(reconciliation).toContain('connector."role" = \'owner\'')
    expect(reconciliation).toContain('THEN \'reauth_required\'::"connection_status"')
    expect(reconciliation).toContain(
      'organization_ownership_requires_account_admin_reauthorization',
    )
    expect(reconciliation).not.toMatch(/SET[\s\S]*?"connected_by"\s*=/u)
  })

  it('makes organization visibility the only persisted state', () => {
    expect(migration).toContain('ALTER COLUMN "visibility" SET DEFAULT \'organization\'')
    expect(migration).toContain('"google_connections_organization_owned_check"')
    expect(migration).toContain('CHECK ("visibility" = \'organization\') NOT VALID')
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "google_connections_organization_owned_check"',
    )
  })

  it('separates immutable connection provenance from the current OAuth grant authority', () => {
    expect(migration).toContain('ADD COLUMN "credential_authorized_by"')
    expect(migration).toContain('ADD COLUMN "credential_authorized_at"')
    expect(migration).toContain('"credential_authorized_by" = "connected_by"')
    expect(migration).toContain('"google_connections_credential_authority_pair_check"')
  })

  it('fences raw membership departure and role-loss paths without rewriting provenance', () => {
    const triggerBody = between(
      'CREATE OR REPLACE FUNCTION public.fence_google_connector_departure_v1',
      'CREATE TRIGGER "member_fence_google_connector_departure"',
    )
    expect(triggerBody).toContain("TG_OP = 'DELETE'")
    expect(triggerBody).toContain('v_new_is_owner')
    expect(triggerBody).toMatch(
      /COALESCE\(\s*connection\.credential_authorized_by,\s*connection\.connected_by\s*\)/u,
    )
    expect(triggerBody).toContain("status = 'reauth_required'")
    expect(triggerBody).toContain('lifecycle_version = connection.lifecycle_version + 1')
    expect(triggerBody).toContain('access_version = connection.access_version + 1')
    expect(triggerBody).toContain("'integration.google_account.reauthorization_required'")
    expect(triggerBody).toContain("'cause', v_event_cause")
    expect(triggerBody).toContain('INSERT INTO public.outbox_events')
    expect(triggerBody).not.toMatch(/connected_by\s*=/u)
    expect(migration).toContain('BEFORE DELETE OR UPDATE OF "role" ON "member"')
  })

  it('replaces the database start authority without visibility or connector-user predicates', () => {
    const permit = between(
      'CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v1',
      'REVOKE ALL ON FUNCTION public.start_google_execution_permit_v1',
    )
    expect(permit).not.toContain('connection.visibility')
    expect(permit).not.toContain('connection.connected_by')
    expect(permit).toContain("permit.capability::text = 'property.import_gbp_v2'")
    expect(permit).toContain("member.role = 'owner'")
    expect(permit).toContain("permit.authorization_vector->>'role' = 'AccountAdmin'")
    expect(permit).toContain("permit.capability::text = 'property.read_gbp_performance'")
    expect(permit).toContain("permit.route_key = 'performance.fetch'")
    expect(permit).toContain("member.role = 'admin'")
    expect(permit).toContain("permit.authorization_vector->>'role' = 'PropertyManager'")
    expect(permit).toContain('permission.version::text =')
    expect(permit).toContain("permit.capability::text = 'property.connect_gbp'")
    expect(permit).toContain('permit.initiator_user_id IS NULL')
    expect(permit).toContain("'review-sync-worker-v1'")
    expect(permit).toContain("permit.route_key IN ('reviews.list', 'reviews.get')")
    expect(permit).toContain(
      "permit.authorization_vector->>'propertySourceEpoch' ~\n                      '^(0|[1-9][0-9]*)$'",
    )
  })

  it('admits reply publication only from the current durable attempt and manager authority', () => {
    const permit = between(
      'CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v1',
      'REVOKE ALL ON FUNCTION public.start_google_execution_permit_v1',
    )
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'property.publish_reply'")
    expect(migration).toContain('reply_publication_provider_authority_default_deny')
    expect(permit).toContain("permit.capability::text = 'property.publish_reply'")
    expect(permit).toContain("permit.route_key = 'reviews.reply'")
    expect(permit).toContain("'reply-publication-worker-v1'")
    expect(permit).toContain('FROM public.reply_publication_attempts')
    expect(permit).toContain('INNER JOIN public.reply_publication_authorizations')
    expect(permit).toContain("publication_attempt.outcome = 'sending'")
    expect(permit).toContain("publication_reply.publication_state = 'sending'")
    expect(permit).toContain("permit.authorization_vector->>'publicationAttemptNumber'")
    expect(permit).toContain("permit.authorization_vector->>'expectedReplyDigest'")
    expect(permit).toContain("permit.authorization_vector->>'credentialGeneration'")
    expect(permit).toContain('confirming_permission.version::text =')
    expect(permit).toContain('FROM public.property_access_grant AS confirming_grant')
    expect(permit).not.toContain('publication_authorization.connected_by')
  })

  it('registers the migration and keeps DB-only function ownership pointed at it', () => {
    expect(journal.entries).toContainEqual({
      idx: 124,
      version: '7',
      when: 1789920000000,
      tag: '0124_google_organization_ownership',
      breakpoints: true,
    })
    expect(
      DB_ONLY_CONSTRUCTS.find(
        (entry) => entry.name === 'start_google_execution_permit_v1',
      ),
    ).toMatchObject({
      kind: 'function',
      owner: 'identity',
      source: 'drizzle/0124_google_organization_ownership.sql',
    })
    expect(
      DB_ONLY_CONSTRUCTS.find(
        (entry) => entry.name === 'fence_google_connector_departure_v1',
      ),
    ).toMatchObject({
      kind: 'function',
      owner: 'integration',
      source: 'drizzle/0124_google_organization_ownership.sql',
    })
    expect(
      DB_ONLY_CONSTRUCTS.find(
        (entry) => entry.name === 'member_fence_google_connector_departure',
      ),
    ).toMatchObject({
      kind: 'trigger',
      owner: 'integration',
      source: 'drizzle/0124_google_organization_ownership.sql',
    })
  })
})
