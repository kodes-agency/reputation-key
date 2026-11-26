import { createInMemoryWithdrawalJournal } from './guest-withdrawal-journal.test-fixtures'
import { afterAll, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import type { GuestResponseScope } from './guest-response.repository.port.server'
import { testDb } from '#/shared/testing/ambient-test-runtime'
import { freshUuid } from '#/shared/testing/fresh-uuid'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  guestSessionId,
  organizationId,
  portalId,
  propertyId,
  type GuestSessionId,
} from '#/shared/domain/ids'
import {
  guestResponseLifecycle,
  type OperatorErasureAuthority,
} from './guest-response-lifecycle.server'
import { createAtomicGuestResponseCommandStore } from './guest-response-command-store.server'
import { createGuestResponseRepository } from './guest-response.repository.server'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

const db = testDb()
const STAFF_EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z')
const createdOrganizations: string[] = []

export const SESSION = guestSessionId('00000000-0000-4000-8000-000000000003')

/** Registers the event schemas and the tenant cleanup for the calling test file. */
export function registerLifecycleSuiteHooks(): void {
  afterAll(async () => {
    const ids = createdOrganizations
    if (ids.length > 0) {
      const list = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )
      await db.execute(
        sql`DELETE FROM guest_responses WHERE organization_id IN (${list})`,
      )
      await db.execute(sql`DELETE FROM outbox_events WHERE organization_id IN (${list})`)
      await db.execute(
        sql`DELETE FROM portal_responsibilities WHERE organization_id IN (${list})`,
      )
      await db.execute(
        sql`DELETE FROM staff_participations WHERE organization_id IN (${list})`,
      )
      await db.execute(
        sql`DELETE FROM staff_participants WHERE organization_id IN (${list})`,
      )
      await db.execute(
        sql`DELETE FROM portal_publication_snapshots WHERE organization_id IN (${list})`,
      )
      await db.execute(sql`DELETE FROM portals WHERE organization_id IN (${list})`)
      await db.execute(sql`DELETE FROM properties WHERE organization_id IN (${list})`)
      await deleteTestOrganizations(db, ids)
    }
  })
}

const experienceFor =
  (snapshotId: string) =>
  (privateFeedbackThreshold = 3) => ({
    portalPublicationState: 'published' as const,
    portalPublicationSnapshotId: snapshotId,
    portalPublicationVersion: 1,
    portalPublicationDigest: 'b'.repeat(64),
    portalConfigurationDigest: 'a'.repeat(64),
    guestLocale: 'en',
    languagePackVersion: 'guest-ui-en-v1',
    privateFeedbackThreshold,
  })

