/** Null organization identifies own-account reads outside the manager workspace. */
export type TenantScope = Readonly<{
  userId: string
  organizationId: string | null
}>

export function tenantScope(
  context: Readonly<{
    user: Readonly<{ id: string }>
    activeOrganization?: Readonly<{ id: string }> | null
  }>,
): TenantScope {
  return {
    userId: context.user.id,
    organizationId: context.activeOrganization?.id ?? null,
  }
}
