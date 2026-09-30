import { describe, expect, it } from 'vitest'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildTestPortalLink } from '#/shared/testing/fixtures'
import { portalUpdated } from '../domain/events'
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