/** A tenant of its own, so harnesses and files never meet in one table row. */
async function seedTenant(): Promise<{
  scope: GuestResponseScope
  staffAttribution: PrimaryStaffAttributionSnapshot
  experience: ReturnType<typeof experienceFor>
  snapshot: string
}> {
  const org = `org-guest-lifecycle-${freshUuid()}`
  const property = freshUuid()
  const portal = freshUuid()
  const participant = freshUuid()
  const participation = freshUuid()
  const responsibility = freshUuid()
  const snapshot = freshUuid()
  createdOrganizations.push(org)
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${org}, 'Guest Lifecycle', ${org}, now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${property}, ${org}, 'Guest Lifecycle Property', ${property}, 'UTC')
  `)
  await db.execute(sql`
    INSERT INTO portals (
      id, organization_id, property_id, entity_type, entity_id, name, slug,
      publication_state
    ) VALUES (
      ${portal}, ${org}, ${property}, 'property', ${property},
      'Guest Lifecycle Portal', ${portal}, 'published'
    )
  `)
  await db.execute(sql`
    INSERT INTO portal_publication_snapshots (
      id, organization_id, property_id, portal_id, version, configuration_digest,
      configuration, guest_locale, language_pack_version, private_feedback_threshold,
      contact_request_enabled, destination_uri, destination_retrieved_at,
      destination_source_epoch, destination_profile_version, created_by, created_at
    ) VALUES (
      ${snapshot}::uuid, ${org}, ${property}::uuid, ${portal}::uuid, 1, ${'b'.repeat(64)},
      '{}'::jsonb, 'en', 'guest-ui-en-v1', 3, false, 'https://example.test/review',
      now(), 0, 1, 'test', now()
    )
  `)
  await db.execute(sql`
    INSERT INTO staff_participants (
      id, organization_id, display_name, status, revision, created_by,
      created_at, updated_at
    ) VALUES (${participant}::uuid, ${org}, 'Primary', 'active', 1, 'test',
      ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO staff_participations (
      id, organization_id, property_id, staff_participant_id, display_name,
      status, started_at, revision, created_by, created_at, updated_at
    ) VALUES (${participation}::uuid, ${org}, ${property}, ${participant}::uuid,
      'Primary', 'active', ${STAFF_EFFECTIVE_FROM}, 1, 'test',
      ${STAFF_EFFECTIVE_FROM}, ${STAFF_EFFECTIVE_FROM})
  `)
  await db.execute(sql`
    INSERT INTO portal_responsibilities (
      id, organization_id, property_id, portal_id, staff_participation_id,
      kind, effective_from, created_by
    ) VALUES (${responsibility}::uuid, ${org}, ${property}, ${portal},
      ${participation}::uuid, 'primary', ${STAFF_EFFECTIVE_FROM}, 'test')
  `)
  return {
    scope: {
      organizationId: organizationId(org),
      propertyId: propertyId(property),
      portalId: portalId(portal),
    },
    snapshot,
    experience: experienceFor(snapshot),
    staffAttribution: {
      staffParticipantId: participant,
      staffParticipationId: participation,
      portalResponsibilityId: responsibility,
      effectiveFrom: STAFF_EFFECTIVE_FROM,
      effectiveTo: null,
    },
  }
}

export async function harness(
  clock: () => Date = () => new Date('2026-08-09T12:00:00Z'),
  operatorAuthority?: OperatorErasureAuthority,
) {
  const { scope, staffAttribution, experience, snapshot } = await seedTenant()
  const repo = createGuestResponseRepository(db, clock)
  let resolvedStaffAttribution: PrimaryStaffAttributionSnapshot | null = staffAttribution
  let staffAttributionResolutionCount = 0
  const journal = createInMemoryWithdrawalJournal(() => freshUuid())
  const journalWrites = journal.writes
  const rawLifecycle = guestResponseLifecycle({
    repo,
    clock,
    idGen: () => freshUuid(),
    commandStore: createAtomicGuestResponseCommandStore(db, clock, journal),
    operatorAuthority,
    resolvePrimaryStaffAttribution: async () => {
      staffAttributionResolutionCount += 1
      return resolvedStaffAttribution
    },
  })
  // Most lifecycle tests focus on behavior after submission. This adapter keeps
  // their threshold-oriented call shape compact while production callers must
  // provide the complete server-resolved experience contract.
  const lifecycle = {
    ...rawLifecycle,
    submit: (
      candidateScope: GuestResponseScope,
      sessionId: GuestSessionId,
      input: Parameters<typeof rawLifecycle.submit>[2],
      privateFeedbackThreshold = 3,
    ) =>
      rawLifecycle.submit(
        candidateScope,
        sessionId,
        input,
        experience(privateFeedbackThreshold),
      ),
  }
  const responseIds = async () =>
    (
      await db.execute(
        sql`SELECT id FROM guest_responses WHERE organization_id = ${scope.organizationId}`,
      )
    ).rows.map((row) => String(row.id))
  const READ_AS_OF = new Date('2026-08-09T00:00:00Z')
  // Read as of a moment before any expiry, so a lapsed binding or note never hides what is stored.
  const readRepo = createGuestResponseRepository(db, () => READ_AS_OF)
  /** The tenant's single stored response, read back through the repository. */
  const stored = async () => {
    const ids = await responseIds()
    expect(ids).toHaveLength(1)
    const bound = await db.execute(
      sql`SELECT session_id FROM guest_response_session_bindings WHERE response_id = ${ids[0]}::uuid`,
    )
    const sessionRow = bound.rows[0]
    const found = sessionRow
      ? await readRepo.findForSession(
          scope,
          guestSessionId(String(sessionRow.session_id)),
          READ_AS_OF,
        )
      : await readRepo.findById(scope, ids[0]! as never)
    return found!
  }
  /** Keep the guest's session and note alive past the clock the test moves to. */
  const keepSessionBound = async () => {
    await db.execute(
      sql`UPDATE guest_response_session_bindings SET expires_at = '2027-01-01T00:00:00Z' WHERE organization_id = ${scope.organizationId}`,
    )
    await db.execute(
      sql`UPDATE guest_response_private_feedback SET expires_at = '2027-01-01T00:00:00Z' WHERE organization_id = ${scope.organizationId}`,
    )
  }
  /** Facts the commands committed to the outbox, in commit order. */
  const byTag = async (tag: string) =>
    (
      await db.execute(sql`
        SELECT id, payload FROM outbox_events
        WHERE organization_id = ${scope.organizationId} AND event_type = ${tag}
        ORDER BY created_at, id
      `)
    ).rows.map((row) => ({
      ...(row.payload as Record<string, unknown>),
      eventId: String(row.id),
    })) as Array<Record<string, unknown> & { eventId: string }>
  return {
    scope,
    lifecycle,
    rawLifecycle,
    repo,
    stored,
    keepSessionBound,
    count: async () => (await responseIds()).length,
    outbox: { byTag },
    snapshot,
    experience,
    journalWrites,
    staffAttribution,
    setStaffAttribution: (value: PrimaryStaffAttributionSnapshot | null) => {
      resolvedStaffAttribution = value
    },
    staffAttributionResolutionCount: () => staffAttributionResolutionCount,
  }
}
