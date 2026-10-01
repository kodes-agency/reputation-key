// The old New portal page. Creating a portal is a dialog on the Portals page
// now (docs/design/portal-experience/round-4-admin, board 3); this address stays
// so bookmarks and links keep working, and lands on the page with the dialog open.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/properties/$propertyId/portals',
      params: { propertyId: params.propertyId },
      search: { new: true },
      replace: true,
    })
  },
})
