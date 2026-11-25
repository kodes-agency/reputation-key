// Ordinary edits and removal of a person's guest page through the Portal intents,
// over the real repositories and the atomic command store on PostgreSQL: a personal
// Portal keeps its owner, and its name stays out of everything guests can read.

import { beforeEach, describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { getDb } from '#/shared/db'
import { toPublicPortalLoaderData } from '#/contexts/guest/page/public-portal.contracts'
import { printKitFileName } from '#/shared/domain/portal-print-kit'
import { printDocumentTitle, printFileName } from '#/shared/domain/portal-print-how-to'
import type { Portal } from '../domain/types'
import type { PortalPublicationSnapshot } from '../domain/portal-publication-snapshot'
import { resolvePublicPortalToken } from './resolve-public-portal-token.server'
import { quietGuestReadDeps } from './resolve-public-portal-token.test-fixtures'
import { loadPortalPrintKitContext } from '../printing/load-portal-print-kit-context.server'
import { createPortalPublicationRepository } from './portal-publication-repository.server'
import { createPortalRepository } from './portal-repository.server'
import {
  asRole,
  createIntentsHarness,
  INTENT_TABLES,
  manager,
  seedIntentProperties,
  TEST_ORGANIZATIONS,
  world,
  ORG_A,
  ORG_B,
  PORTAL,
  PORTAL_B,
  PROPERTY_B,
} from './portal-intents.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: INTENT_TABLES,
})
const { portalRow, factsOf, snapshotsOf, footprint, seedPortal } =
  createIntentsHarness(getPool)

beforeEach(async () => {
  await seedIntentProperties(getPool())
})

/** Runs the actual guest and print projections on a personal Portal's first snapshot. */
async function expectPersonalPortalNameStaysPrivate(
  portal: Portal,
  snapshot: PortalPublicationSnapshot,
) {
  const config = snapshot.configuration
  const resolve = resolvePublicPortalToken({
    tokenCodec: {
      digest: () => ({
        kind: 'long',
        tokenIdentifier: 'key',
        tokenHash: 'hash',
        tokenKeyVersion: 1,
      }),
    },
    portalPublicationRepo: {
      resolveActiveByTokenDigest: async () => ({
        snapshot,
        token: {
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          version: 1,
        },
      }),
    },
    portalHealthRepo: {
      getCurrent: async () => ({
        id: 'health',
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        status: 'healthy',
        reason: 'operational',
        sourceVersion: '1',
        effectiveFrom: snapshot.createdAt,
        effectiveTo: null,
        observedAt: snapshot.createdAt,
      }),
    },
    listApprovedSecondaryDestinationUris: async (_org, _property, uris) => uris,
    isPropertyActive: async () => true,
    getGoogleReviewDestination: async () => ({
      state: 'verified',
      uri: config.reviewGateway.googleReview.uri,
      retrievedAt: new Date(config.googleReviewBinding.retrievedAt),
      sourceEpoch: config.googleReviewBinding.sourceEpoch,
      profileVersion: config.googleReviewBinding.profileVersion,
    }),
    decidePublic: async () => ({ allowed: true }),
    ...quietGuestReadDeps,
    clock: () => snapshot.createdAt,
  })
  const resolved = await resolve('pt_key_secret')
  expect(resolved.status).toBe('found')
  if (resolved.status !== 'found') throw new Error('The personal Portal must resolve')
  const loader = toPublicPortalLoaderData(resolved.result, {
    servedAt: snapshot.createdAt.toISOString(),
    guestSession: { csrfNonce: 'nonce' },
    response: null,
    responseForm: { availability: 'available' },
  })
  const print = await loadPortalPrintKitContext(
    {
      publicationRepo: {
        findActiveForPortal: async () => snapshot,
      },
    },
    { organizationId: portal.organizationId, portal },
  )
  const metadata = {
    kitTitle: `${print.portalName} counter card`,
    kitFile: printKitFileName(print.portalName, 'counter_card', ['en'], {
      style: 'paper',
      paper: 'letter',
    }),
    finalTitle: printDocumentTitle(print.portalName, 'counter'),
    finalFile: printFileName(print.portalName, {
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      paper: 'letter',
      printer: 'my_printer',
      languages: ['en'],
    }),
  }
  expect(portal.name).toBe('Polly Smith')
  expect(portal.slug).toMatch(/^portal-[a-f0-9]+$/)
  for (const output of [snapshot, loader, resolved.result.portal.slug, metadata])
    expect(JSON.stringify(output)).not.toMatch(/polly|smith/i)
}

