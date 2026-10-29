import { createContext, use, type ReactNode } from 'react'
import type { GuestVoiceWindow } from '#/contexts/ai/application/public-api'

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
  /** Open an issue's drawer. */
  onOpenIssue: (issueId: string) => void
  /** "Not right?": the manager says an issue is wrong. Absent: the control is not drawn. */
  onNotRight?: (issueId: string) => void
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
