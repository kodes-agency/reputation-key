// Portal context — the command a New portal creates, built once every choice
// has been resolved (no group or copy, a group, nobody responsible, a copy).

import { describe, expect, it } from 'vitest'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import {
  portalApprovedDestinationId,
  portalGroupId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { PortalGroup } from '../domain/types'
import { buildCreatePortalCommand, type NewPortalPlan } from './create-portal-commit'
import type { PortalCopySource } from './portal-content-copy'

const ctx = buildTestAuthContext({ role: 'PropertyManager' })
const NOW = new Date('2026-10-01T10:00:00Z')
const NEW_ID = portalId('d0000000-0000-0000-0000-0000000000b2')
const SOURCE_ID = portalId('d0000000-0000-0000-0000-0000000000a1')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const DESTINATION = portalApprovedDestinationId('de000000-0000-0000-0000-000000000001')
const MANAGER = userId('user-00000000-0000-0000-0000-000000000001')

const sequentialIds = () => {
  let next = 0
  return () => `00000000-0000-0000-0000-${String(++next).padStart(12, '0')}`
}

const deps = {
  entityIdGen: sequentialIds(),
  clock: () => NOW,
}

const groupOf = (updatedAt: Date): PortalGroup => ({
  id: portalGroupId('90000000-0000-0000-0000-000000000001'),
  organizationId: ctx.organizationId,
  propertyId: PROPERTY,
  name: 'Pool side',
  sortKey: null,
  createdBy: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt,
  deletedAt: null,
})

const planOf = (patch: Partial<NewPortalPlan> = {}): NewPortalPlan => ({
  portalId: NEW_ID,
  input: { name: 'Pool bar', propertyId: String(PROPERTY) },
  locales: { primary: 'en', additional: ['bg'] },
  managerIds: [MANAGER],
  group: null,
  source: null,
  ...patch,
})

const copySource = (): PortalCopySource => {
  const category = buildTestPortalLinkCategory({
    portalId: SOURCE_ID,
    id: portalLinkCategoryId('c0000000-0000-0000-0000-0000000000a1'),
  })
  return {
    portal: buildTestPortal({
      id: SOURCE_ID,
      description: 'Welcome to the pool',
      privateFeedbackThreshold: 4,
      linktreeEnabled: false,
      theme: { primaryColor: '#112233' },
    }),
    overrides: [],
    categories: [category],
    links: [
      buildTestPortalLink({
        id: portalLinkId('00000000-0000-0000-0000-0000000000f1'),
        portalId: SOURCE_ID,
        categoryId: category.id,
        destinationId: DESTINATION,
        legacyDestinationState: 'migrated',
        sortKey: 'a0',
      }),
    ],
    linkTexts: [],
    approvedDestinationIds: new Set([DESTINATION]),
  }
}

describe('buildCreatePortalCommand', () => {
  it('builds a plain command when there is no group or copy', () => {
    const command = buildCreatePortalCommand(deps, ctx, planOf(), 'pool-bar')

    expect(command.portal.id).toBe(NEW_ID)
    expect(command.portal.slug).toBe('pool-bar')
    expect(command.portal.createdBy).toBe(ctx.userId)
    expect(command.portal.primaryGuestLocale).toBe('en')
    expect(command.portal.additionalGuestLocales).toEqual(['bg'])
    expect(command.portal.responsibilityNeededSince).toBeNull()
    expect(command.initialResponsibleManagerIds).toEqual([MANAGER])
    expect(command.event._tag).toBe('portal.created')
    expect(command.responsibilityNeededEvent).toBeUndefined()
    expect(command.groupMembership).toBeUndefined()
    expect(command.copiedContent).toBeUndefined()
    expect(command.health?.value).toBeDefined()
    expect(command.health?.sourceVersion).toBe(command.portal.updatedAt.toISOString())
  })

  it('fences a group that moved after the Portal was timed, on a later revision', () => {
    const groupUpdatedAt = new Date(NOW.getTime() + 5_000)
    const command = buildCreatePortalCommand(
      deps,
      ctx,
      planOf({ group: groupOf(groupUpdatedAt) }),
      'pool-bar',
    )

    const membership = command.groupMembership
    expect(membership?.portalGroupId).toBe(groupOf(groupUpdatedAt).id)
    expect(membership?.expectedGroupUpdatedAt).toEqual(groupUpdatedAt)
    // The revision is strictly later than the group's own, whatever the clock says.
    expect(membership?.revision.getTime()).toBeGreaterThan(groupUpdatedAt.getTime())
    expect(membership?.event.sourceAggregateVersion).toBe(
      membership?.revision.toISOString(),
    )
    expect(membership?.event.portalId).toBe(NEW_ID)
  })

  it('stamps the membership with the creation time when the group is older', () => {
    const command = buildCreatePortalCommand(
      deps,
      ctx,
      planOf({ group: groupOf(new Date('2026-04-02T00:00:00Z')) }),
      'pool-bar',
    )

    expect(command.groupMembership?.revision).toEqual(NOW)
  })

  it('marks the Portal as needing a responsible manager when none is named', () => {
    const command = buildCreatePortalCommand(
      deps,
      ctx,
      planOf({ managerIds: [] }),
      'pool-bar',
    )

    expect(command.initialResponsibleManagerIds).toEqual([])
    expect(command.portal.responsibilityNeededSince).toEqual(NOW)
    expect(command.responsibilityNeededEvent?._tag).toBe(
      'portal.responsibility_became_needed',
    )
    expect(command.responsibilityNeededEvent?.portalId).toBe(NEW_ID)
  })

  it('carries a copy of the source: its settings, links and a fresh category', () => {
    const command = buildCreatePortalCommand(
      deps,
      ctx,
      planOf({ source: copySource() }),
      'pool-bar',
    )

    expect(command.portal.description).toBe('Welcome to the pool')
    expect(command.portal.privateFeedbackThreshold).toBe(4)
    expect(command.portal.linktreeEnabled).toBe(false)
    expect(command.portal.theme.primaryColor).toBe('#112233')
    const copied = command.copiedContent
    expect(copied?.links).toHaveLength(1)
    expect(copied?.links[0]?.portalId).toBe(NEW_ID)
    expect(copied?.links[0]?.id).not.toBe('00000000-0000-0000-0000-0000000000f1')
    expect(copied?.categories).toHaveLength(1)
    expect(copied?.links[0]?.categoryId).toBe(copied?.categories[0]?.id)
  })

  it('lets what was typed win over the copy', () => {
    const command = buildCreatePortalCommand(
      deps,
      ctx,
      planOf({
        input: {
          name: 'Pool bar',
          propertyId: String(PROPERTY),
          description: 'Typed',
          privateFeedbackThreshold: 2,
        },
        source: copySource(),
      }),
      'pool-bar',
    )

    expect(command.portal.description).toBe('Typed')
    expect(command.portal.privateFeedbackThreshold).toBe(2)
  })
})
