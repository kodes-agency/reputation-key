import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationAudienceAuthorizer,
  parseNotificationAudience,
  type NotificationAudienceAuthorizationInput,
} from './notification-audience'
import {
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('11111111-1111-4111-8111-111111111111')
const PORTAL = portalId('22222222-2222-4222-8222-222222222222')
const RECIPIENT = userId('manager-1')
const RESPONSIBLE_MANAGER = userId('responsible-manager-1')
const REPLACEMENT_ASSIGNEE = userId('replacement-assignee-1')
const INBOX_ITEM = inboxItemId('33333333-3333-4333-8333-333333333333')
const SECOND_INBOX_ITEM = inboxItemId('44444444-4444-4444-8444-444444444444')
const RESOLVED_AT = '2026-08-27T08:00:00.000Z'
const TARGET_SCHEDULED_FOR = '2026-08-28T08:00:00.000Z'

const buildDeps = () => ({
  userLookup: {
    findByRole: vi.fn().mockResolvedValue([]),
  },
  responsibleManagers: {
    findForProperty: vi.fn().mockResolvedValue([]),
    findForPortal: vi.fn().mockResolvedValue([]),
    findForPortalGroup: vi.fn().mockResolvedValue([]),
    isEligibleForProperty: vi.fn().mockResolvedValue(false),
  },
  inboxItemLookup: {
    findInboxItemFacts: vi.fn().mockResolvedValue(null),
    findHandlingCycleNotificationFacts: vi.fn().mockResolvedValue(null),
    findResponseTargetReminderNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  escalationResolutions: {
    findEscalationResolutionFacts: vi.fn().mockResolvedValue(null),
  },
  portalHealthLookup: {
    findPortalHealthNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  monthlyResultFacts: {
    findMonthlyResultNotificationFacts: vi.fn().mockResolvedValue(null),
    findMonthlyResultRevisionNotificationFacts: vi.fn().mockResolvedValue(null),
  },
  organizationAccountAuthority: {
    isAffectedRecipient: vi.fn().mockResolvedValue(false),
  },
})

const authorize = (overrides: Partial<NotificationAudienceAuthorizationInput> = {}) => ({
  userId: RECIPIENT,
  organizationId: ORG,
  propertyId: PROPERTY,
  audience: { kind: 'account_admin' as const },
  ...overrides,
})

describe('notification audience authorization', () => {
  it('parses and revalidates an exact affected Organization account recipient', async () => {
    const deps = buildDeps()
    deps.organizationAccountAuthority.isAffectedRecipient.mockResolvedValue(true)
    const audience = {
      kind: 'affected_organization_user' as const,
      eventId: 'identity-event-1',
      eventType: 'identity.member.role_changed' as const,
    }

    expect(parseNotificationAudience(audience)).toEqual(audience)
    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ propertyId: null, audience }),
      ),
    ).resolves.toBe(true)
    expect(deps.organizationAccountAuthority.isAffectedRecipient).toHaveBeenCalledWith({
      eventId: 'identity-event-1',
      eventType: 'identity.member.role_changed',
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

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience: accountAudience }),
      ),
    ).resolves.toBe(false)
    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ propertyId: null, audience: { kind: 'account_admin' } }),
      ),
    ).resolves.toBe(false)
  })

  it('rejects unsupported or partial affected-user audience descriptors', () => {
    expect(
      parseNotificationAudience({
        kind: 'affected_organization_user',
        eventId: 'identity-event-1',
        eventType: 'identity.member.invited',
      }),
    ).toBeNull()
    expect(
      parseNotificationAudience({
        kind: 'affected_organization_user',
        eventId: '',
        eventType: 'identity.member.removed',
      }),
    ).toBeNull()
  })

  it('authorizes only a current manager for an explicitly owned scope', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    deps.userLookup.findByRole.mockResolvedValue([userId('admin-1')])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'portal', portalId: PORTAL },
          },
        }),
      ),
    ).resolves.toBe(true)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('authorizes a current AccountAdmin only when an owned scope has no eligible manager', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: PROPERTY },
          },
        }),
      ),
    ).resolves.toBe(true)
  })

  it('does not treat an AccountAdmin as fallback while a scoped manager exists', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.findForProperty.mockResolvedValue([userId('other-manager')])
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'responsible_scope',
            scope: { kind: 'property', propertyId: PROPERTY },
          },
        }),
      ),
    ).resolves.toBe(false)
    expect(deps.userLookup.findByRole).not.toHaveBeenCalled()
  })

  it('revalidates direct AccountAdmin recovery recipients', async () => {
    const deps = buildDeps()
    deps.userLookup.findByRole.mockResolvedValue([RECIPIENT])

    await expect(createNotificationAudienceAuthorizer(deps)(authorize())).resolves.toBe(
      true,
    )
  })

  it('revalidates a direct assignee or reply author against property eligibility', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience: { kind: 'property_operator' } }),
      ),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('rejects a replaced Inbox assignee even when the old assignee remains property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: null,
      assignedTo: userId('replacement-manager'),
      propertyName: 'Riverside Hotel',
      guestRating: null,
      sourceType: 'review',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM },
        }),
      ),
    ).resolves.toBe(false)
  })

  it('authorizes the current Inbox assignee only while they remain property-eligible', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: null,
      assignedTo: RECIPIENT,
      propertyName: 'Riverside Hotel',
      guestRating: null,
      sourceType: 'review',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: { kind: 'inbox_assignee', inboxItemId: INBOX_ITEM },
        }),
      ),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('authorizes a grouped assignment only while every item remains assigned in that Property', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts
      .mockResolvedValueOnce({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: RECIPIENT,
        propertyName: null,
        guestRating: null,
        sourceType: 'review',
        createdAt: new Date('2026-08-25T10:00:00Z'),
      })
      .mockResolvedValueOnce({
        propertyId: PROPERTY,
        portalId: null,
        assignedTo: userId('replacement-manager'),
        propertyName: null,
        guestRating: null,
        sourceType: 'review',
        createdAt: new Date('2026-08-25T10:00:00Z'),
      })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'bulk_inbox_assignee',
            inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM],
          },
        }),
      ),
    ).resolves.toBe(false)
    expect(deps.responsibleManagers.isEligibleForProperty).not.toHaveBeenCalled()
  })

  it('authorizes a grouped assignment when every item and Property permission are current', async () => {
    const deps = buildDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.inboxItemLookup.findInboxItemFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: null,
      assignedTo: RECIPIENT,
      propertyName: null,
      guestRating: null,
      sourceType: 'review',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    })

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'bulk_inbox_assignee',
            inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM],
          },
        }),
      ),
    ).resolves.toBe(true)
    expect(deps.inboxItemLookup.findInboxItemFacts).toHaveBeenCalledTimes(2)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      PROPERTY,
      RECIPIENT,
    )
  })

  it('parses a bounded unique grouped audience and rejects duplicates', () => {
    expect(
      parseNotificationAudience({
        kind: 'bulk_inbox_assignee',
        inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM],
      }),
    ).toEqual({
      kind: 'bulk_inbox_assignee',
      inboxItemIds: [INBOX_ITEM, SECOND_INBOX_ITEM],
    })
    expect(
      parseNotificationAudience({
        kind: 'bulk_inbox_assignee',
        inboxItemIds: [INBOX_ITEM, INBOX_ITEM],
      }),
    ).toBeNull()
  })

  it('authorizes a resolved-escalation recipient only for the exact current resolution authority', async () => {
    const deps = buildDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue({
      propertyId: PROPERTY,
      assignedTo: RECIPIENT,
      propertyName: 'Riverside Hotel',
      isEscalated: false,
      resolvedAt: new Date(RESOLVED_AT),
      resolvedBy: userId('resolver-1'),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)

    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({
          audience: {
            kind: 'escalation_resolution',
            inboxItemId: INBOX_ITEM,
            resolvedAt: RESOLVED_AT,
            resolvedBy: userId('resolver-1'),
          },
        }),
      ),
    ).resolves.toBe(true)
  })

  it('rejects a stale resolution after re-escalation or recipient eligibility loss', async () => {
    const deps = buildDeps()
    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue({
      propertyId: PROPERTY,
      assignedTo: RECIPIENT,
      propertyName: null,
      isEscalated: true,
      resolvedAt: new Date(RESOLVED_AT),
      resolvedBy: userId('resolver-1'),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    const input = authorize({
      audience: {
        kind: 'escalation_resolution',
        inboxItemId: INBOX_ITEM,
        resolvedAt: RESOLVED_AT,
        resolvedBy: userId('resolver-1'),
      },
    })

    await expect(createNotificationAudienceAuthorizer(deps)(input)).resolves.toBe(false)

    deps.escalationResolutions.findEscalationResolutionFacts.mockResolvedValue({
      propertyId: PROPERTY,
      assignedTo: RECIPIENT,
      propertyName: null,
      isEscalated: false,
      resolvedAt: new Date(RESOLVED_AT),
      resolvedBy: userId('resolver-1'),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)
    await expect(createNotificationAudienceAuthorizer(deps)(input)).resolves.toBe(false)
  })

  it('parses only a complete canonical escalation-resolution audience', () => {
    expect(
      parseNotificationAudience({
        kind: 'escalation_resolution',
        inboxItemId: INBOX_ITEM,
        resolvedAt: RESOLVED_AT,
        resolvedBy: 'resolver-1',
      }),
    ).toEqual({
      kind: 'escalation_resolution',
      inboxItemId: INBOX_ITEM,
      resolvedAt: RESOLVED_AT,
      resolvedBy: 'resolver-1',
    })
    expect(
      parseNotificationAudience({
        kind: 'escalation_resolution',
        inboxItemId: INBOX_ITEM,
        resolvedAt: 'not-a-date',
        resolvedBy: null,
      }),
    ).toBeNull()
  })

  it('revalidates an exact current Handling Cycle and current scoped responsibility at delivery', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'open',
    })
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'handling_cycle' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'feedback' as const,
      sourceId: 'feedback-source-1',
      cycleNumber: 2,
      sourceRevision: 4,
      stateRevision: 7,
      actorUserId: userId('another-manager'),
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)
    expect(deps.responsibleManagers.findForProperty).not.toHaveBeenCalled()

    deps.inboxItemLookup.findHandlingCycleNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: null,
      propertyName: null,
      guestRating: null,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 3,
      currentSourceRevision: 4,
      stateRevision: 8,
      status: 'open',
    })
    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
  })

  it('suppresses the Handling Cycle actor before any delivery-time authority lookup', async () => {
    const deps = buildDeps()
    const audience = {
      kind: 'handling_cycle' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'review' as const,
      sourceId: 'review-source-1',
      cycleNumber: 2,
      sourceRevision: 2,
      stateRevision: 3,
      actorUserId: RECIPIENT,
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
    expect(deps.inboxItemLookup.findHandlingCycleNotificationFacts).not.toHaveBeenCalled()
  })

  it('parses only a complete positive Handling Cycle audience', () => {
    const valid = {
      kind: 'handling_cycle',
      inboxItemId: INBOX_ITEM,
      sourceType: 'review',
      sourceId: 'review-source-1',
      cycleNumber: 2,
      sourceRevision: 2,
      stateRevision: 3,
      actorUserId: null,
    }
    expect(parseNotificationAudience(valid)).toEqual(valid)
    expect(parseNotificationAudience({ ...valid, stateRevision: 0 })).toBeNull()
    expect(parseNotificationAudience({ ...valid, sourceType: 'unknown' })).toBeNull()
    expect(parseNotificationAudience({ ...valid, actorUserId: '' })).toBeNull()
  })

  it('revalidates an exact active Response Target reminder and current responsibility', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: null,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'open',
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'response_target_reminder' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'feedback' as const,
      sourceId: 'feedback-source-1',
      cycleNumber: 2,
      sourceRevision: 4,
      stateRevision: 7,
      targetKind: 'private_feedback_handling' as const,
      reminderKind: 'halfway' as const,
      scheduledFor: TARGET_SCHEDULED_FOR,
    }

    expect(parseNotificationAudience(audience)).toEqual(audience)
    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)
    expect(
      deps.inboxItemLookup.findResponseTargetReminderNotificationFacts,
    ).toHaveBeenCalledWith({
      inboxItemId: INBOX_ITEM,
      organizationId: ORG,
      cycleNumber: 2,
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    expect(deps.responsibleManagers.findForPortal).toHaveBeenCalledWith(ORG, PORTAL)

    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue(
      null,
    )
    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
  })

  it('authorizes only the current eligible assignee for an assigned halfway reminder', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: RECIPIENT,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'open',
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.responsibleManagers.findForPortal.mockResolvedValue([RESPONSIBLE_MANAGER])
    const audience = {
      kind: 'response_target_reminder' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'feedback' as const,
      sourceId: 'feedback-source-1',
      cycleNumber: 2,
      sourceRevision: 4,
      stateRevision: 7,
      targetKind: 'private_feedback_handling' as const,
      reminderKind: 'halfway' as const,
      scheduledFor: TARGET_SCHEDULED_FOR,
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)
    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience, userId: RESPONSIBLE_MANAGER }),
      ),
    ).resolves.toBe(false)
    expect(deps.responsibleManagers.findForPortal).not.toHaveBeenCalled()
  })

  it('revalidates assignment changes before delivering a halfway reminder', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: REPLACEMENT_ASSIGNEE,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'open',
      targetKind: 'private_feedback_handling',
      reminderKind: 'halfway',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    const audience = {
      kind: 'response_target_reminder' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'feedback' as const,
      sourceId: 'feedback-source-1',
      cycleNumber: 2,
      sourceRevision: 4,
      stateRevision: 7,
      targetKind: 'private_feedback_handling' as const,
      reminderKind: 'halfway' as const,
      scheduledFor: TARGET_SCHEDULED_FOR,
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience, userId: REPLACEMENT_ASSIGNEE }),
      ),
    ).resolves.toBe(true)
  })

  it('authorizes both scoped responsibility and an eligible assignee for target-passed delivery', async () => {
    const deps = buildDeps()
    deps.inboxItemLookup.findResponseTargetReminderNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      portalId: PORTAL,
      assignedTo: RECIPIENT,
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      sourceType: 'feedback',
      sourceId: 'feedback-source-1',
      createdAt: new Date('2026-08-27T08:00:00.000Z'),
      currentCycleNumber: 2,
      currentSourceRevision: 4,
      stateRevision: 7,
      status: 'open',
      targetKind: 'private_feedback_handling',
      reminderKind: 'target_passed',
      scheduledFor: new Date(TARGET_SCHEDULED_FOR),
    })
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(true)
    deps.responsibleManagers.findForPortal.mockResolvedValue([RESPONSIBLE_MANAGER])
    const audience = {
      kind: 'response_target_reminder' as const,
      inboxItemId: INBOX_ITEM,
      sourceType: 'feedback' as const,
      sourceId: 'feedback-source-1',
      cycleNumber: 2,
      sourceRevision: 4,
      stateRevision: 7,
      targetKind: 'private_feedback_handling' as const,
      reminderKind: 'target_passed' as const,
      scheduledFor: TARGET_SCHEDULED_FOR,
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)
    await expect(
      createNotificationAudienceAuthorizer(deps)(
        authorize({ audience, userId: RESPONSIBLE_MANAGER }),
      ),
    ).resolves.toBe(true)
  })

  it('parses only a complete Response Target reminder audience', () => {
    const valid = {
      kind: 'response_target_reminder',
      inboxItemId: INBOX_ITEM,
      sourceType: 'review',
      sourceId: 'review-source-1',
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: 1,
      targetKind: 'google_review_response',
      reminderKind: 'target_passed',
      scheduledFor: TARGET_SCHEDULED_FOR,
    }
    expect(parseNotificationAudience(valid)).toEqual(valid)
    expect(parseNotificationAudience({ ...valid, cycleNumber: 0 })).toBeNull()
    expect(parseNotificationAudience({ ...valid, targetKind: 'unknown' })).toBeNull()
    expect(parseNotificationAudience({ ...valid, reminderKind: 'daily' })).toBeNull()
    expect(parseNotificationAudience({ ...valid, scheduledFor: 'not-a-date' })).toBeNull()
  })

  it('revalidates exact current Portal Health and responsibility at delivery', async () => {
    const deps = buildDeps()
    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      status: 'degraded',
      reason: 'google_destination_unavailable',
      sourceVersion: 'health-source-v3',
    })
    deps.responsibleManagers.findForPortal.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'portal_health' as const,
      portalId: PORTAL,
      status: 'degraded' as const,
      reason: 'google_destination_unavailable' as const,
      sourceVersion: 'health-source-v3',
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)

    deps.portalHealthLookup.findPortalHealthNotificationFacts.mockResolvedValue({
      propertyId: PROPERTY,
      status: 'healthy',
      reason: 'operational',
      sourceVersion: 'health-source-v4',
    })
    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
  })

  it('parses only actionable exact-state Portal Health audiences', () => {
    const valid = {
      kind: 'portal_health',
      portalId: PORTAL,
      status: 'unavailable',
      reason: 'public_address_unavailable',
      sourceVersion: 'health-source-v3',
    }
    expect(parseNotificationAudience(valid)).toEqual(valid)
    expect(parseNotificationAudience({ ...valid, status: 'healthy' })).toBeNull()
    expect(
      parseNotificationAudience({ ...valid, reason: 'publication_draft' }),
    ).toBeNull()
    expect(parseNotificationAudience({ ...valid, sourceVersion: '' })).toBeNull()
  })

  it('revalidates the exact current Goal result revision and responsibility', async () => {
    const deps = buildDeps()
    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue({
      programId: 'program-1',
      programVersionId: 'program-version-2',
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
      revisionId: 'revision-2',
      revision: 2,
      evaluationState: 'eligible',
      achieved: false,
      programName: 'Guest rating average',
      subject: { kind: 'property', propertyId: PROPERTY },
    })
    deps.responsibleManagers.findForProperty.mockResolvedValue([RECIPIENT])
    const audience = {
      kind: 'goal_result_revision' as const,
      programId: 'program-1',
      programVersionId: 'program-version-2',
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
      revisionId: 'revision-2',
      revision: 2,
      evaluationState: 'eligible' as const,
      achieved: false,
    }

    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(true)

    deps.monthlyResultFacts.findMonthlyResultRevisionNotificationFacts.mockResolvedValue(
      null,
    )
    await expect(
      createNotificationAudienceAuthorizer(deps)(authorize({ audience })),
    ).resolves.toBe(false)
  })

  it('parses only complete, internally consistent Goal revision audiences', () => {
    const valid = {
      kind: 'goal_result_revision',
      programId: 'program-1',
      programVersionId: 'program-version-2',
      assignmentId: 'assignment-1',
      monthlyResultId: 'monthly-result-1',
      revisionId: 'revision-2',
      revision: 2,
      evaluationState: 'unavailable',
      achieved: null,
    }

    expect(parseNotificationAudience(valid)).toEqual(valid)
    expect(parseNotificationAudience({ ...valid, revision: 0 })).toBeNull()
    expect(
      parseNotificationAudience({ ...valid, evaluationState: 'eligible' }),
    ).toBeNull()
    expect(parseNotificationAudience({ ...valid, revisionId: '' })).toBeNull()
  })
})
