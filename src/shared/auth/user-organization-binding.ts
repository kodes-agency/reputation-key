export type UserOrganizationBinding = Readonly<{
  userId: string
  organizationId: string | null
  state: 'active' | 'support_resolution' | 'released'
  version: number
}>

export type UserOrganizationBindingState = UserOrganizationBinding['state']

export type UserOrganizationBindingDecision =
  | Readonly<{ kind: 'allow'; version: number }>
  | Readonly<{
      kind: 'deny'
      reason:
        | 'organization_binding_missing'
        | 'organization_binding_unresolved'
        | 'organization_binding_released'
        | 'organization_binding_mismatch'
    }>

export function decideUserOrganizationBinding(
  binding: UserOrganizationBinding | null,
  activeOrganizationId: string,
): UserOrganizationBindingDecision {
  if (!binding) return { kind: 'deny', reason: 'organization_binding_missing' }
  if (binding.state === 'support_resolution') {
    return { kind: 'deny', reason: 'organization_binding_unresolved' }
  }
  if (binding.state === 'released') {
    return { kind: 'deny', reason: 'organization_binding_released' }
  }
  if (binding.organizationId !== activeOrganizationId) {
    return { kind: 'deny', reason: 'organization_binding_mismatch' }
  }
  return { kind: 'allow', version: binding.version }
}
