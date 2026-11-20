// A Portal's contact-request setting over PostgreSQL: how it is stored, versioned
// and recorded, and what a publication does with it. The setting alone never
// enables contact requests; only a Privacy Notice version in force that covers
// them lets a snapshot say so, and the snapshot's evidence check is never bypassed.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { ContactRequestNotice } from '#/shared/domain/contact-request-notice'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/monthly-goals/portal-rating-goal-guard.server'
import { reviewedPublicationDigest } from './portal-publication-snapshot.server'
import { createPortalPublicationRepository } from './portal-publication-repository.server'
import { createPortalRepository } from './portal-repository.server'
import { createPortalTokenRepository } from '../addresses/portal-token-repository.server'
import {
  PORTAL_CREATION_TABLES,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationToken,
  VERIFIED_GOOGLE_DESTINATION,
} from '../infrastructure/testing/portal-creation-world'
import { publishPortal, updatePortalSettings } from './portal-intents.server'
import { createAtomicPortalCommandStore } from './portal-command-store.server'

const ORG = organizationId('org-contact-0000-0000-000000000001')
const PROPERTY = propertyId('c4a10000-0000-4000-8000-000000000001')
const PORTAL = 'c4b10000-0000-4000-8000-000000000001'
const CLOCK = new Date('2026-10-01T12:00:00.000Z')
const MANAGER = userId('manager-contact-0000-000000000001')
const manager = buildTestAuthContext({
  organizationId: ORG,
  userId: MANAGER,
  role: 'PropertyManager',
})

const NOTICE: ContactRequestNotice = {
  noticeId: 'privacy-notice',
  noticeVersion: '4.0',
  noticeDigest: 'd'.repeat(64),
  locales: ['en'],
}
const covering = vi.hoisted(() => ({ notices: [] as ContactRequestNotice[] }))

vi.mock('#/shared/domain/contact-request-notice', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/domain/contact-request-notice')>()
  return {
    ...actual,
    contactNoticeEvidenceFor: (
      locale: Parameters<typeof actual.contactNoticeEvidenceFor>[0],
    ) => actual.contactNoticeEvidenceFor(locale, covering.notices),
  }
})

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: organizationId('org-contact-0000-0000-000000000002'),
  tables: [
    'goal_subject_assignments',
    'goal_program_versions',
    'goal_programs',
    ...PORTAL_CREATION_TABLES,
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  covering.notices = []
  const pool = getPool()
  await seedCreationProperty(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    brand: {
      displayName: 'Harbor',
      defaultGuestLocales: ['en'],
      wording: [
        {
          locale: 'en',
          title: 'Welcome to Harbor',
          shortDescription: 'Tell us about your visit.',
        },
      ],
    },
  })
  await seedCreationPortal(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    slug: 'test-portal',
    name: 'Test Portal',
    publicationState: 'draft',
  })
  await seedCreationToken({
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    tokenId: 'c4a70000-0000-4000-8000-000000000001',
    identifier: 'contact-token-1',
  })
})

function commands() {
  const db = getDb()
  const guard = createPortalRatingGoalGuard()
  const deps = {
    ratingGoalGuard: { findRunningRatingGoalBlock: async () => null },
    portalRepo: createPortalRepository(db),
    commandStore: createAtomicPortalCommandStore(db, guard),
    publicationRepo: createPortalPublicationRepository(db),
    portalTokenRepo: createPortalTokenRepository(db),
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => VERIFIED_GOOGLE_DESTINATION,
    },
    propertyLifecycleApi: { isPropertyActive: async () => true },
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    idGen: randomUUID,
    clock: () => CLOCK,
  }
  return { settings: updatePortalSettings(deps), publish: publishPortal(deps) }
}

const rows = async (sql: string, ...values: unknown[]) =>
  (await getPool().query(sql, values)).rows

