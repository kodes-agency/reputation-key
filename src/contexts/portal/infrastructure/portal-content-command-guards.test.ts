import { describe, expect, it } from 'vitest'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  portalLinkCategoryCreated,
  portalLinkCreated,
  portalUpdated,
} from '../domain/events'
import {
  assertPortalContentCommand,
  type PortalContentCommand,
} from './portal-content-command-guards'

const ORG = organizationId('org-guards-0000-0000-000000000001')
const PROPERTY = propertyId('8a000000-0000-4000-8000-000000000011')
const PORTAL = portalId('8b000000-0000-4000-8000-000000000011')
const CATEGORY = portalLinkCategoryId('8c000000-0000-4000-8000-000000000011')
const LINK = portalLinkId('8d000000-0000-4000-8000-000000000011')
const AT = new Date('2026-10-01T10:00:00.000Z')

const shared = {
  organizationId: ORG,
  propertyId: PROPERTY,
  portalId: PORTAL,
  expectedPortalUpdatedAt: new Date(AT.getTime() - 1000),
  revision: AT,
  occurredAt: AT,
  actorUserId: userId('manager-guards-000000000000000001'),
}

const portalFact = portalUpdated({
  portalId: PORTAL,
  organizationId: ORG,
  propertyId: PROPERTY,
  previousPublicationState: 'published',
  publicationState: 'published',
  sourceAggregateVersion: AT.toISOString(),
  occurredAt: AT,
})

describe('assertPortalContentCommand and the portal.updated fact', () => {
  it('accepts it from the Linktree settings command', () => {
    const settings = {
      ...shared,
      enabled: false,
      titles: [],
      event: portalFact,
    } as unknown as PortalContentCommand

    expect(() => assertPortalContentCommand(settings)).not.toThrow()
  })

  it('accepts it from a settings command that only flips the switch', () => {
    const switchOnly = {
      ...shared,
      enabled: true,
      event: portalFact,
    } as unknown as PortalContentCommand

    expect(() => assertPortalContentCommand(switchOnly)).not.toThrow()
  })

  it('refuses it from a link create, update or text save', () => {
    const link = buildTestPortalLink({
      id: LINK,
      categoryId: CATEGORY,
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
    })
    const impostors = [
      { ...shared, link },
      { ...shared, linkId: LINK, categoryId: CATEGORY, patch: {} },
      { ...shared, linkId: LINK, categoryId: CATEGORY, texts: [] },
      { ...shared, categoryId: CATEGORY, updates: [] },
    ]

    for (const impostor of impostors) {
      const command = {
        ...impostor,
        event: portalFact,
      } as unknown as PortalContentCommand
      expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
    }
  })

  it('refuses it from a command that carries nothing of the settings shape', () => {
    const bare = { ...shared, event: portalFact } as unknown as PortalContentCommand

    expect(() => assertPortalContentCommand(bare)).toThrow(/mismatch/i)
  })
})

describe('assertPortalContentCommand and a link that starts its category', () => {
  const OTHER_ORG = organizationId('org-guards-0000-0000-000000000002')
  const OTHER_PORTAL = portalId('8b000000-0000-4000-8000-000000000012')
  const OTHER_CATEGORY = portalLinkCategoryId('8c000000-0000-4000-8000-000000000012')
  const LATER = new Date(AT.getTime() + 5000)

  const link = buildTestPortalLink({
    id: LINK,
    categoryId: CATEGORY,
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
  })
  const category = buildTestPortalLinkCategory({
    id: CATEGORY,
    portalId: PORTAL,
    organizationId: ORG,
  })
  const linkFact = portalLinkCreated({
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    linkId: LINK,
    categoryId: CATEGORY,
    sourceAggregateVersion: AT.toISOString(),
    occurredAt: AT,
  })
  const categoryFactArgs = {
    portalId: PORTAL,
    organizationId: ORG,
    propertyId: PROPERTY,
    categoryId: CATEGORY,
    sourceAggregateVersion: AT.toISOString(),
    occurredAt: AT,
  }

  const create = (
    started: Readonly<{ category: unknown; event: unknown }> | undefined,
  ): PortalContentCommand =>
    ({
      ...shared,
      link,
      event: linkFact,
      ...(started ? { startCategory: started } : {}),
    }) as unknown as PortalContentCommand

  it('accepts a started category that is scoped to the link and its fact', () => {
    const command = create({
      category,
      event: portalLinkCategoryCreated(categoryFactArgs),
    })

    expect(() => assertPortalContentCommand(command)).not.toThrow()
  })

  it('refuses a started category of another Portal', () => {
    const command = create({
      category: { ...category, portalId: OTHER_PORTAL },
      event: portalLinkCategoryCreated(categoryFactArgs),
    })

    expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
  })

  it('refuses a started category of another Organization', () => {
    const command = create({
      category: { ...category, organizationId: OTHER_ORG },
      event: portalLinkCategoryCreated(categoryFactArgs),
    })

    expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
  })

  it("refuses a started category that is not the link's category", () => {
    const command = create({
      category: { ...category, id: OTHER_CATEGORY },
      event: portalLinkCategoryCreated({
        ...categoryFactArgs,
        categoryId: OTHER_CATEGORY,
      }),
    })

    expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
  })

  it('refuses a category fact that names another category', () => {
    const command = create({
      category,
      event: portalLinkCategoryCreated({
        ...categoryFactArgs,
        categoryId: OTHER_CATEGORY,
      }),
    })

    expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
  })

  it('refuses a category fact of another Organization, Property or Portal', () => {
    const wrong = [
      { organizationId: OTHER_ORG },
      { propertyId: propertyId('8a000000-0000-4000-8000-000000000012') },
      { portalId: OTHER_PORTAL },
    ]

    for (const override of wrong) {
      const command = create({
        category,
        event: portalLinkCategoryCreated({ ...categoryFactArgs, ...override }),
      })
      expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
    }
  })

  it('refuses a category fact with another revision or time', () => {
    const wrong = [{ sourceAggregateVersion: LATER.toISOString() }, { occurredAt: LATER }]

    for (const override of wrong) {
      const command = create({
        category,
        event: portalLinkCategoryCreated({ ...categoryFactArgs, ...override }),
      })
      expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
    }
  })

  it('refuses a started category carrying a fact of another kind', () => {
    const command = create({ category, event: linkFact })

    expect(() => assertPortalContentCommand(command)).toThrow(/mismatch/i)
  })
})
