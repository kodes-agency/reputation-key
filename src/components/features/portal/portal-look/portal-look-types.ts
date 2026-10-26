// What a portal's own look is saved through, and which portal it is saved for.
// The route owns the three server functions (loaded when first used) and hands
// them to the editor as actions; the editor's blocks only call them.

import type { Action } from '#/components/hooks/use-action'
import type {
  PortalLookColoursInput,
  PortalLookIdentityInput,
  PortalLookPhotoInput,
  PortalLookSaved,
} from '#/contexts/portal/application/public-api'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'

/** The portal a look belongs to. The server checks the pair, so neither is trusted alone. */
export type PortalLookTarget = Readonly<{ propertyId: string; portalId: string }>

export type PortalLookActions = Readonly<{
  saveColours: Action<{ data: PortalLookColoursInput }, PortalLookSaved>
  saveIdentity: Action<{ data: PortalLookIdentityInput }, PortalLookSaved>
  savePhoto: Action<{ data: PortalLookPhotoInput }, PortalLookSaved>
  /** Sends an image to the media endpoint; the real upload unless a story hands in a stub. */
  uploadImage?: PortalImageUploader
}>
