// A person's guest page over the real repositories and the atomic command store on
// PostgreSQL, for two Organizations: adding the page (the preflight, the reserved id,
// the managers and print words it inherits). A refusal must leave every row and
// outbox fact as it was.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildPersonalPortalUseCases } from '../build-personal-portals'
import { assertPersonalPropertySource } from './personal-portal-property-source.server'
import {
  checkPersonalPortalSource,
  createPersonalPortal,
} from './create-personal-portal.server'
import { codeOf } from '../publication/portal-creation-queries.test-fixtures'
import { createPortalPrintWordingRepository } from '../printing/portal-print-wording-repository.server'
import {
  PORTAL_CREATION_TABLES,
  seedCreationGroup,
  seedCreationPortal,
  seedCreationResponsibleManager,
} from '../infrastructure/testing/portal-creation-world'
import {
  CREATOR,
  GROUP,
  MISSING,
  NO_WORDING_PROPERTY,
  ORG_A,
  ORG_B,
  OTHER_PROPERTY,
  PROPERTY,
  PROPERTY_B,
  RECEPTION,
  RECEPTION_B,
  RESERVED,
  CLOCK,
  ctx,
  member,
  newPerson,
  createPersonalCreateHarness,
  seedPersonalCreateProperties,
  TEST_ORGANIZATIONS,
} from './portal-personal-create.test-fixtures'

const { getPool } = setupIntegrationDb({
  ...TEST_ORGANIZATIONS,
  tables: PORTAL_CREATION_TABLES,
})
const { worldDeps, rows, countOf, portalCount, outboxCount, seedReception } =
  createPersonalCreateHarness(getPool)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedPersonalCreateProperties(getPool())
})

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

  const withoutGoogleDestination = () => ({
    ...worldDeps(),
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => null,
    },
  })
  const withUnavailableProperty = () => ({
    ...worldDeps(),
    propertyLifecycleApi: { isPropertyActive: async () => false },
  })

  // Publishing runs these two gates first. A check that passes here and a publish
  // that refuses would leave a person with a draft Portal and "Setup didn't finish".
  it.each([
    [
      'refuses a Property without a verified Google destination before creating a Portal',
      withoutGoogleDestination,
      'google_review_destination_unavailable',
    ],
    [
      'refuses an unavailable Property before creating a Portal',
      withUnavailableProperty,
      'portal_inactive',
    ],
  ])('%s', async (_title, gated, code) => {
    await expect(
      checkPersonalPortalSource(gated())({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code })
    await expect(createPersonalPortal(gated())(newPerson, ctx)).rejects.toMatchObject({
      code,
    })
    expect(await portalCount()).toBe(0)
  })

  it('asks the same two gates of a copy from another Portal', async () => {
    await seedReception()
    const copy = { propertyId: PROPERTY, sourcePortalId: RECEPTION }
    await expect(
      checkPersonalPortalSource(withoutGoogleDestination())(copy, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    await expect(
      checkPersonalPortalSource(withUnavailableProperty())(copy, ctx),
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

  it.each([
    [
      'refuses an archived copy source',
      () =>
        seedCreationPortal(getPool(), {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: RECEPTION,
          slug: 'reception',
          publicationState: 'archived',
        }),
      'source_archived',
    ],
    [
      'refuses a source whose working copy differs from its published snapshot',
      async () => {
        await seedReception()
        await getPool().query(
          `UPDATE portals SET linktree_enabled = false WHERE id = $1`,
          [RECEPTION],
        )
      },
      'source_has_unpublished_changes',
    ],
    [
      'refuses a source that was never published',
      () =>
        seedCreationPortal(getPool(), {
          organizationId: ORG_A,
          propertyId: PROPERTY,
          portalId: RECEPTION,
          slug: 'reception',
        }),
      'source_has_unpublished_changes',
    ],
  ] as const)('%s', async (_title, arrange, code) => {
    await arrange()
    await expect(
      checkPersonalPortalSource(worldDeps())(
        { propertyId: PROPERTY, sourcePortalId: RECEPTION },
        ctx,
      ),
    ).rejects.toMatchObject({ code })
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
