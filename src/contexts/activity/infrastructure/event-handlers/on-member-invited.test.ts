import { describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import { onMemberInvited } from './on-member-invited'

describe('onMemberInvited', () => {
  it('records the invitation fact without copying the invitee email', async () => {
    const add = vi.fn(async () => undefined)
    const queue = { add } as unknown as Queue

    await onMemberInvited({ queue })({
      _tag: 'identity.member.invited',
      eventId: 'event-1',
      organizationId: organizationId('organization-1'),
      userId: userId('00000000-0000-4000-8000-000000000001'),
      role: 'PropertyManager',
      invitationId: invitationId('invitation-1'),
      occurredAt: new Date('2026-08-26T00:00:00.000Z'),
      correlationId: null,
    })

    expect(add).toHaveBeenCalledWith(
      'project-recent-activity',
      expect.objectContaining({
        resourceId: 'invitation-1',
        payload: {
          subject: 'member',
          from: null,
          to: 'PropertyManager',
          detail: null,
        },
      }),
    )
    expect(JSON.stringify(add.mock.calls)).not.toContain('@')
  })
})
