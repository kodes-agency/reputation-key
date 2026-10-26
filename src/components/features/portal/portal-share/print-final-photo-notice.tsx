// The soft-photo notice under the final preview's face (final design spec §6.2,
// §11.7, the board share-desktop-dark): the floored resolution the photo prints
// at in the chosen orientation's box with its bleed, in two tiers, "may look
// soft" from 150 to 199 dpi and "will look soft" under 150, with the least photo
// that prints sharp and a way to change it. Advice, never a stop: the file is
// made either way, so it waits its turn to be read.
//
// The photo is the portal's: it takes the property's unless an Account Admin gave
// the portal its own (ADR 0070). Either way it is changed in the portal's Look
// section, which says which it is and leads on to the property look.

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { InlineLink } from '#/components/ui/inline-link'
import type { PrintFinalPhotoNotice as Notice } from '#/shared/domain/portal-print-final-how-to'

type Props = Readonly<{
  notice: Notice | null
  /** The portal whose Look section changes the photo, with its property; absent: no link. */
  propertyId?: string
  portalId?: string
}>

export function PrintFinalPhotoNotice({ notice, propertyId, portalId }: Props) {
  if (notice === null) return null
  return (
    <Alert variant="warning" role="status">
      <AlertTitle className="line-clamp-none">{notice.title}</AlertTitle>
      <AlertDescription>
        <p>{notice.body}</p>
        {propertyId !== undefined && portalId !== undefined && (
          <InlineLink
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId }}
            search={{ tab: 'page', section: 'look' }}
            underline="always"
          >
            Change photo
          </InlineLink>
        )}
      </AlertDescription>
    </Alert>
  )
}
