import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { getContainer } from '#/composition'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { headersFromContext } from '#/shared/auth/headers'

export const Route = createFileRoute('/api/portals/$id/qr')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        const { db } = getContainer()
        const { portals } = await import('#/shared/db/schema/portal.schema')
        const { eq, and } = await import('drizzle-orm')
        const portal = await db
          .select()
          .from(portals)
          .where(
            and(
              eq(portals.id, params.id),
              eq(portals.organizationId, ctx.organizationId),
            ),
          )
          .limit(1)

        if (portal.length === 0) {
          return new Response('Portal not found', { status: 404 })
        }

        const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
        const portalUrl = `${baseUrl}/p/${ctx.organizationId}/${portal[0].slug}?source=qr`

        const pngBuffer = await QRCode.toBuffer(portalUrl, {
          type: 'png',
          width: 300,
          margin: 2,
        })

        return new Response(pngBuffer as unknown as BodyInit, {
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="qr-${portal[0].slug}.png"`,
          },
        })
      },
    },
  },
})
