// The create-Portal guards are pure: they judge a command's parts against each
// other before any transaction opens. Real-database behaviour is covered by
// portal-create-command.integration.test.ts.

import { describe, expect, it } from 'vitest'
import { buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalApprovedDestinationId,
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalAddedToGroup,
  portalCreated,
  portalResponsibilityNeeded,
} from '../domain/events'
import { isPortalError } from '../domain/errors'
import type { PortalLink, PortalLinkCategory } from '../domain/types'
import type { CreatePortalCommand } from '../application/ports/portal-command-store.port'
import { assertCreateCommand } from './portal-create-guards'

const ORG = organizationId('org-guards-0000-0000-000000000001')
const PROPERTY = propertyId('a1000000-0000-4000-8000-000000000001')
const PORTAL = portalId('b1000000-0000-4000-8000-000000000001')
const SOURCE = portalId('b1000000-0000-4000-8000-000000000002')
const GROUP = portalGroupId('c1000000-0000-4000-8000-000000000001')
const CREATOR = userId('creator-guards-000000000000000001')
const AT = new Date('2026-10-01T10:00:00.000Z')
const GROUP_AT = new Date('2026-10-01T09:00:00.000Z')

const portal = buildTestPortal({
  id: String(PORTAL),
  organizationId: ORG,
  propertyId: PROPERTY,
  createdBy: CREATOR,
  createdAt: AT,
  updatedAt: AT,
  publicationState: 'draft',
  primaryGuestLocale: 'en',
  additionalGuestLocales: ['bg'],
})

const factBase = {
  portalId: PORTAL,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceAggregateVersion: AT.toISOString(),
  occurredAt: AT,
}

const baseCommand = (): CreatePortalCommand => ({
  organizationId: ORG,
  portal,
  initialResponsibleManagerIds: [CREATOR],
  event: portalCreated({ ...factBase, publicationState: 'draft' }),
})

