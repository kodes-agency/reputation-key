import { queryOptions } from '@tanstack/react-query'
import type {
  GuestVoiceDetailTarget,
  GuestVoiceWindowContext,
} from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { aiKeys, dashboardKeys } from '#/shared/queries/query-keys'
import { detailTargetKey } from '#/components/features/property/guest-voice/guest-voice-detail-navigation'
import { guestVoiceFns } from './-guest-voice-fns'

export const propertyGuestVoiceV2Query = (propertyId: string, range: GuestVoiceRange) =>
  queryOptions({
    queryKey: aiKeys.guestVoiceV2(propertyId, range),
    queryFn: () => guestVoiceFns.getGuestVoicePage({ data: { propertyId, range } }),
    staleTime: 60_000,
    retry: false,
  })
export const propertyGuestVoiceDetailQuery = (
  propertyId: string,
  range: GuestVoiceRange,
  context: GuestVoiceWindowContext,
  target: GuestVoiceDetailTarget,
) =>
  queryOptions({
    queryKey: aiKeys.guestVoiceV2(
      propertyId,
      'detail',
      range,
      context.startLocalDate,
      context.endLocalDate,
      detailTargetKey(target),
    ),
    queryFn: () =>
      guestVoiceFns.getGuestVoiceDetail({
        data: {
          propertyId,
          range: range === 'all' ? 'auto' : range,
          startLocalDate: context.startLocalDate,
          endLocalDate: context.endLocalDate,
          target,
        },
      }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
export const propertyGuestVoiceGoogleQuery = (propertyId: string) =>
  queryOptions({
    queryKey: dashboardKeys.property({ propertyId, view: 'google-numbers' }),
    queryFn: () => guestVoiceFns.getGuestVoiceGoogle({ data: { propertyId } }),
    staleTime: 30_000,
    retry: false,
  })
