import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'staff-active-property-id'

function getSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(STORAGE_KEY)
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/**
 * Read the active property ID for staff from localStorage.
 * Used by StaffSidebar for property-aware navigation.
 * Returns null when no property is selected (e.g., first load before default is set).
 */
export function useStaffPropertyId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Persist the active property ID to localStorage for staff.
 * Called when the user switches properties in the sidebar dropdown.
 */
export function setStaffPropertyId(propertyId: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, propertyId)
  // Dispatch storage event so useSyncExternalStore subscribers in the same tab update
  window.dispatchEvent(
    new StorageEvent('storage', { key: STORAGE_KEY, newValue: propertyId }),
  )
}
