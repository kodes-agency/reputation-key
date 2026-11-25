// Keeping a person's guest page in step with another Portal over the real
// repositories and the atomic command store on PostgreSQL: what it replaces, what it
// leaves alone and what a refusal leaves behind (nothing).

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { PRINT_DEFAULT_WORDING } from '#/shared/domain/portal-print-wording'
import type { PropertyId } from '#/shared/domain/ids'
import { publishPortalChanges } from '../publication/publish-portal-changes.server'
import { updatePersonalGuestPage } from './update-personal-guest-page.server'
import { portalError } from '../domain/errors'
import { createPortalPublicationRepository } from '../publication/portal-publication-repository.server'
import { createPortalTokenRepository } from '../addresses/portal-token-repository.server'
import {
  PORTAL_CREATION_TABLES,
  seedCreationPortal,
  seedCreationToken,
} from '../infrastructure/testing/portal-creation-world'
import {
  CREATOR,
  ORG_A,
  ORG_B,
  OTHER_PROPERTY,
  PROPERTY,
  PROPERTY_B,
  RECEPTION,
  RECEPTION_B,
  CLOCK,
  PERSON,
  ctx,
  member,
  createPersonalCreateHarness,
  seedPersonalCreateProperties,
  TEST_ORGANIZATIONS,
  type WorldOptions,
} from './portal-personal-create.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: PORTAL_CREATION_TABLES,
})
const {
  worldDeps,
  rows,
  countOf,
  portalCount,
  outboxCount,
  seedPublished,
  seedReception,
} = createPersonalCreateHarness(getPool)

beforeEach(async () => {
  await seedPersonalCreateProperties(getPool())
})

