import { useEffect, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import type { GuestVoiceV2View } from '#/components/features/property/guest-voice/guest-voice-v2-body'
import type { GuestVoiceDetailNavigation } from '#/components/features/property/guest-voice/use-guest-voice-detail-navigation'
import type {
  GuestVoiceDetailTarget,
  GuestVoiceV2Read,
} from '#/contexts/ai/application/public-api'
import type { GuestVoiceRange } from '#/shared/dashboard-range'
import { propertyGuestVoiceDetailQuery } from './-guest-voice-queries'

export function GuestVoiceRouteDetails({
  propertyId,
  range,
  read,
  target,
  busy,
  navigation,
  refreshPage,
  children,
}: Readonly<{
  propertyId: string
  range: GuestVoiceRange
  read: GuestVoiceV2Read
  target: GuestVoiceDetailTarget | null
  busy: boolean
  navigation: GuestVoiceDetailNavigation
  refreshPage: () => Promise<unknown>
  children: (drawer: NonNullable<GuestVoiceV2View['drawer']>) => ReactNode
}>) {
  const context = read.status === 'ready' ? read : read.context
  const detail = useQuery({
    ...propertyGuestVoiceDetailQuery(
      propertyId,
      range,
      context,
      target ?? { kind: 'topic', topic: 'staff_service' },
    ),
    enabled: target !== null && !busy,
  })
  const { data } = detail
  const refreshedKey = useRef<string | null>(null)
  const requestKey = `${range}:${context.startLocalDate}:${context.endLocalDate}:${JSON.stringify(target)}`
  useEffect(() => {
    if (data?.status !== 'refresh_required' || refreshedKey.current === requestKey) return
    refreshedKey.current = requestKey
    // The refreshed page selects a new exact-bounds key; that settled key retries the target.
    void refreshPage()
  }, [data, requestKey, refreshPage])
  return children({
    target: busy ? null : target,
    onTargetChange: navigation.open,
    navigation,
    read: hasFailed(detail)
      ? {
          status: 'error',
          onRetry: () => void detail.refetch(),
          retrying: isRetrying(detail),
        }
      : (detail.data ?? { status: 'pending' }),
  })
}
