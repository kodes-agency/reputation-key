// The reorderLinks and savePortalLinkTexts use cases over real repositories and
// the real command store, with two Organizations: what each command answers,
// what it stores, the facts it leaves in the outbox, and that nothing of the
// other Organization moves.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalLinkCategoryId } from '#/shared/domain/ids'
import { reorderLinks } from '../application/use-cases/reorder-links'
import { savePortalLinkTexts } from '../application/use-cases/save-portal-link-texts'
import { isPortalError } from '../domain/errors'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  countRows,
  linkTenant,
  outboxPayloads,
  portalUpdatedAt,
  realLinkDeps,
  rowsOf,
  seedCategory,
  seedLink,
  seedLinkTenant,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const ORG_A = organizationId('org-lnkreorder-0000-0000-000000000001')
const ORG_B = organizationId('org-lnkreorder-0000-0000-000000000002')
const A = linkTenant('b8e30001', ORG_A)
const B = linkTenant('b8e30002', ORG_B)
const CLOCK = new Date('2026-11-01T12:00:00.000Z')

bindLinkWorld({
  commandStore: () =>
    createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard()),
  buildPortal: buildTestPortal,
  buildAuthContext: buildTestAuthContext,
})

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: LINK_WORLD_TABLES,
})

const refusal = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const reorder = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
  reorderLinks(realLinkDeps({ clock: () => CLOCK, ...options }))
const saveTexts = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
  savePortalLinkTexts(realLinkDeps({ clock: () => CLOCK, ...options }))

const manager = () => tenantContext(A)

const sortKeys = async (tenant = A) =>
  Object.fromEntries(
    (
      await rowsOf<{ id: string; sort_key: string }>(
        getPool(),
        `SELECT id, sort_key FROM portal_links WHERE organization_id = $1`,
        [tenant.organizationId],
      )
    ).map((row) => [row.id, row.sort_key]),
  )

const textRows = (linkId: string) =>
  rowsOf<{
    locale: string
    label: string
    line: string | null
    provenance: string | null
  }>(
    getPool(),
    `SELECT locale, label, line, provenance FROM portal_link_texts
      WHERE link_id = $1 ORDER BY locale`,
    [linkId],
  )

const legacyLabel = async (linkId: string) =>
  (
    await rowsOf<{ label: string }>(
      getPool(),
      `SELECT label FROM portal_links WHERE id = $1`,
      [linkId],
    )
  )[0]?.label

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedLinkTenant(getPool(), A, { additionalGuestLocales: ['bg'] })
  await seedLinkTenant(getPool(), B)
})

describe('reorderLinks (real PostgreSQL)', () => {
  const input = (items: ReadonlyArray<{ id: string; sortKey: string }>) => ({
    categoryId: A.categoryId,
    portalId: A.portalId,
    items,
  })

  it('reorders links with new sort keys', async () => {
    const first = await seedLink(getPool(), A, { sortKey: 'a0' })
    const second = await seedLink(getPool(), A, { sortKey: 'a1' })

    await reorder()(
      input([
        { id: second.id, sortKey: 'a0' },
        { id: first.id, sortKey: 'a1' },
      ]),
      manager(),
    )

    expect(await sortKeys()).toEqual({ [second.id]: 'a0', [first.id]: 'a1' })
  })

  it('rejects mixed-category items atomically', async () => {
    const local = await seedLink(getPool(), A, { sortKey: 'a0' })
    const otherCategory = await seedCategory(
      getPool(),
      A,
      portalLinkCategoryId(randomUUID()),
      'a1',
    )
    const foreign = await seedLink(getPool(), A, {
      sortKey: 'a1',
      categoryId: otherCategory,
    })

    await expect(
      reorder()(
        input([
          { id: local.id, sortKey: 'z0' },
          { id: foreign.id, sortKey: 'z1' },
        ]),
        manager(),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))

    expect(await sortKeys()).toEqual({ [local.id]: 'a0', [foreign.id]: 'a1' })
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.reordered')).toEqual([])
  })

  it('rejects users who cannot update', async () => {
    const link = await seedLink(getPool(), A)

    await expect(
      reorder()(input([{ id: link.id, sortKey: 'b0' }]), tenantContext(A, 'Member')),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await sortKeys()).toEqual({ [link.id]: 'a0' })
  })

  it('records a portal_link.reordered fact for the category', async () => {
    const link = await seedLink(getPool(), A)

    await reorder()(input([{ id: link.id, sortKey: 'b0' }]), manager())

    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.reordered')).toEqual([
      expect.objectContaining({
        portalId: A.portalId,
        categoryId: A.categoryId,
        occurredAt: CLOCK.toISOString(),
      }),
    ])
  })

  it('rejects a PropertyManager without assignment to the property, and allows an assigned one', async () => {
    const link = await seedLink(getPool(), A, { sortKey: 'a0' })

    await expect(
      reorder({ accessible: [] })(input([{ id: link.id, sortKey: 'b0' }]), manager()),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await sortKeys()).toEqual({ [link.id]: 'a0' })

    await reorder({ accessible: [A.propertyId] })(
      input([{ id: link.id, sortKey: 'b0' }]),
      manager(),
    )

    expect(await sortKeys()).toEqual({ [link.id]: 'b0' })
  })

  it("denies another Organization's manager the Portal and its links, and changes nothing", async () => {
    const mine = await seedLink(getPool(), A, { sortKey: 'a0' })
    const theirs = await seedLink(getPool(), B, { sortKey: 'a0' })
    const intruder = tenantContext(B)

    await expect(
      reorder()(input([{ id: mine.id, sortKey: 'z0' }]), intruder),
    ).rejects.toSatisfy(refusal('portal_not_found'))
    await expect(
      reorder()(
        {
          categoryId: B.categoryId,
          portalId: B.portalId,
          items: [{ id: mine.id, sortKey: 'z0' }],
        },
        intruder,
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
    await expect(
      reorder()(input([{ id: theirs.id, sortKey: 'z0' }]), manager()),
    ).rejects.toSatisfy(refusal('forbidden'))

    expect(await sortKeys()).toEqual({ [mine.id]: 'a0' })
    expect(await sortKeys(B)).toEqual({ [theirs.id]: 'a0' })
    expect(await countRows(getPool(), 'outbox_events', ORG_B)).toBe(1)
  })
})

