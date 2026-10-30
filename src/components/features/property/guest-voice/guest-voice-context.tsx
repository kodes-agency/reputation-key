import { createContext, use, type ReactNode } from 'react'
import type {
  GuestVoiceWindow,
  GuestVoiceDetailTarget,
} from '#/contexts/ai/application/public-api'

/**
 * What every part of the page shares: which property and which days it is about, and what
 * pressing an issue does. The sections read it instead of being handed the same five
 * props through four levels.
 */
type GuestVoiceContextValue = Readonly<{
  propertyId: string
  window: GuestVoiceWindow
  startLocalDate: string
  endLocalDate: string
  /** The URL-backed detail host owns opening all three target kinds. */
  onOpenDetail?: (target: GuestVoiceDetailTarget) => void
}>

const GuestVoiceContext = createContext<GuestVoiceContextValue | null>(null)

export function GuestVoiceProvider({
  value,
  children,
}: Readonly<{ value: GuestVoiceContextValue; children: ReactNode }>) {
  return <GuestVoiceContext value={value}>{children}</GuestVoiceContext>
}

export function useGuestVoice(): GuestVoiceContextValue {
  const value = use(GuestVoiceContext)
  if (value === null)
    throw new Error('Guest voice parts are drawn inside GuestVoiceProvider')
  return value
}
