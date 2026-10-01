import { createFileRoute } from '@tanstack/react-router'
import { handlePortalMediaUpload } from '#/contexts/portal/server/portal-media-upload'

// POST the raw bytes of one image; see the handler for the contract. The body
// limit for this exact path is set in server/plugins/request-guard.ts.
export const Route = createFileRoute('/api/portal-media')({
  server: {
    handlers: {
      POST: ({ request }) => handlePortalMediaUpload(request),
    },
  },
})
