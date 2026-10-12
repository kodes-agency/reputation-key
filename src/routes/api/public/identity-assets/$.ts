import { createFileRoute } from '@tanstack/react-router'
import { handleIdentityAssetServe } from '#/contexts/identity/server/identity-asset-serve'

// GET one stored avatar or organization logo by its object key; see the handler
// for the contract. The splat is the key (avatars/<user>/<id> or
// organizations/<org>/logo/<id>).
export const Route = createFileRoute('/api/public/identity-assets/$')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleIdentityAssetServe(request, params._splat ?? ''),
    },
  },
})
