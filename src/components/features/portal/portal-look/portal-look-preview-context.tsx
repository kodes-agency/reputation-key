// The way from a look edit in the Look section to the phone beside it. The editor
// holds the edits in flight and hands the phone their sum; the section, which
// knows nothing of the phone, only sets and clears its own slot. Outside an editor
// (a story of one control, a test) the setter does nothing.
import { createContext, use, useCallback, useEffect, type ReactNode } from 'react'
import type { BrandPatch, BrandPatchKey } from './portal-look-preview-patch'

export type SetBrandPatch = (key: BrandPatchKey, patch: BrandPatch | null) => void

const PortalLookPreviewContext = createContext<SetBrandPatch>(() => undefined)

export function PortalLookPreviewProvider({
  setBrandPatch,
  children,
}: Readonly<{ setBrandPatch: SetBrandPatch; children: ReactNode }>) {
  return (
    <PortalLookPreviewContext value={setBrandPatch}>{children}</PortalLookPreviewContext>
  )
}

/**
 * One slot of the phone's edits. `set` lays an edit over the phone (null takes it
 * off, for a value the page cannot draw yet); the slot is emptied when the control
 * goes away, so a group given back to the property is shown as the property's.
 */
export function usePortalLookPreviewPatch(key: BrandPatchKey) {
  const setBrandPatch = use(PortalLookPreviewContext)
  useEffect(() => () => setBrandPatch(key, null), [setBrandPatch, key])
  return useCallback(
    (patch: BrandPatch | null) => setBrandPatch(key, patch),
    [setBrandPatch, key],
  )
}
