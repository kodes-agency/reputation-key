import type { AuthContext } from '#/shared/domain/auth-context'

export type StaffPortalPlan = Readonly<{
  propertyId: string
  sourcePortalId?: string
  portalGroupId?: string
}>

/** Identity owns the operation; Portal owns each independently committed step. */
export type StaffPortalProvisioner = Readonly<{
  rename(
    input: Readonly<{ portalIds: readonly string[]; displayName: string }>,
    ctx: AuthContext,
    transaction: unknown,
  ): Promise<void>
  check(
    input: StaffPortalPlan,
    ctx: AuthContext,
  ): Promise<
    Readonly<{ omittedLinks: readonly Readonly<{ id: string; label: string }>[] }>
  >
  create(
    input: StaffPortalPlan & Readonly<{ portalId: string; displayName: string }>,
    ctx: AuthContext,
  ): Promise<void>
  issueCode(portalId: string, ctx: AuthContext): Promise<void>
  publish(portalId: string, ctx: AuthContext): Promise<void>
  archive(portalId: string, ctx: AuthContext): Promise<void>
}>
