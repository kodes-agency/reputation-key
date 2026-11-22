import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { userId } from '#/shared/domain/ids'
import { parseNotificationAudience } from './notification-audience.server'
import {
  buildAudienceDeps,
  decide,
  escalationAudience,
  escalationFacts,
  inboxItemFacts,
  INBOX_ITEM,
  ORG,
  PORTAL,
  PROPERTY,
  RECIPIENT,
  RESPONSIBLE_MANAGER,
  SECOND_INBOX_ITEM,
  type AudienceDeps,
} from './notification-audience.test-fixtures'

let held: HeldTransaction
beforeAll(async () => {
  held = await holdTransaction()
})
afterAll(async () => {
  await held?.rollBack()
})

const buildDeps = () => buildAudienceDeps(held.db)

describe('notification audience authorization', () => {
  // I5.3: an approval request is admitted by two authorities, and either can
  // end on its own.
  it.each([
    [
      'admits a responsible manager who may still approve replies',
      (deps: AudienceDeps) => {
        deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
        deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
      },
      PROPERTY,
      true,
    ],
    [
      'refuses an approver who lost the Property',
      (deps: AudienceDeps) => {
        deps.responsibleManagers.findForProperty.mockResolvedValue([])
      },
      PROPERTY,
      false,
    ],
    [
      'refuses an approver whose role no longer carries reply.manage',
      (deps: AudienceDeps) => {
        deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
        deps.replyApproval.canApproveReplies.mockResolvedValue(false)
      },
      PROPERTY,
      false,
    ],
    [
      'refuses an approver admitted for a different Property',
      (deps: AudienceDeps) => {
        deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
      },
      '55555555-5555-4555-8555-555555555555',
      false,
    ],
  ] as const)('%s', async (_title, arrange, audiencePropertyId, expected) => {
    const deps = buildDeps()
    arrange(deps)

    await expect(
      decide(deps, {
        audience: { kind: 'reply_approver', propertyId: audiencePropertyId },
      }),
    ).resolves.toBe(expected)
  })

  it.each([
    [
      'parses and revalidates an exact affected Organization account recipient',
      'identity-event-1',
      'identity.member.role_changed',
    ],
    [
      'admits a property-access change as a fact that names its affected member',
      'identity-event-2',
      'identity.member.property_access_changed',
    ],
  ] as const)('%s', async (_title, eventId, eventType) => {
    const deps = buildDeps()
    deps.organizationAccountAuthority.isAffectedRecipient.mockResolvedValue(true)
    const audience = {
      kind: 'affected_organization_user' as const,
      eventId,
      eventType,
    }

    expect(parseNotificationAudience(audience)).toEqual(audience)
    await expect(decide(deps, { propertyId: null, audience })).resolves.toBe(true)
    expect(deps.organizationAccountAuthority.isAffectedRecipient).toHaveBeenCalledWith({
      eventId,
      eventType,
      organizationId: ORG,
      userId: RECIPIENT,
    })
  })

  it('fails closed when account audience and notification scopes disagree', async () => {
    const deps = buildDeps()
    deps.organizationAccountAuthority.isAffectedRecipient.mockResolvedValue(true)
    const accountAudience = {
      kind: 'affected_organization_user' as const,
      eventId: 'identity-event-1',
      eventType: 'identity.member.removed' as const,
    }

    await expect(decide(deps, { audience: accountAudience })).resolves.toBe(false)
    await expect(
      decide(deps, {
        propertyId: null,
        audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM },
      }),
    ).resolves.toBe(false)
  })

  it('admits every current AccountAdmin to an Organization notice that has no Property', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      decide(deps, { propertyId: null, audience: { kind: 'account_admin' } }),
    ).resolves.toBe(true)
    expect(deps.userLookup.findByRole).toHaveBeenCalledWith(ORG, 'AccountAdmin')
    // No Property is invented for it: the purge-pending notice belongs to the
    // Organization, and an Organization with no active Property still has
    // admins who must hear that it is about to be erased.
    expect(deps.responsibleManagers.isEligibleForProperty).not.toHaveBeenCalled()
  })

  it('refuses an Organization notice for someone who is no longer an AccountAdmin', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RESPONSIBLE_MANAGER])

    await expect(
      decide(deps, { propertyId: null, audience: { kind: 'account_admin' } }),
    ).resolves.toBe(false)
  })

  it('authorizes only a current manager for an explicitly owned scope', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    deps.userLookup.findByRole.mockResolvedValue([userId('admin-1')])

    await expect(
      decide(deps, {
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'portal', portalId: PORTAL },
        },
      }),
    ).resolves.toBe(true)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('authorizes a current AccountAdmin only when an owned scope has no eligible manager', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      decide(deps, {
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: PROPERTY },
        },
      }),
    ).resolves.toBe(true)
  })

  it('does not treat an AccountAdmin as fallback while a scoped manager exists', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([userId('other-manager')])
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      decide(deps, {
        audience: {
          kind: 'responsible_scope',
          scope: { kind: 'property', propertyId: PROPERTY },
        },
      }),
    ).resolves.toBe(false)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  describe('a request to choose a responsible manager', () => {
    const propertyGap = {
      kind: 'responsibility_gap' as const,
      scope: { kind: 'property' as const, propertyId: PROPERTY },
    }
    const portalGap = {
      kind: 'responsibility_gap' as const,
      scope: { kind: 'portal' as const, portalId: PORTAL },
    }

    it.each([
      ['Property', propertyGap, 'findForProperty'],
      ['Portal', portalGap, 'findForPortal'],
    ] as const)(
      'reaches a current AccountAdmin only while the %s still has no manager',
      async (_label, audience, lookup) => {
        const deps = buildDeps()
        deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])
        const authorizeGap = () => decide(deps, { audience })

        await expect(authorizeGap()).resolves.toBe(true)

        // Someone chose a manager while the notice waited in the queue.
        deps.responsibleManagers[lookup].mockResolvedValue([RESPONSIBLE_MANAGER])
        await expect(authorizeGap()).resolves.toBe(false)
      },
    )

    it('never reaches someone who is not an AccountAdmin', async () => {
      const deps = buildDeps()
      deps.userLookup.findByRole.mockResolvedValue([RESPONSIBLE_MANAGER])

      await expect(decide(deps, { audience: propertyGap })).resolves.toBe(false)
    })

    it('fails closed when the gap names another Property', async () => {
      const deps = buildDeps()
      deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

      await expect(
        decide(deps, {
          audience: {
            ...propertyGap,
            scope: { kind: 'property', propertyId: 'another-property' },
          },
        }),
      ).resolves.toBe(false)
    })
  })

  it('revalidates direct AccountAdmin recovery recipients', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(decide(deps)).resolves.toBe(true)
  })

  it('revalidates a direct assignee or reply author against property eligibility', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await expect(decide(deps, { audience: { kind: 'property_operator' } })).resolves.toBe(
      true,
    )
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('rejects a replaced Inbox assignee even when the old assignee remains property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
      inboxItemFacts({ assignedTo: userId('replacement-manager') }),
    )

    await expect(
      decide(deps, { audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM } }),
    ).resolves.toBe(false)
  })

  it('authorizes the current Inbox assignee only while they remain property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
      inboxItemFacts({ assignedTo: RECIPIENT }),
    )

    await expect(
      decide(deps, { audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM } }),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  const bulkAudience = {
    kind: 'bulk_inbox_assignee' as const,
    inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM],
  }

  it('authorizes a grouped assignment for the items still assigned in that Property', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts
      .mockResolvedValueOnce(inboxItemFacts({ assignedTo: RECIPIENT }))
      .mockResolvedValueOnce(
        inboxItemFacts({ assignedTo: userId('replacement-manager') }),
      )

    await expect(decide(deps, { audience: bulkAudience })).resolves.toEqual({
      itemCount: 1,
    })
  })

  it('authorizes a grouped assignment when every item and Property permission are current', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue(
      inboxItemFacts({ assignedTo: RECIPIENT }),
    )

    await expect(decide(deps, { audience: bulkAudience })).resolves.toEqual({
      itemCount: 2,
    })
    expect(deps.inboxItemLookup.findInboxItemFacts).toHaveBeenCalledTimes(2)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('authorizes a resolved-escalation recipient only for the exact current resolution authority', async () => {
    const deps = buildDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue(
      escalationFacts({ propertyName: 'Riverside Hotel' }),
    )
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await expect(decide(deps, { audience: escalationAudience() })).resolves.toBe(true)
  })

  it('rejects a stale resolution after re-escalation or recipient eligibility loss', async () => {
    const deps = buildDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue(
      escalationFacts({ isEscalated: true }),
    )
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    const input = { audience: escalationAudience() }

    await expect(decide(deps, input)).resolves.toBe(false)

    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue(
      escalationFacts(),
    )
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
    await expect(decide(deps, input)).resolves.toBe(false)
  })
})
