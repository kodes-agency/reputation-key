import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItemFacts } from './ports/inbox-item-lookup.port'
import {
  resolveInboxResponsibleRecipients,
  resolveResponsibleRecipients,
} from './responsible-recipients'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('property-1')
const PORTAL = portalId('portal-1')
const GROUP = portalGroupId('group-1')
const MANAGER = userId('manager-1')
const ADMIN = userId('admin-1')

const makeDeps = () => ({
  responsibleManagers: {
    findForProperty: vi.fn(async () => [MANAGER]),
    findForPortal: vi.fn(async () => [MANAGER]),
    findForPortalGroup: vi.fn(async () => [MANAGER]),
    isEligibleForProperty: vi.fn(async () => true),
  },
  userLookup: {
    findByRole: vi.fn(async () => [ADMIN]),
  },
})

const facts = (overrides: Partial<InboxItemFacts> = {}): InboxItemFacts => ({
  propertyId: PROPERTY,
  portalId: null,
  assignedTo: null,
  propertyName: 'Riverside',
  guestRating: null,
  sourceType: 'review',
  createdAt: new Date('2026-08-25T12:00:00.000Z'),
  ...overrides,
})

describe('resolveResponsibleRecipients', () => {
  it('uses current explicit Property responsibility without broad admin fan-out', async () => {
    const deps = makeDeps()

    await expect(
      resolveResponsibleRecipients(deps, ORG, {
        kind: 'property',
        propertyId: PROPERTY,
      }),
    ).resolves.toEqual([MANAGER])

    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('uses AccountAdmins only as recovery fallback when a scope has no manager', async () => {
    const deps = makeDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([])

    await expect(
      resolveResponsibleRecipients(deps, ORG, { kind: 'portal', portalId: PORTAL }),
    ).resolves.toEqual([ADMIN])

    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG, 'AccountAdmin')
  })

  it('resolves Portal Group recipients through the group responsibility seam', async () => {
    const deps = makeDeps()

    await resolveResponsibleRecipients(deps, ORG, {
      kind: 'portal_group',
      portalGroupId: GROUP,
    })

    expect(deps.responsibleManagers.findForPortalGroup).toHaveBeenCalledWith(ORG, GROUP)
  })
})

describe('resolveInboxResponsibleRecipients', () => {
  it('routes Google reviews to Property Responsible Managers', async () => {
    const deps = makeDeps()

    await expect(resolveInboxResponsibleRecipients(deps, ORG, facts())).resolves.toEqual([
      MANAGER,
    ])

    expect(deps.responsibleManagers.findForProperty).toHaveBeenCalledWith(ORG, PROPERTY)
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })

  it('routes private feedback to Portal Responsible Managers', async () => {
    const deps = makeDeps()

    await expect(
      resolveInboxResponsibleRecipients(
        deps,
        ORG,
        facts({ sourceType: 'feedback', portalId: PORTAL }),
      ),
    ).resolves.toEqual([MANAGER])

    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
  })

  it('never substitutes Property access or responsibility when feedback loses its Portal attribution', async () => {
    const deps = makeDeps()

    await expect(
      resolveInboxResponsibleRecipients(
        deps,
        ORG,
        facts({ sourceType: 'feedback', portalId: null }),
      ),
    ).resolves.toEqual([ADMIN])

    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()
    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG, 'AccountAdmin')
  })
})
