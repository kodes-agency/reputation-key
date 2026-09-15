import { describe, expect, it } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  inboxCachePolicy,
  observeReplyPublication,
  polledReplyPublicationChanged,
} from './inbox-cache-policy'

// The change detection `useReplyPublicationChangeDetection` runs after every
// detail read: which transitions refresh the lists and queue counts (D8).

describe('polledReplyPublicationChanged', () => {
  const nowMs = Date.parse('2026-09-14T12:30:00.000Z')
  const sending = {
    status: 'approved',
    publicationState: 'sending',
    reconcileDueAt: null,
    updatedAt: new Date(nowMs - 1),
  }
  const checking = {
    status: 'publish_failed',
    publicationState: 'ambiguous',
    reconcileDueAt: new Date(nowMs + 60_000),
    updatedAt: new Date(nowMs - 1),
  }
  const observe = observeReplyPublication

  it('reports a status or publication-state change seen while polling', () => {
    expect(
      polledReplyPublicationChanged(
        observe('item-1', sending),
        observe('item-1', checking),
      ),
    ).toBe(true)
    expect(
      polledReplyPublicationChanged(
        observe('item-1', checking),
        observe('item-1', {
          ...checking,
          publicationState: 'terminal',
          reconcileDueAt: null,
        }),
      ),
    ).toBe(true)
    expect(
      polledReplyPublicationChanged(
        observe('item-1', sending),
        observe('item-1', { ...sending, publicationState: 'pending_observation' }),
      ),
    ).toBe(true)
  })

  it('ignores unchanged reads, first reads, selection changes and unpolled replies', () => {
    expect(
      polledReplyPublicationChanged(
        observe('item-1', checking),
        observe('item-1', checking),
      ),
    ).toBe(false)
    expect(polledReplyPublicationChanged(null, observe('item-1', checking))).toBe(false)
    expect(
      polledReplyPublicationChanged(
        observe('item-1', sending),
        observe('item-2', checking),
      ),
    ).toBe(false)
    expect(
      polledReplyPublicationChanged(
        observe('item-1', { ...sending, status: 'draft', publicationState: null }),
        observe('item-1', {
          ...sending,
          status: 'pending_approval',
          publicationState: null,
        }),
      ),
    ).toBe(false)
  })
})

describe('inboxCachePolicy.onPolledReplyChanged', () => {
  it('invalidates the lists and queue counts a moved reply makes stale', () => {
    const invalidated: Array<ReadonlyArray<unknown>> = []
    const qc = {
      invalidateQueries: (filters: { queryKey: ReadonlyArray<unknown> }) => {
        invalidated.push(filters.queryKey)
        return Promise.resolve()
      },
    } as unknown as QueryClient

    inboxCachePolicy.onPolledReplyChanged(qc)

    expect(invalidated).toEqual([inboxKeys.lists(), inboxKeys.counts()])
  })
})