describe('savePortalLinkTexts (real PostgreSQL)', () => {
  const seeded = () => seedLink(getPool(), A, { text: null, legacyLabel: 'Legacy label' })

  it('saves a text per offered language and leaves the legacy link label alone', async () => {
    const link = await seeded()

    await saveTexts()(
      {
        linkId: link.id,
        texts: [
          { locale: 'en', label: '  Explore  ', line: 'Maps and tips' },
          { locale: 'bg', label: 'Разгледайте', line: null },
        ],
      },
      manager(),
    )

    expect(await textRows(link.id)).toEqual([
      { locale: 'bg', label: 'Разгледайте', line: null, provenance: null },
      { locale: 'en', label: 'Explore', line: 'Maps and tips', provenance: null },
    ])
    expect(await legacyLabel(link.id)).toBe('Legacy label')
  })

  it('records one portal_link.updated fact carrying identifiers only', async () => {
    const link = await seeded()

    await saveTexts()(
      { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
      manager(),
    )

    const facts = await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')
    expect(facts).toEqual([
      expect.objectContaining({
        linkId: link.id,
        portalId: A.portalId,
        categoryId: A.categoryId,
        occurredAt: CLOCK.toISOString(),
      }),
    ])
    expect(JSON.stringify(facts)).not.toContain('Explore')
  })

  it.each([
    ['an empty label', [{ locale: 'en' as const, label: '  ' }], 'invalid_label'],
    [
      'an over-long line',
      [{ locale: 'en' as const, label: 'Ok', line: 'x'.repeat(161) }],
      'invalid_label',
    ],
    [
      'a language the Portal does not offer',
      [{ locale: 'de' as const, label: 'Ok' }],
      'locale_not_offered',
    ],
    [
      'the same language twice',
      [
        { locale: 'en' as const, label: 'One' },
        { locale: 'en' as const, label: 'Two' },
      ],
      'locale_not_offered',
    ],
    ['no texts at all', [], 'invalid_label'],
  ])('refuses %s and writes nothing', async (_name, texts, code) => {
    const link = await seeded()

    await expect(saveTexts()({ linkId: link.id, texts }, manager())).rejects.toSatisfy(
      refusal(code),
    )

    expect(await textRows(link.id)).toEqual([])
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('refuses a role without portal.update', async () => {
    const link = await seeded()

    await expect(
      saveTexts()(
        { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
        tenantContext(A, 'Member'),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await textRows(link.id)).toEqual([])
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    const link = await seeded()

    await expect(
      saveTexts({ accessible: [] })(
        { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
        manager(),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await textRows(link.id)).toEqual([])
  })

  it('answers link_not_found for a link of another Organization, and leaves its texts alone', async () => {
    const theirs = await seedLink(getPool(), B, {
      text: { locale: 'en', label: 'Theirs' },
    })
    const mine = await seeded()

    await expect(
      saveTexts()(
        { linkId: theirs.id, texts: [{ locale: 'en', label: 'Explore' }] },
        manager(),
      ),
    ).rejects.toSatisfy(refusal('link_not_found'))
    await expect(
      saveTexts()(
        { linkId: mine.id, texts: [{ locale: 'en', label: 'Explore' }] },
        tenantContext(B),
      ),
    ).rejects.toSatisfy(refusal('link_not_found'))

    expect(await textRows(theirs.id)).toMatchObject([{ label: 'Theirs' }])
    expect(await textRows(mine.id)).toEqual([])
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('advances the Portal revision beyond the one it read', async () => {
    const link = await seeded()
    const before = await portalUpdatedAt(getPool(), A)

    await saveTexts()(
      { linkId: link.id, texts: [{ locale: 'en', label: 'Explore' }] },
      manager(),
    )

    expect((await portalUpdatedAt(getPool(), A)).getTime()).toBeGreaterThan(
      before.getTime(),
    )
  })
})
