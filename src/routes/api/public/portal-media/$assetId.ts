import { createFileRoute } from '@tanstack/react-router'
import { handlePortalMediaServe } from '#/contexts/portal/server/portal-media-serve'

// GET one stored Portal image by its asset id; see the handler for the contract.
export const Route = createFileRoute('/api/public/portal-media/$assetId')({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePortalMediaServe(request, params.assetId),
    },
  },
})
