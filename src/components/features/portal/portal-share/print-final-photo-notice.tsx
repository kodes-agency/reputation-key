// The soft-photo notice under the final preview's face (final design spec §6.2,
// §11.7, the board share-desktop-dark): the floored resolution the photo prints
// at in the chosen orientation's box with its bleed, in two tiers, "may look
// soft" from 150 to 199 dpi and "will look soft" under 150, with the least photo
// that prints sharp and a way to change it. Advice, never a stop: the file is
// made either way, so it waits its turn to be read.

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { InlineLink } from '#/components/ui/inline-link'
import type { PrintFinalPhotoNotice as Notice } from '#/shared/domain/portal-print-final-how-to'

type Props = Readonly<{
  notice: Notice | null
  /** The property whose Photo and colours page changes the photo; absent: no link. */
  propertyId?: string
}>

export function PrintFinalPhotoNotice({ notice, propertyId }: Props) {
  if (notice === null) return null
  return (
    <Alert variant="warning" role="status">
      <AlertTitle className="line-clamp-none">{notice.title}</AlertTitle>
      <AlertDescription>
        <p>{notice.body}</p>
        {propertyId !== undefined && (
          <InlineLink
            to="/properties/$propertyId/portals/look"
            params={{ propertyId }}
            underline="always"
          >
            Change photo
          </InlineLink>
        )}
      </AlertDescription>
    </Alert>
  )
}
