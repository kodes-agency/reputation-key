import { describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import type { RecentActivityPrivacyStore } from '../../ports/recent-activity-privacy-store.port'
import { redactRecentActivityActorLabels } from './redact-recent-activity-actor-labels'

const NOW = new Date('2026-08-28T14:00:00.000Z')

const fixture = () => {
  const store: RecentActivityPrivacyStore = {
    redactActorLabels: vi.fn(async () => ({ redacted: 2, remaining: false })),
  }
  return {
    store,
    redact: redactRecentActivityActorLabels({ store, clock: () => NOW }),
  }
}

describe('redactRecentActivityActorLabels', () => {
  it('passes exact tenant and subject scope with a bounded batch', async () => {
    const { store, redact } = fixture()

    await expect(
      redact({
        organizationId: organizationId('org-1'),
        actorSubjectId: userId('user-1'),
        limit: 999,
      }),
    ).resolves.toEqual({ redacted: 2, remaining: false })

    expect(store.redactActorLabels).toHaveBeenCalledWith({
      organizationId: organizationId('org-1'),
      actorSubjectId: userId('user-1'),
      redactedAt: NOW,
      expiresAt: new Date('2026-11-26T14:00:00.000Z'),
      limit: 100,
    })
  })

  it('rejects an empty subject before reaching storage', async () => {
    const { store, redact } = fixture()

    await expect(
      redact({
        organizationId: organizationId('org-1'),
        actorSubjectId: userId(''),
      }),
    ).rejects.toMatchObject({
      _tag: 'ActivityError',
      code: 'invalid_recent_activity_redaction_subject',
    })
    expect(store.redactActorLabels).not.toHaveBeenCalled()
  })
})
