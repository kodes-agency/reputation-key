import type { PermissionAuthorityContext } from '#/shared/domain/permissions'

export type GoalActor = Readonly<{
  organizationId: string
  userId: string
}> &
  PermissionAuthorityContext

/** Authorization port for Goal Program commands. */
export type GoalExecutionPolicy = Readonly<{
  authorize(
    input: Readonly<{
      actor: GoalActor | 'system'
      organizationId: string
      propertyId: string
      action: 'goal.read' | 'goal.create' | 'goal.update' | 'goal.cancel'
    }>,
  ): Promise<void>
}>
