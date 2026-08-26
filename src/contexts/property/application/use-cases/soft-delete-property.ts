// Property context — legacy destructive Property deletion containment

import type { AuthContext } from '#/shared/domain/auth-context'
import { PROPERTY_DELETION_UNAVAILABLE_MESSAGE, propertyError } from '../../domain/errors'

export type DeletePropertyInput = Readonly<{
  propertyId: string
}>

export const deleteProperty =
  () =>
  async (_input: DeletePropertyInput, _ctx: AuthContext): Promise<void> => {
    // LIF-01 containment. Ordinary Property lifecycle must become recoverable
    // Archive/Disconnect, while permanent erasure must be a distinct,
    // support-mediated operation with its own verification and evidence.
    // Neither boundary exists yet, so this legacy product use case has no
    // destructive dependencies and always refuses before any effect.
    throw propertyError('forbidden', PROPERTY_DELETION_UNAVAILABLE_MESSAGE)
  }

export type DeletePropertyUseCase = ReturnType<typeof deleteProperty>