const codeOf = (command: CreatePortalCommand): string | undefined => {
  try {
    assertCreateCommand(command)
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

const category: PortalLinkCategory = {
  id: portalLinkCategoryId('d1000000-0000-4000-8000-000000000001'),
  portalId: PORTAL,
  organizationId: ORG,
  title: 'Food',
  sortKey: 'a0',
  createdAt: AT,
  updatedAt: AT,
}

const link: PortalLink = {
  id: portalLinkId('e1000000-0000-4000-8000-000000000001'),
  categoryId: category.id,
  portalId: PORTAL,
  organizationId: ORG,
  propertyId: PROPERTY,
  destinationId: portalApprovedDestinationId('f1000000-0000-4000-8000-000000000001'),
  legacyDestinationState: 'migrated',
  label: 'Menu',
  url: 'https://example.test/menu',
  iconKey: null,
  sortKey: 'a0',
  createdAt: AT,
  updatedAt: AT,
}

const copied = (
  patch: Partial<NonNullable<CreatePortalCommand['copiedContent']>> = {},
) => ({
  sourcePortalId: SOURCE,
  overrides: [],
  categories: [category],
  links: [link],
  linkTexts: [
    {
      linkId: link.id,
      locale: 'en' as const,
      label: 'Menu',
      line: null,
      provenance: null,
    },
  ],
  ...patch,
})

const membership = (
  patch: Partial<NonNullable<CreatePortalCommand['groupMembership']>> = {},
) => {
  const revision = new Date(GROUP_AT.getTime() + 1)
  return {
    portalGroupId: GROUP,
    expectedGroupUpdatedAt: GROUP_AT,
    revision,
    event: portalAddedToGroup({
      portalGroupId: GROUP,
      portalId: PORTAL,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceAggregateVersion: revision.toISOString(),
      occurredAt: AT,
    }),
    ...patch,
  }
}

describe('assertCreateCommand', () => {
  it('accepts a Portal with its manager, group and copied content', () => {
    expect(
      codeOf({
        ...baseCommand(),
        groupMembership: membership(),
        copiedContent: copied(),
      }),
    ).toBeUndefined()
  })

  it('refuses a created fact that names another Portal', () => {
    const command = baseCommand()
    expect(
      codeOf({
        ...command,
        event: portalCreated({
          ...factBase,
          portalId: SOURCE,
          publicationState: 'draft',
        }),
      }),
    ).toBe('forbidden')
  })

  it('refuses a Portal of another organization', () => {
    expect(
      codeOf({ ...baseCommand(), organizationId: organizationId('org-other') }),
    ).toBe('forbidden')
  })

  describe('responsibility', () => {
    const needed = portalResponsibilityNeeded(factBase)
    const unowned = { ...portal, responsibilityNeededSince: AT }

    it('wants the recovery fact exactly when nobody is responsible', () => {
      expect(
        codeOf({
          ...baseCommand(),
          portal: unowned,
          initialResponsibleManagerIds: [],
          responsibilityNeededEvent: needed,
        }),
      ).toBeUndefined()
      expect(
        codeOf({ ...baseCommand(), portal: unowned, initialResponsibleManagerIds: [] }),
      ).toBe('revision_conflict')
      expect(codeOf({ ...baseCommand(), responsibilityNeededEvent: needed })).toBe(
        'revision_conflict',
      )
    })

    it('refuses the same manager twice', () => {
      expect(
        codeOf({ ...baseCommand(), initialResponsibleManagerIds: [CREATOR, CREATOR] }),
      ).toBe('responsible_manager_ineligible')
    })

    it('refuses a recovery fact about another Portal', () => {
      expect(
        codeOf({
          ...baseCommand(),
          portal: unowned,
          initialResponsibleManagerIds: [],
          responsibilityNeededEvent: portalResponsibilityNeeded({
            ...factBase,
            portalId: SOURCE,
          }),
        }),
      ).toBe('forbidden')
    })
  })

  it('wants the creator named when it joins a group or takes copied content', () => {
    const anonymous = { ...portal, createdBy: null }
    expect(
      codeOf({ ...baseCommand(), portal: anonymous, groupMembership: membership() }),
    ).toBe('forbidden')
    expect(codeOf({ ...baseCommand(), portal: anonymous, copiedContent: copied() })).toBe(
      'forbidden',
    )
    expect(codeOf({ ...baseCommand(), portal: anonymous })).toBeUndefined()
  })

  describe('group membership', () => {
    it('refuses a revision that does not move past the group the command read', () => {
      expect(
        codeOf({
          ...baseCommand(),
          groupMembership: membership({ revision: GROUP_AT }),
        }),
      ).toBe('revision_conflict')
    })

    it('refuses a fact that names another group', () => {
      expect(
        codeOf({
          ...baseCommand(),
          groupMembership: membership({ portalGroupId: portalGroupId('other-group') }),
        }),
      ).toBe('forbidden')
    })
  })

  describe('copied content', () => {
    const run = (patch: Parameters<typeof copied>[0]) =>
      codeOf({ ...baseCommand(), copiedContent: copied(patch) })

    it('refuses a copy of the Portal onto itself', () => {
      expect(run({ sourcePortalId: PORTAL })).toBe('forbidden')
    })

    it('refuses more links than a Portal may carry', () => {
      const many = [1, 2, 3, 4, 5].map((n) => ({
        ...link,
        id: portalLinkId(`e1000000-0000-4000-8000-00000000000${n}`),
      }))
      expect(
        run({
          links: many,
          linkTexts: many.map((l) => ({
            linkId: l.id,
            locale: 'en' as const,
            label: 'x',
            line: null,
            provenance: null,
          })),
        }),
      ).toBe('forbidden')
    })

    it('refuses rows that belong to another Portal or organization', () => {
      expect(run({ categories: [{ ...category, portalId: SOURCE }] })).toBe('forbidden')
      expect(run({ links: [{ ...link, portalId: SOURCE }] })).toBe('forbidden')
      expect(
        run({ links: [{ ...link, organizationId: organizationId('org-other') }] }),
      ).toBe('forbidden')
      expect(
        run({ links: [{ ...link, propertyId: propertyId('other-property') }] }),
      ).toBe('forbidden')
    })

    it('refuses a link that is not an approved destination', () => {
      expect(
        run({
          links: [
            { ...link, destinationId: null, legacyDestinationState: 'unclassified' },
          ],
        }),
      ).toBe('forbidden')
    })

    it('refuses a link whose category was not copied', () => {
      expect(run({ categories: [] })).toBe('forbidden')
    })

    it('refuses texts of links that were not copied or of languages not offered', () => {
      expect(
        run({
          linkTexts: [
            {
              linkId: link.id,
              locale: 'en',
              label: 'Menu',
              line: null,
              provenance: null,
            },
            {
              linkId: portalLinkId('e1000000-0000-4000-8000-0000000000ff'),
              locale: 'en',
              label: 'Stray',
              line: null,
              provenance: null,
            },
          ],
        }),
      ).toBe('forbidden')
      expect(
        run({
          linkTexts: [
            {
              linkId: link.id,
              locale: 'en',
              label: 'Menu',
              line: null,
              provenance: null,
            },
            {
              linkId: link.id,
              locale: 'de',
              label: 'Speisekarte',
              line: null,
              provenance: null,
            },
          ],
        }),
      ).toBe('forbidden')
    })

    it('refuses a link with no text in the primary language', () => {
      expect(
        run({
          linkTexts: [
            {
              linkId: link.id,
              locale: 'bg',
              label: 'Меню',
              line: null,
              provenance: null,
            },
          ],
        }),
      ).toBe('forbidden')
    })

    it('refuses wording for a language the Portal does not offer', () => {
      expect(
        run({
          overrides: [
            {
              id: 'ov-1',
              locale: 'de',
              title: 'Pool',
              shortDescription: null,
              linktreeTitle: null,
            },
          ],
        }),
      ).toBe('forbidden')
    })
  })
})
