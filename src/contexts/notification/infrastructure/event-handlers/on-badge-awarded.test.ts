// Notification context — on-badge-awarded event handler tests

import { describe, it, expect, beforeEach } from 'vitest'
import { onBadgeAwarded } from './on-badge-awarded'
import { createEventHandlerDeps, type FakeEventHandlerDeps } from './test-fixtures'
import type { BadgeAwarded } from '#/contexts/badge/application/public-api'
import {
  organizationId,
  propertyId,
  portalId,
  portalGroupId,
  badgeId,
} from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const PORTAL_ID = portalId('portal-1')
const BADGE_DEF_ID = badgeId('badge-def-1')
const NOW = new Date('2026-06-01T12:00:00Z')

function makeEvent(overrides?: Partial<BadgeAwarded>): BadgeAwarded {
  return {
    _tag: 'badge.awarded',
    eventId: 'evt-badge-1',
    correlationId: null,
    occurredAt: NOW,
    badgeDefinitionId: BADGE_DEF_ID,
    criteriaVersion: 1,
    targetType: 'portal',
    targetId: PORTAL_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    awardedAt: NOW,
    ...overrides,
  }
}

const payloadOf = (data: unknown): Record<string, unknown> =>
  (data as { payload: Record<string, unknown> }).payload

describe('onBadgeAwarded (notification)', () => {
  let deps: FakeEventHandlerDeps

  beforeEach(() => {
    deps = createEventHandlerDeps()
    deps.userLookup.findAssignedManagers.mockResolvedValue(['manager-1', 'manager-2'])
  })

  it('enqueues one notification job per assigned manager', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.addMock).toHaveBeenCalledTimes(2)
    for (const job of deps.jobs) {
      expect(job.name).toBe(INSERT_NOTIFICATION_JOB_NAME)
      const data = job.data as Record<string, unknown>
      expect(data.type).toBe('badge.awarded')
      expect(data.resourceType).toBe('badge')
      expect(data.resourceId).toBe(BADGE_DEF_ID)
      expect(data.userId).toBeTruthy()
      expect(data.organizationId).toBe(ORG_ID)
    }
  })

  it('carries the badge and recipient NAMES, never the definition id', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    // Was: body 'Badge definition: <uuid>'.
    expect(payloadOf(deps.jobs[0]!.data)).toEqual({
      targetKind: 'portal',
      badgeName: 'Fast Responder',
      recipientName: 'Front desk',
    })
    expect(JSON.stringify(payloadOf(deps.jobs[0]!.data))).not.toContain(BADGE_DEF_ID)
  })

  it('resolves the award target from the event targetType', async () => {
    const groupId = portalGroupId('group-1')
    await onBadgeAwarded(deps)(
      makeEvent({ targetType: 'portal_group', targetId: groupId }),
    )

    expect(deps.recognitionLookup.findBadgeFacts).toHaveBeenCalledWith({
      badgeDefinitionId: BADGE_DEF_ID,
      target: { kind: 'portal_group', id: groupId },
      orgId: ORG_ID,
    })
    expect(payloadOf(deps.jobs[0]!.data).targetKind).toBe('portal_group')
  })

  it('still notifies with the target kind when the lookup finds nothing', async () => {
    deps.recognitionLookup.findBadgeFacts.mockResolvedValue(null)

    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.jobs).toHaveLength(2)
    expect(payloadOf(deps.jobs[0]!.data)).toEqual({ targetKind: 'portal' })
  })

  it('queries managers by org and property', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.userLookup.findAssignedManagers).toHaveBeenCalledWith(ORG_ID, PROP_ID)
  })

  it('skips silently when no managers found', async () => {
    deps.userLookup.findAssignedManagers.mockResolvedValue([])

    await onBadgeAwarded(deps)(makeEvent())

    expect(deps.addMock).not.toHaveBeenCalled()
  })

  it('uses badge definition ID as resource ID', async () => {
    const customDefId = badgeId('custom-badge')
    await onBadgeAwarded(deps)(makeEvent({ badgeDefinitionId: customDefId }))

    const data = deps.jobs[0]!.data as Record<string, unknown>
    expect(data.resourceId).toBe(customDefId)
  })

  it('uses retry with exponential backoff', async () => {
    await onBadgeAwarded(deps)(makeEvent())

    const opts = deps.jobs[0]!.opts as Record<string, unknown>
    expect(opts.attempts).toBe(3)
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 30_000 })
  })
})
