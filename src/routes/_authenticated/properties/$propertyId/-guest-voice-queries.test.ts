import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { aiKeys, dashboardKeys } from '#/shared/queries/query-keys'
import {
  propertyGuestVoiceDetailQuery,
  propertyGuestVoiceGoogleQuery,
} from './-guest-voice-queries'
const fns = vi.hoisted(() => ({
  detail: vi.fn(async () => ({ status: 'not_found' as const })),
  google: vi.fn(async () => null),
}))
vi.mock('./-guest-voice-fns', () => ({
  getGuestVoiceDetail: fns.detail,
  getGuestVoiceGoogle: fns.google,
  getGuestVoicePage: vi.fn(),
}))
const context = {
  window: '30d' as const,
  startLocalDate: '2026-10-01',
  endLocalDate: '2026-10-30',
  dataThroughLocalDate: '2026-10-30',
  provisional: false,
  basis: { textReviewCount: 12, starOnlyCount: 2, analysedTextReviewCount: 12 },
}
const target = {
  kind: 'issue' as const,
  issueId: '10000000-0000-4000-8000-000000000001',
  sense: 'praise' as const,
}
describe('detail query lifecycle', () => {
  it('sends exact page bounds and never caches live words after close', async () => {
    const client = new QueryClient()
    const query = propertyGuestVoiceDetailQuery('property', '30d', context, target)
    expect(query.staleTime).toBe(0)
    expect(query.gcTime).toBe(0)
    await client.fetchQuery(query)
    expect(fns.detail).toHaveBeenCalledWith({
      data: {
        propertyId: 'property',
        range: '30d',
        startLocalDate: context.startLocalDate,
        endLocalDate: context.endLocalDate,
        target,
      },
    })
    await client.invalidateQueries({ queryKey: aiKeys.guestVoiceV2Property('property') })
    expect(client.getQueryState(query.queryKey)?.isInvalidated).toBe(true)
    client.clear()
  })
  it('separates targets, senses, ranges and auto-window dates', () => {
    const key = propertyGuestVoiceDetailQuery(
      'property',
      'auto',
      context,
      target,
    ).queryKey
    expect(key).not.toEqual(
      propertyGuestVoiceDetailQuery('property', '30d', context, target).queryKey,
    )
    expect(key).not.toEqual(
      propertyGuestVoiceDetailQuery(
        'property',
        'auto',
        { ...context, endLocalDate: '2026-10-31' },
        target,
      ).queryKey,
    )
    expect(key).not.toEqual(
      propertyGuestVoiceDetailQuery('property', 'auto', context, {
        ...target,
        sense: 'complaint',
      }).queryKey,
    )
    expect(key.slice(0, 3)).toEqual(aiKeys.guestVoiceV2Property('property'))
  })
  it('keeps Google numbers independent from goal reads', async () => {
    const client = new QueryClient()
    const query = propertyGuestVoiceGoogleQuery('property')
    expect(query.queryKey).toEqual(dashboardKeys.googleNumbers('property'))
    await expect(client.fetchQuery(query)).resolves.toBeNull()
    expect(fns.google).toHaveBeenCalledWith({ data: { propertyId: 'property' } })
    client.clear()
  })
})
