import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { portalError } from '../../domain/errors'

export type PersonalPortalLabelWriter = (
  input: Readonly<{
    organizationId: string
    portalIds: readonly string[]
    displayName: string
    at: Date
  }>,
  transaction: unknown,
) => Promise<void>

/** Joins Identity's name transaction; public wording and names never change here. */
export const renamePersonalPortalLabels =
  (deps: Readonly<{ write: PersonalPortalLabelWriter; clock: () => Date }>) =>
  async (
    input: Readonly<{ portalIds: readonly string[]; displayName: string }>,
    ctx: AuthContext,
    transaction: unknown,
  ) => {
    if (!canForContext(ctx, 'staff.invite'))
      throw portalError('forbidden', 'This account cannot rename staff')
    await deps.write(
      {
        organizationId: ctx.organizationId,
        portalIds: input.portalIds,
        displayName: input.displayName,
        at: deps.clock(),
      },
      transaction,
    )
  }