describe.sequential('personal Portal ordinary edits', () => {
  const personal = {
    kind: 'personal' as const,
    publicName: 'Harbor',
    name: 'Polly Smith',
  }

  it.each([
    ['rename', 'personal_portal_rename_locked'],
    ['archive', 'personal_portal_archive_locked'],
  ] as const)(
    'refuses to %s a personal Portal without changing ownership or publication',
    async (action, code) => {
      const { settings, archive, writes } = world()
      await seedPortal(personal)
      const before = await footprint()
      const admin = asRole('AccountAdmin')
      const attempt =
        action === 'rename'
          ? settings({ portalId: PORTAL, name: 'Another person' }, admin)
          : archive({ portalId: PORTAL }, admin)

      await expect(attempt).rejects.toMatchObject({ code })

      expect(writes()).toBe(0)
      expect(await footprint()).toEqual(before)
    },
  )

  it('refuses Restore of an archived personal Portal', async () => {
    const { restore } = world()
    await seedPortal({ ...personal, state: 'archived' })
    await expect(restore({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'personal_portal_restore_locked',
    })
    expect((await portalRow()).publication_state).toBe('archived')
  })

  it('keeps the manager name out of the first publication snapshot', async () => {
    const { publish } = world()
    await seedPortal({ ...personal, slug: 'portal-12345678' })

    await publish({ portalId: PORTAL }, manager)

    const [snapshot] = await snapshotsOf()
    expect(JSON.stringify(snapshot)).not.toMatch(/Polly|Smith/i)
    expect(JSON.stringify(snapshot)).toContain('Harbor')
    const published = await createPortalPublicationRepository(
      getDb(),
    ).findActiveForPortal(ORG_A, PORTAL as never)
    const portal = await createPortalRepository(getDb()).findById(ORG_A, PORTAL as never)
    await expectPersonalPortalNameStaysPrivate(portal!, published!)
  })
})

describe.sequential('archivePersonalPortal', () => {
  const personal = { kind: 'personal' as const, publicName: 'Harbor' }

  it('archives for an authorized manager departure outside current Property grants', async () => {
    const h = world({ accessible: [] })
    await seedPortal(personal)
    const ctx = {
      ...manager,
      effectivePermissions: new Set(['identity.leave_org'] as const),
    }

    await expect(h.archivePerson({ portalId: PORTAL }, ctx)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await portalRow()).publication_state).toBe('draft')
    expect(
      (await h.archiveForDeparture({ portalId: PORTAL }, ctx)).publicationState,
    ).toBe('archived')
    expect((await portalRow()).publication_state).toBe('archived')
  })

  it('lets a PropertyManager remove a personal Portal and repeats safely', async () => {
    const { archivePerson } = world()
    await seedPortal(personal)
    expect((await archivePerson({ portalId: PORTAL }, manager)).publicationState).toBe(
      'archived',
    )
    expect((await archivePerson({ portalId: PORTAL }, manager)).publicationState).toBe(
      'archived',
    )
    expect(await factsOf('portal.archived')).toHaveLength(1)
  })

  it('refuses an ordinary place Portal', async () => {
    const { archivePerson } = world()
    await seedPortal()
    await expect(archivePerson({ portalId: PORTAL }, manager)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await portalRow()).publication_state).toBe('draft')
  })

  it('does not reach a personal Portal of another organization', async () => {
    const { archivePerson } = world()
    await seedPortal({ ...personal, id: PORTAL_B, org: ORG_B, property: PROPERTY_B })
    await expect(
      archivePerson({ portalId: PORTAL_B }, asRole('AccountAdmin')),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect((await portalRow(PORTAL_B)).publication_state).toBe('draft')
  })
})
