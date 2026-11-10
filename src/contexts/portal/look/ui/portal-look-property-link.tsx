// "the property look", in a sentence about what a portal follows: the way to the
// page where the look every portal starts with is edited.
import { InlineLink } from '#/components/ui/inline-link'

export function PropertyLookLink({ propertyId }: Readonly<{ propertyId: string }>) {
  return (
    <InlineLink
      to="/properties/$propertyId/portals/look"
      params={{ propertyId }}
      underline="always"
    >
      the property look
    </InlineLink>
  )
}
