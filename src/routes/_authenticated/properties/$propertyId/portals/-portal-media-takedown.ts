// The photograph dialog's "Take this photo down", offered only to who may use it:
// an Account Admin (`portal.admin`) on a Property whose Portals writes are on.
// The server function refuses anyone else, so this keeps the button from being
// drawn for a reader who would only be refused.
import { takeDownPortalMedia } from '#/contexts/portal/server/portal-media-takedown'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'

export type TakeDownImage = (assetId: string) => Promise<unknown>

const takeDownImage: TakeDownImage = (assetId) =>
  takeDownPortalMedia({ data: { assetId } })

/** Undefined when the reader may not take a photograph down: the dialog then draws no button. */
export function useTakeDownImage(): TakeDownImage | undefined {
  const { can: canDo } = usePermissions()
  const { has } = useCapabilities()
  return canDo('portal.admin') && has('portal.write') ? takeDownImage : undefined
}