describe.sequential('updatePersonalGuestPage', () => {
  type PageOptions = Readonly<{
    state?: 'published' | 'disabled' | 'archived'
    kind?: 'place' | 'personal'
    name?: string
    needsOwner?: boolean
    withToken?: boolean
    ownDestination?: string
  }>

  /** The reception live and a person's page beside it, with a code that resolves. */
  async function pageWorld(options: PageOptions = {}) {
    const receptionDestination = await seedReception()
    const state = options.state ?? 'published'
    const name = options.name ?? 'Polly Smith'
    if (state === 'published') {
      await seedPublished({
        portalId: PERSON,
        name,
        slug: 'portal-polly',
        kind: options.kind ?? 'personal',
        publicName: 'Old name',
        linkDestination: options.ownDestination,
      })
    } else {
      await seedCreationPortal(getPool(), {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PERSON,
        slug: 'portal-polly',
        name,
        kind: options.kind ?? 'personal',
        publicName: 'Old name',
        publicationState: state,
      })
    }
    if (options.needsOwner) {
      await getPool().query(
        `UPDATE portals SET responsibility_needed_since = $2 WHERE id = $1`,
        [PERSON, CLOCK],
      )
    }
    if (options.withToken !== false) {
      await seedCreationToken({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: PERSON,
        tokenId: 'c2a70000-0000-4000-8000-000000000001',
        identifier: 'personal-page-code',
      })
    }
    return { receptionDestination }
  }

  const buildUpdate = (
    tweak: Partial<Parameters<typeof updatePersonalGuestPage>[0]> = {},
    options: WorldOptions = {},
  ) => {
    const deps = worldDeps(options)
    const portalTokenRepo = createPortalTokenRepository(getDb())
    const publishChanges = publishPortalChanges({
      portalRepo: deps.portalRepo,
      commandStore: deps.commandStore,
      publicationRepo: createPortalPublicationRepository(getDb()),
      portalTokenRepo,
      propertyGoogleReviewDestinationApi: deps.propertyGoogleReviewDestinationApi,
      propertyLifecycleApi: deps.propertyLifecycleApi,
      staffPublicApi: deps.staffPublicApi,
      idGen: randomUUID,
      clock: deps.clock,
    })
    return updatePersonalGuestPage({ ...deps, portalTokenRepo, publishChanges, ...tweak })
  }

  const update = (run = buildUpdate(), source = RECEPTION, as = ctx) =>
    run({ portalId: PERSON, sourcePortalId: source }, as)

  const pageState = async () => ({
    page: (
      await rows(
        `SELECT public_name, publication_state, updated_at FROM portals WHERE id = $1`,
        PERSON,
      )
    )[0],
    links: (
      await rows(
        `SELECT label FROM portal_link_texts WHERE portal_id = $1 ORDER BY label`,
        PERSON,
      )
    ).map((row) => row.label),
    snapshots: await countOf('portal_publication_snapshots'),
    outbox: await outboxCount(),
    printWordings: await countOf('portal_print_wordings'),
  })

  it('replaces the page with the source and puts it live', async () => {
    await pageWorld()
    const before = await pageState()
    expect(before.links).toEqual(['Menu'])

    await expect(update()).resolves.toEqual({ outcome: 'live' })

    const after = await pageState()
    expect(after.page).toMatchObject({
      public_name: 'Reception',
      publication_state: 'published',
    })
    expect(after.links).toEqual(['Menu'])
    // Replacing before publishing, so guests never see a half-made page: the page's
    // second live version already says what the replaced working copy says.
    expect(after.snapshots).toBe(before.snapshots + 1)
    expect(
      await rows(
        `SELECT version FROM portal_publication_snapshots WHERE portal_id = $1 ORDER BY version`,
        PERSON,
      ),
    ).toEqual([{ version: 1 }, { version: 2 }])
    const facts = await rows(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1 AND payload->>'portalId' = $2
       ORDER BY created_at, event_type`,
      ORG_A,
      PERSON,
    )
    // The setup's first publication, then the replacement and the new live version.
    expect(facts.map((fact) => fact.event_type).sort()).toEqual([
      'portal.publication.published',
      'portal.publication.published',
      'portal.updated',
      'portal.updated',
      'portal.updated',
    ])
    // The source is only read.
    expect(
      await rows(`SELECT publication_state FROM portals WHERE id = $1`, RECEPTION),
    ).toEqual([{ publication_state: 'published' }])
  })

  it('leaves a paused page paused, holding the new content', async () => {
    await pageWorld({ state: 'disabled' })
    const before = await pageState()
    await expect(update()).resolves.toEqual({ outcome: 'saved' })
    const after = await pageState()
    expect(after.page).toMatchObject({
      public_name: 'Reception',
      publication_state: 'disabled',
    })
    expect(after.links).toEqual(['Menu'])
    expect(after.snapshots).toBe(before.snapshots)
  })

  it('does nothing when the page is the one being copied', async () => {
    await pageWorld()
    const before = await pageState()
    await expect(update(buildUpdate(), PERSON)).resolves.toEqual({ outcome: 'unchanged' })
    expect(await pageState()).toEqual(before)
  })

  const elsewhere = (
    organizationId: typeof ORG_A | typeof ORG_B,
    propertyId: PropertyId,
  ) =>
    seedCreationPortal(getPool(), {
      organizationId,
      propertyId,
      portalId: RECEPTION_B,
      slug: organizationId === ORG_B ? 'reception' : 'elsewhere',
    })
  const withoutGoogleDestination = () =>
    buildUpdate({
      propertyGoogleReviewDestinationApi: {
        getGoogleReviewDestination: async () => null,
      },
    })
  const otherOrganizationAdmin = buildTestAuthContext({
    organizationId: ORG_B,
    userId: CREATOR,
    role: 'AccountAdmin',
  })

  it.each([
    [
      'refuses a Portal that is nobody’s, writing nothing',
      { kind: 'place' as const },
      undefined,
      () => buildUpdate(),
      RECEPTION,
      ctx,
      'forbidden',
      0,
    ],
    [
      'refuses an archived page, writing nothing',
      { state: 'archived' as const },
      undefined,
      () => buildUpdate(),
      RECEPTION,
      ctx,
      'portal_inactive',
      0,
    ],
    [
      'refuses a source at another Property, writing nothing',
      {},
      () => elsewhere(ORG_A, OTHER_PROPERTY),
      () => buildUpdate(),
      RECEPTION_B,
      ctx,
      'portal_not_found',
      0,
    ],
    [
      'refuses a source of another organization, writing nothing in either',
      {},
      () => elsewhere(ORG_B, PROPERTY_B),
      () => buildUpdate(),
      RECEPTION_B,
      ctx,
      'portal_not_found',
      1,
    ],
    [
      'refuses a page of another organization as unknown',
      {},
      undefined,
      () => buildUpdate(),
      RECEPTION,
      otherOrganizationAdmin,
      'portal_not_found',
      0,
    ],
    [
      'refuses someone who may not change the page',
      {},
      undefined,
      () => buildUpdate(),
      RECEPTION,
      member,
      'forbidden',
      0,
    ],
    [
      'checks the gates before replacing, so a refused publish changes nothing',
      {},
      undefined,
      withoutGoogleDestination,
      RECEPTION,
      ctx,
      'google_review_destination_unavailable',
      0,
    ],
    [
      'asks first when nobody is responsible for it, so nothing changes',
      { needsOwner: true },
      undefined,
      () => buildUpdate(),
      RECEPTION,
      ctx,
      'responsible_manager_ineligible',
      0,
    ],
    [
      'asks first when its code no longer resolves, so nothing changes',
      { withToken: false },
      undefined,
      () => buildUpdate(),
      RECEPTION,
      ctx,
      'token_unavailable',
      0,
    ],
    [
      'refuses a source whose guest wording would name the person',
      { name: 'Harbor' },
      undefined,
      () => buildUpdate(),
      RECEPTION,
      ctx,
      'personal_portal_name_private',
      0,
    ],
  ])(
    '%s',
    async (
      _title,
      options,
      arrange,
      makeRun,
      source,
      as,
      code,
      portalsOfOrganizationB,
    ) => {
      await pageWorld(options)
      await arrange?.()
      const before = await pageState()
      await expect(update(makeRun(), source, as)).rejects.toMatchObject({ code })
      expect(await pageState()).toEqual(before)
      expect(await portalCount(ORG_B)).toBe(portalsOfOrganizationB)
      expect(await outboxCount(ORG_B)).toBe(0)
    },
  )

  it('says so when publishing refuses after the replace, rather than failing outright', async () => {
    await pageWorld()
    const run = buildUpdate({
      publishChanges: async () => {
        throw portalError('revision_conflict', 'The page moved. Try again.')
      },
    })
    await expect(update(run)).resolves.toEqual({
      outcome: 'not_live',
      message: 'The page moved. Try again.',
    })
    // The new content waits as the page's draft; guests are still on the old page.
    expect((await pageState()).page).toMatchObject({ public_name: 'Reception' })
  })

  it('lets an unexpected publishing fault surface', async () => {
    await pageWorld()
    const run = buildUpdate({
      publishChanges: async () => {
        throw new Error('The database went away')
      },
    })
    await expect(update(run)).rejects.toThrow('The database went away')
  })

  it('writes the default print wording over the page’s when the source has none of its own', async () => {
    await pageWorld({ state: 'disabled' })
    await getPool().query(
      `INSERT INTO portal_print_wordings (organization_id, property_id, portal_id, call_to_action, updated_at)
       VALUES ($1, $2, $3, 'how_did_we_do', $4)`,
      [ORG_A, PROPERTY, PERSON, new Date('2026-08-26T10:00:00.000Z')],
    )
    await update()
    expect(
      await rows(
        `SELECT call_to_action, call_to_action_custom FROM portal_print_wordings WHERE portal_id = $1`,
        PERSON,
      ),
    ).toEqual([
      {
        call_to_action: PRINT_DEFAULT_WORDING.callToAction,
        call_to_action_custom: PRINT_DEFAULT_WORDING.customWords,
      },
    ])
  })

  it('keeps the id of a link that keeps its destination, so taps already counted stay with it', async () => {
    const destination = await seedReception()
    await seedPublished({
      portalId: PERSON,
      name: 'Polly Smith',
      slug: 'portal-polly',
      kind: 'personal',
      publicName: 'Old name',
      linkDestination: destination,
    })
    await seedCreationToken({
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: PERSON,
      tokenId: 'c2a70000-0000-4000-8000-000000000001',
      identifier: 'personal-page-code',
    })
    const before = await rows(`SELECT id FROM portal_links WHERE portal_id = $1`, PERSON)
    expect(before).toHaveLength(1)

    await expect(update()).resolves.toEqual({ outcome: 'live' })

    expect(
      await rows(`SELECT id FROM portal_links WHERE portal_id = $1`, PERSON),
    ).toEqual(before)
  })
})
