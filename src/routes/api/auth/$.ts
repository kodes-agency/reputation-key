import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '#/shared/auth/auth'
import { getContainer } from '#/composition'

async function rateLimitedHandler({ request }: { request: Request }) {
  // Rate limit auth POST endpoints (sign-in, sign-up, forget-password, reset-password)
  // to prevent brute-force and credential stuffing via better-auth native endpoints.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { rateLimiter } = getContainer()
  const rlResult = await rateLimiter.check(`auth:native:${ip}`)
  if (!rlResult.allowed) {
    return new Response(
      JSON.stringify({ message: 'Too many requests. Please try again later.' }),
      {
        status: 429,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  return getAuth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => getAuth().handler(request),
      POST: rateLimitedHandler,
    },
  },
})
