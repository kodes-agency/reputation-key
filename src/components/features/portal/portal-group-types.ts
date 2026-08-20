import type { Action } from '#/components/hooks/use-action'

export type PortalGroupView = Readonly<{
  id: string
  name: string
  portalIds: readonly string[]
}>

export type PortalOption = Readonly<{ id: string; name: string }>

export type PortalGroupMutations = Readonly<{
  createMutation: Action<{
    data: { propertyId: string; name: string; portalIds?: string[] }
  }>
  updateMutation: Action<{ data: { portalGroupId: string; name: string } }>
  deleteMutation: Action<{ data: { portalGroupId: string } }>
  addPortalMutation: Action<{
    data: { portalGroupId: string; portalId: string }
  }>
  removePortalMutation: Action<{
    data: { portalGroupId: string; portalId: string }
  }>
}>

export type PortalGroupManagementProps = Readonly<{
  propertyId: string
  groups: readonly PortalGroupView[]
  portals: readonly PortalOption[]
  state?: 'ready' | 'loading' | 'error'
  error?: unknown
  onRetry?: () => void
}> &
  PortalGroupMutations