async function goLive() {
  const { publish } = commands()
  const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
    ORG,
    PORTAL as never,
  )
  const reviewedDigest = reviewedPublicationDigest(working!, VERIFIED_GOOGLE_DESTINATION)
  await publish({ portalId: PORTAL, reviewedDigest: reviewedDigest as string }, manager)
  return (
    await rows(
      `SELECT version, configuration, contact_request_enabled, contact_notice_id,
              contact_notice_version, contact_notice_digest, contact_notice_locale
       FROM portal_publication_snapshots WHERE portal_id = $1 ORDER BY version`,
      PORTAL,
    )
  )[0]
}

describe.sequential('a Portal’s contact-request setting', () => {
  it('is off for a new Portal', async () => {
    const [row] = await rows(
      `SELECT contact_requests_enabled FROM portals WHERE id = $1`,
      PORTAL,
    )
    expect(row.contact_requests_enabled).toBe(false)
  })

  it('is stored, moves the Portal’s revision and is named in the settings ledger', async () => {
    const [before] = await rows(`SELECT updated_at FROM portals WHERE id = $1`, PORTAL)

    const saved = await commands().settings(
      { portalId: PORTAL, contactRequestsEnabled: true },
      manager,
    )

    expect(saved.contactRequestsEnabled).toBe(true)
    const [after] = await rows(
      `SELECT contact_requests_enabled, updated_at FROM portals WHERE id = $1`,
      PORTAL,
    )
    expect(after.contact_requests_enabled).toBe(true)
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime())
    const ledger = await rows(
      `SELECT change_kind, change_key, actor_user_id FROM portal_page_edits
       WHERE portal_id = $1 AND change_key = 'settings:contact_requests'`,
      PORTAL,
    )
    expect(ledger).toEqual([
      {
        change_kind: 'portal_configuration',
        change_key: 'settings:contact_requests',
        actor_user_id: MANAGER,
      },
    ])
  })

  it('writes nothing when the setting does not change', async () => {
    await commands().settings(
      { portalId: PORTAL, contactRequestsEnabled: false },
      manager,
    )

    expect(
      await rows(
        `SELECT 1 FROM portal_page_edits WHERE change_key = 'settings:contact_requests'`,
      ),
    ).toEqual([])
  })
})

describe.sequential('publishing with the contact-request setting on', () => {
  beforeEach(async () => {
    await commands().settings({ portalId: PORTAL, contactRequestsEnabled: true }, manager)
  })

  it('publishes contact requests off while no notice in force covers them', async () => {
    const snapshot = await goLive()

    expect(snapshot.contact_request_enabled).toBe(false)
    expect(snapshot.contact_notice_id).toBeNull()
    expect(snapshot.configuration.reviewGateway).not.toHaveProperty('contactRequest')
  })

  it('pins the notice evidence and enables them once a notice in force covers them', async () => {
    covering.notices = [NOTICE]

    const snapshot = await goLive()

    expect(snapshot).toMatchObject({
      contact_request_enabled: true,
      contact_notice_id: 'privacy-notice',
      contact_notice_version: '4.0',
      contact_notice_digest: 'd'.repeat(64),
      contact_notice_locale: 'en',
    })
    expect(snapshot.configuration.reviewGateway.contactRequest).toEqual({
      noticeId: 'privacy-notice',
      noticeVersion: '4.0',
      noticeDigest: 'd'.repeat(64),
      noticeLocale: 'en',
    })
  })

  it('serves the published version back through the verified reader', async () => {
    covering.notices = [NOTICE]
    await goLive()

    const live = await createPortalPublicationRepository(getDb()).findActiveForPortal(
      ORG,
      PORTAL as never,
    )

    expect(live?.configuration).toMatchObject({
      reviewGateway: { contactRequest: { noticeVersion: '4.0' } },
    })
  })

  it('keeps the evidence check in force: a row cannot say enabled without a notice', async () => {
    await goLive()

    await expect(
      getPool().query(
        `UPDATE portal_publication_snapshots SET contact_request_enabled = true WHERE portal_id = $1`,
        [PORTAL],
      ),
    ).rejects.toThrow(/contact_evidence_valid/)
  })
})
