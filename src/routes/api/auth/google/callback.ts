// Integration context — Google OAuth callback route
// TanStack Start API route that Google redirects to after user consent.
// Extracts code and state, then redirects to the import page.

import { createAPIFileRoute } from '@tanstack/react-start/api'
import { getEnv } from '#/shared/config/env'

export const APIRoute = createAPIFileRoute('/api/auth/google/callback')({
  GET: async ({ request }) => {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    // Handle user denial
    if (error === 'access_denied' || !code) {
      const env = getEnv()
      return new Response(null, {
        status: 302,
        headers: { Location: `${env.BETTER_AUTH_URL}/properties/import?error=denied` },
      })
    }

    // Parse state to get visibility preference
    let visibility: 'private' | 'organization' = 'private'
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString())
        visibility = parsed.visibility ?? 'private'
      } catch {
        // Invalid state, use default
      }
    }

    // Redirect to import page with code and visibility
    const env = getEnv()
    const importUrl = new URL('/properties/import', env.BETTER_AUTH_URL)
    importUrl.searchParams.set('code', code)
    importUrl.searchParams.set('visibility', visibility)

    return new Response(null, {
      status: 302,
      headers: { Location: importUrl.toString() },
    })
  },
})
