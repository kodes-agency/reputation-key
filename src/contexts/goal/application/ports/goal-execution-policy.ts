import type { PermissionAuthorityContext } from '#/shared/domain/permissions'

export type GoalActor = Readonly<{
  organizationId: string
  userId: string
}> &
  PermissionAuthorityContext

/** Shared authorization port for canonical and retained Goal commands. */
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
