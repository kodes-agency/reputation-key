import { createContext, useContext } from 'react'
import type { StaffMember } from './staff-account-view'
export type StaffAccounts = Readonly<{
  ready?: boolean
  propertyId: string
  members: readonly StaffMember[]
  colleagueListEnabled: boolean
  canInvite: boolean
  canRemove: boolean
  canSettings: boolean
  openAdd: (groupId?: string) => void
  refresh: () => Promise<unknown>
}>
export const StaffAccountsContext = createContext<StaffAccounts | null>(null)
export const useStaffAccounts = () => useContext(StaffAccountsContext)
