// A person's guest page over the real repositories and the atomic command store on
// PostgreSQL, for two Organizations: adding the page (the preflight, the reserved id,
// the managers and print words it inherits) and keeping it in step with another Portal.
// A refusal must leave every row and outbox fact as it was.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { PRINT_FINAL_DEFAULT_WORDING } from '#/shared/domain/portal-print-final-wording'
import { buildPersonalPortalUseCases } from '../build-personal-portals'
import { assertPersonalPropertySource } from '../application/personal-portal-property-source'
import {
  checkPersonalPortalSource,
  createPersonalPortal,
  type CreatePersonalPortalDeps,
} from '../application/use-cases/create-personal-portal'
import { publishPortalChanges } from '../application/use-cases/publish-portal-changes'
import { updatePersonalGuestPage } from '../application/use-cases/update-personal-guest-page'
import { isPortalError, portalError } from '../domain/errors'
import { createPortalPrintWordingRepository } from './repositories/portal-print-wording.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { createPortalTokenRepository } from './repositories/portal-token.repository'
import {
  createPersonalPortalDeps,
  PORTAL_CREATION_TABLES,
  seedCreationCategory,
  seedCreationDestination,
  seedCreationGroup,
  seedCreationLink,
  seedCreationPortal,
  seedCreationProperty,
  seedCreationResponsibleManager,
  seedCreationToken,
  type CreationManager,
} from './testing/portal-creation-world'
import { publishFromSource } from './testing/portal-working-copy-publish'

const ORG_A = organizationId('org-personal-0000-0000-000000000001')
const ORG_B = organizationId('org-personal-0000-0000-000000000002')
const PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000002')
const NO_WORDING_PROPERTY = propertyId('c2a10000-0000-4000-8000-000000000003')
const PROPERTY_B = propertyId('c2a10000-0000-4000-8000-00000000000b')
const RECEPTION = 'c2b10000-0000-4000-8000-000000000001'
const RECEPTION_B = 'c2b10000-0000-4000-8000-0000000000b1'
const PERSON = 'c2b10000-0000-4000-8000-000000000011'
const GROUP = 'c2a20000-0000-4000-8000-000000000001'
const RESERVED = 'c2e10000-abcd-4000-8000-000000000001'
const ID_PREFIX = 'c2d10000'
const CLOCK = new Date('2026-10-01T12:00:00.000Z')
const CREATOR = userId('user-personal-0000-0000-000000000001')
const MISSING = 'c2a90000-0000-4000-8000-0000000000ff'

const ctx = buildTestAuthContext({
  organizationId: ORG_A,
  userId: CREATOR,
  role: 'PropertyManager',
})
const member = buildTestAuthContext({ organizationId: ORG_A, role: 'Member' })
const ratingGoalGuard = createPortalRatingGoalGuard()

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: PORTAL_CREATION_TABLES,
})

const WORDING = [
  {
    locale: 'en',
    title: 'Welcome to Harbor',
    shortDescription: 'Tell us about your visit.',
  },
]

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const pool = getPool()
  const brand = { displayName: 'Harbor', defaultGuestLocales: ['en'], wording: WORDING }
  await seedCreationProperty(pool, { organizationId: ORG_A, propertyId: PROPERTY, brand })
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: OTHER_PROPERTY,
    brand,
  })
  await seedCreationProperty(pool, {
    organizationId: ORG_A,
    propertyId: NO_WORDING_PROPERTY,
    brand: { ...brand, wording: [] },
  })
  await seedCreationProperty(pool, {
    organizationId: ORG_B,
    propertyId: PROPERTY_B,
    brand,
  })
})

type WorldOptions = Readonly<{
  accessible?: ReadonlyArray<PropertyId> | null
  managers?: readonly CreationManager[]
}>

const worldDeps = (options: WorldOptions = {}): CreatePersonalPortalDeps =>
  createPersonalPortalDeps({
    pool: getPool(),
    idPrefix: ID_PREFIX,
    clock: CLOCK,
    accessible:
      options.accessible === undefined ? [PROPERTY, OTHER_PROPERTY] : options.accessible,
    managers: options.managers ?? [{ userId: CREATOR, role: 'PropertyManager' }],
    ratingGoalGuard: createPortalRatingGoalGuard(),
  })

const rows = async (sql: string, ...values: unknown[]) =>
  (await getPool().query(sql, values)).rows

const countOf = async (table: string, org = ORG_A) =>
  Number(
    (
      await rows(
        `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
        org,
      )
    )[0].n,
  )

const portalCount = (org = ORG_A) => countOf('portals', org)
const outboxCount = (org = ORG_A) => countOf('outbox_events', org)

const tail = (id: string) => id.slice(-12)

/** A Portal with one approved link, live, and the Property it sits on. */
async function seedPublished(
  input: Readonly<{
    portalId: string
    name: string
    slug: string
    kind?: 'place' | 'personal'
    publicName?: string
    skipPrivateRating?: boolean
    linkDestination?: string
  }>,
) {
  const pool = getPool()
  const scope = { organizationId: ORG_A, propertyId: PROPERTY, portalId: input.portalId }
  await seedCreationPortal(pool, {
    ...scope,
    slug: input.slug,
    name: input.name,
    kind: input.kind,
    publicName: input.publicName ?? null,
    publicationState: 'draft',
    skipPrivateRating: input.skipPrivateRating,
  })
  const categoryId = `c2c10000-0000-4000-8000-${tail(input.portalId)}`
  await seedCreationCategory(pool, { ...scope, categoryId })
  const destinationId =
    input.linkDestination ?? `c2f10000-0000-4000-8000-${tail(input.portalId)}`
  if (!input.linkDestination) {
    await seedCreationDestination(pool, {
      ...scope,
      destinationId,
      approvalState: 'approved',
    })
  }
  await seedCreationLink(pool, {
    ...scope,
    categoryId,
    linkId: `c2c20000-0000-4000-8000-${tail(input.portalId)}`,
    destinationId,
    label: 'Menu',
    sortKey: 'a0',
    texts: [{ locale: 'en', label: 'Menu' }],
  })
  const working = await createPortalPublicationRepository(getDb()).loadWorkingCopy(
    ORG_A,
    scope.portalId as never,
  )
  if (!working) throw new Error('the seeded Portal has no working copy')
  await publishFromSource(scope as never, working, ratingGoalGuard)
  return destinationId
}

const seedReception = (extra: Partial<Parameters<typeof seedPublished>[0]> = {}) =>
  seedPublished({ portalId: RECEPTION, name: 'Reception', slug: 'reception', ...extra })

const codeOf = async (run: Promise<unknown>): Promise<string | undefined> => {
  try {
    await run
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

const newPerson = { portalId: RESERVED, propertyId: PROPERTY, displayName: 'Polly Smith' }

describe.sequential('createPersonalPortal', () => {
  it('authorizes an idempotent retry before returning its reserved Portal', async () => {
    const deps = worldDeps()
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: RESERVED,
      slug: 'portal-c2e10000',
      kind: 'personal',
      publicName: 'Harbor',
    })
    await expect(createPersonalPortal(deps)(newPerson, member)).rejects.toMatchObject({
      code: 'forbidden',
    })
    await expect(
      createPersonalPortal(worldDeps({ accessible: [] }))(newPerson, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a reserved id that already belongs to a Portal that is nobody’s', async () => {
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: RESERVED,
      slug: 'lobby',
    })
    await expect(codeOf(createPersonalPortal(worldDeps())(newPerson, ctx))).resolves.toBe(
      'forbidden',
    )
  })

  it('starts from the Property with a reserved id, fixed guest name and opaque slug', async () => {
    const create = createPersonalPortal(worldDeps())
    const portal = await create(newPerson, ctx)
    expect(portal).toMatchObject({
      id: RESERVED,
      name: 'Polly Smith',
      publicName: 'Harbor',
      kind: 'personal',
      slug: 'portal-c2e10000',
    })
    expect((await create(newPerson, ctx)).id).toBe(RESERVED)
    expect(
      await rows(
        `SELECT id, name, public_name, kind, slug, publication_state FROM portals WHERE organization_id = $1`,
        ORG_A,
      ),
    ).toEqual([
      {
        id: RESERVED,
        name: 'Polly Smith',
        public_name: 'Harbor',
        kind: 'personal',
        slug: 'portal-c2e10000',
        publication_state: 'draft',
      },
    ])
    const created = await rows(
      `SELECT payload FROM outbox_events WHERE organization_id = $1 AND event_type = 'portal.created'`,
      ORG_A,
    )
    expect(created).toHaveLength(1)
    expect(created[0].payload).toMatchObject({ portalId: RESERVED, propertyId: PROPERTY })
    expect(await portalCount(ORG_B)).toBe(0)
  })

  it('refuses a Property of another organization', async () => {
    await expect(
      codeOf(
        createPersonalPortal(worldDeps({ accessible: [PROPERTY, PROPERTY_B] }))(
          { ...newPerson, propertyId: PROPERTY_B },
          ctx,
        ),
      ),
    ).resolves.toBe('property_not_found')
    expect(await portalCount(ORG_A)).toBe(0)
    expect(await portalCount(ORG_B)).toBe(0)
  })

  it('refuses preflight without address recovery before creating a Portal', async () => {
    await expect(
      createPersonalPortal({ ...worldDeps(), addressRecoverable: false })(newPerson, ctx),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })
    expect(await portalCount()).toBe(0)
  })

  // Publishing runs these two gates first. A check that passes here and a publish
  // that refuses would leave a person with a draft Portal and "Setup didn't finish".
  it('refuses a Property without a verified Google destination before creating a Portal', async () => {
    const unverified = {
      ...worldDeps(),
      propertyGoogleReviewDestinationApi: {
        getGoogleReviewDestination: async () => null,
      },
    }
    await expect(
      checkPersonalPortalSource(unverified)({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    await expect(createPersonalPortal(unverified)(newPerson, ctx)).rejects.toMatchObject({
      code: 'google_review_destination_unavailable',
    })
    expect(await portalCount()).toBe(0)
  })

  it('refuses an unavailable Property before creating a Portal', async () => {
    const unavailable = {
      ...worldDeps(),
      propertyLifecycleApi: { isPropertyActive: async () => false },
    }
    await expect(
      checkPersonalPortalSource(unavailable)({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
    await expect(createPersonalPortal(unavailable)(newPerson, ctx)).rejects.toMatchObject(
      {
        code: 'portal_inactive',
      },
    )
    expect(await portalCount()).toBe(0)
  })

  it('asks the same two gates of a copy from another Portal', async () => {
    await seedReception()
    await expect(
      checkPersonalPortalSource({
        ...worldDeps(),
        propertyGoogleReviewDestinationApi: {
          getGoogleReviewDestination: async () => null,
        },
      })({ propertyId: PROPERTY, sourcePortalId: RECEPTION }, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    await expect(
      checkPersonalPortalSource({
        ...worldDeps(),
        propertyLifecycleApi: { isPropertyActive: async () => false },
      })({ propertyId: PROPERTY, sourcePortalId: RECEPTION }, ctx),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
  })

  it('accepts a live, reviewed copy source', async () => {
    await seedReception()
    const source = await checkPersonalPortalSource(worldDeps())(
      { propertyId: PROPERTY, sourcePortalId: RECEPTION },
      ctx,
    )
    expect(source).toMatchObject({ id: RECEPTION, omittedLinks: [] })
  })

  it('refuses an archived copy source', async () => {
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: RECEPTION,
      slug: 'reception',
      publicationState: 'archived',
    })
    await expect(
      checkPersonalPortalSource(worldDeps())(
        { propertyId: PROPERTY, sourcePortalId: RECEPTION },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'source_archived' })
  })

  it('refuses a copy source of another Property or another organization', async () => {
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
      portalId: RECEPTION,
      slug: 'reception',
    })
    await seedCreationPortal(getPool(), {
      organizationId: ORG_B,
      propertyId: PROPERTY_B,
      portalId: RECEPTION_B,
      slug: 'reception',
    })
    for (const sourcePortalId of [RECEPTION, RECEPTION_B, MISSING]) {
      await expect(
        checkPersonalPortalSource(worldDeps())(
          { propertyId: PROPERTY, sourcePortalId },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'portal_not_found' })
    }
  })

  it('refuses a source whose working copy differs from its published snapshot', async () => {
    await seedReception()
    await getPool().query(`UPDATE portals SET linktree_enabled = false WHERE id = $1`, [
      RECEPTION,
    ])
    await expect(
      checkPersonalPortalSource(worldDeps())(
        { propertyId: PROPERTY, sourcePortalId: RECEPTION },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'source_has_unpublished_changes' })
  })

  it('refuses a source that was never published', async () => {
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: RECEPTION,
      slug: 'reception',
    })
    await expect(
      checkPersonalPortalSource(worldDeps())(
        { propertyId: PROPERTY, sourcePortalId: RECEPTION },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'source_has_unpublished_changes' })
  })

  const goalLocked = () =>
    vi.fn(async () => {
      throw Object.assign(new Error('End the goal first.'), {
        code: 'personal_portal_goal_locked',
      })
    })

  it('checks a running Group rating target before creating a personal Portal', async () => {
    await seedCreationGroup(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      groupId: GROUP,
      name: 'Desk',
    })
    const checkGroupTarget = goalLocked()
    await expect(
      checkPersonalPortalSource({ ...worldDeps(), checkGroupTarget })(
        { propertyId: PROPERTY, portalGroupId: GROUP },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
    expect(checkGroupTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalGroupId: GROUP,
        skipsPrivateRating: false,
      }),
    )
    expect(await portalCount()).toBe(0)
  })

  it('checks a Group target with the skip setting the copy would inherit', async () => {
    await seedCreationGroup(getPool(), {
      organizationId: ORG_A,
      propertyId: PROPERTY,
      groupId: GROUP,
      name: 'Desk',
    })
    await seedReception({ skipPrivateRating: true })
    const checkGroupTarget = goalLocked()
    await expect(
      checkPersonalPortalSource({ ...worldDeps(), checkGroupTarget })(
        { propertyId: PROPERTY, portalGroupId: GROUP, sourcePortalId: RECEPTION },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
    expect(checkGroupTarget).toHaveBeenCalledWith(
      expect.objectContaining({ skipsPrivateRating: true }),
    )
  })

  it('refuses a Group of another organization', async () => {
    await seedCreationGroup(getPool(), {
      organizationId: ORG_B,
      propertyId: PROPERTY_B,
      groupId: GROUP,
    })
    await expect(
      checkPersonalPortalSource(worldDeps())(
        { propertyId: PROPERTY, portalGroupId: GROUP },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'group_not_found' })
  })

  it('refuses missing guest wording before creating a Portal', async () => {
    await expect(
      createPersonalPortal(worldDeps({ accessible: [NO_WORDING_PROPERTY] }))(
        { ...newPerson, propertyId: NO_WORDING_PROPERTY, displayName: 'Polly' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'guest_wording_missing' })
    expect(await portalCount()).toBe(0)
    expect(await outboxCount()).toBe(0)
  })

  it('uses the publication time zone blocker before a write', async () => {
    await getPool().query(
      `UPDATE properties SET timezone = 'Invalid/Zone' WHERE id = $1`,
      [PROPERTY],
    )
    await expect(
      assertPersonalPropertySource(worldDeps(), ctx, PROPERTY),
    ).rejects.toMatchObject({ code: 'time_zone_invalid' })
    expect(await portalCount()).toBe(0)
  })

  const managersOf = async (portalId: string) =>
    (
      await rows(
        `SELECT user_id FROM portal_responsible_managers WHERE organization_id = $1 AND portal_id = $2 ORDER BY user_id`,
        ORG_A,
        portalId,
      )
    ).map((row) => row.user_id)

  it('inherits eligible responsible managers from the copied Portal', async () => {
    await seedReception()
    for (const user of ['source-manager', 'departed-manager']) {
      await seedCreationResponsibleManager(getPool(), {
        organizationId: ORG_A,
        propertyId: PROPERTY,
        portalId: RECEPTION,
        userId: user,
      })
    }
    const deps = worldDeps({
      managers: [{ userId: 'source-manager', role: 'AccountAdmin' }],
    })
    await createPersonalPortal(deps)({ ...newPerson, sourcePortalId: RECEPTION }, ctx)
    expect(await managersOf(RESERVED)).toEqual(['source-manager'])
  })

  it('falls back to the eligible creator when the source has no eligible managers', async () => {
    await seedReception()
    await createPersonalPortal(worldDeps())(
      { ...newPerson, sourcePortalId: RECEPTION },
      ctx,
    )
    expect(await managersOf(RESERVED)).toEqual([CREATOR])
  })

  it('copies the source’s wording, links and public name, and nothing of its code', async () => {
    await seedReception()
    const portal = await createPersonalPortal(worldDeps())(
      { ...newPerson, sourcePortalId: RECEPTION },
      ctx,
    )
    expect(portal).toMatchObject({ publicName: 'Reception', kind: 'personal' })
    expect(
      await rows(
        `SELECT locale, label FROM portal_link_texts WHERE portal_id = $1`,
        RESERVED,
      ),
    ).toEqual([{ locale: 'en', label: 'Menu' }])
    expect(await countOf('portal_tokens')).toBe(0)
    expect(await portalCount(ORG_B)).toBe(0)
  })

  it.each([
    ['Welcome back', true],
    ['Ask Polly about your visit', false],
  ])('copies safe saved print wording (%s)', async (headline, copied) => {
    await seedReception()
    const wording = {
      callToAction: 'how_did_we_do' as const,
      customWords: { en: { headline, subline: '' } },
    }
    await createPortalPrintWordingRepository(getDb()).save({
      organizationId: ORG_A,
      propertyId: PROPERTY,
      portalId: RECEPTION as never,
      wording,
      savedAt: CLOCK,
    })
    await createPersonalPortal(worldDeps())(
      { ...newPerson, sourcePortalId: RECEPTION },
      ctx,
    )
    const saved = await rows(
      `SELECT call_to_action, call_to_action_custom FROM portal_print_wordings WHERE portal_id = $1`,
      RESERVED,
    )
    expect(saved).toEqual(
      copied
        ? [
            {
              call_to_action: wording.callToAction,
              call_to_action_custom: wording.customWords,
            },
          ]
        : [],
    )
  })

  it('wires the same preflight through the Portal management builder', async () => {
    await expect(
      buildPersonalPortalUseCases(
        { ...worldDeps(), addressRecoverable: false },
        {} as never,
      ).checkPersonalPortalSource({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })
  })
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

  it.each([
    ['a Portal that is nobody’s', { kind: 'place' as const }, 'forbidden'],
    ['an archived page', { state: 'archived' as const }, 'portal_inactive'],
  ])('refuses %s, writing nothing', async (_name, options, code) => {
    await pageWorld(options)
    const before = await pageState()
    await expect(update()).rejects.toMatchObject({ code })
    expect(await pageState()).toEqual(before)
  })

  it('refuses a source at another Property, writing nothing', async () => {
    await pageWorld()
    await seedCreationPortal(getPool(), {
      organizationId: ORG_A,
      propertyId: OTHER_PROPERTY,
      portalId: RECEPTION_B,
      slug: 'elsewhere',
    })
    const before = await pageState()
    await expect(update(buildUpdate(), RECEPTION_B)).rejects.toMatchObject({
      code: 'portal_not_found',
    })
    expect(await pageState()).toEqual(before)
  })

  it('refuses a source of another organization, writing nothing in either', async () => {
    await pageWorld()
    await seedCreationPortal(getPool(), {
      organizationId: ORG_B,
      propertyId: PROPERTY_B,
      portalId: RECEPTION_B,
      slug: 'reception',
    })
    const before = await pageState()
    await expect(update(buildUpdate(), RECEPTION_B)).rejects.toMatchObject({
      code: 'portal_not_found',
    })
    expect(await pageState()).toEqual(before)
    expect(await portalCount(ORG_B)).toBe(1)
    expect(await outboxCount(ORG_B)).toBe(0)
  })

  it('refuses a page of another organization as unknown', async () => {
    await pageWorld()
    const deps = buildUpdate()
    await expect(
      deps(
        { portalId: PERSON, sourcePortalId: RECEPTION },
        buildTestAuthContext({
          organizationId: ORG_B,
          userId: CREATOR,
          role: 'AccountAdmin',
        }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('refuses someone who may not change the page', async () => {
    await pageWorld()
    const before = await pageState()
    await expect(update(buildUpdate(), RECEPTION, member)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(await pageState()).toEqual(before)
  })

  it('checks the gates before replacing, so a refused publish changes nothing', async () => {
    await pageWorld()
    const before = await pageState()
    const run = buildUpdate({
      propertyGoogleReviewDestinationApi: {
        getGoogleReviewDestination: async () => null,
      },
    })
    await expect(update(run)).rejects.toMatchObject({
      code: 'google_review_destination_unavailable',
    })
    expect(await pageState()).toEqual(before)
  })

  it.each([
    [
      'nobody is responsible for it',
      { needsOwner: true },
      'responsible_manager_ineligible',
    ],
    ['its code no longer resolves', { withToken: false }, 'token_unavailable'],
  ])('asks first when %s, so nothing changes', async (_name, options, code) => {
    await pageWorld(options)
    const before = await pageState()
    await expect(update()).rejects.toMatchObject({ code })
    expect(await pageState()).toEqual(before)
  })

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
        call_to_action: PRINT_FINAL_DEFAULT_WORDING.callToAction,
        call_to_action_custom: PRINT_FINAL_DEFAULT_WORDING.customWords,
      },
    ])
  })

  it('refuses a source whose guest wording would name the person', async () => {
    await pageWorld({ name: 'Harbor' })
    const before = await pageState()
    await expect(update()).rejects.toMatchObject({ code: 'personal_portal_name_private' })
    expect(await pageState()).toEqual(before)
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
