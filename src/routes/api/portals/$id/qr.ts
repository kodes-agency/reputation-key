import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { getContainer } from '#/composition'

export const Route = createFileRoute('/api/portals/$id/qr')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { db } = getContainer()
        const { portals } = await import('#/shared/db/schema/portal.schema')
        const { eq } = await import('drizzle-orm')
        const portal = await db
          .select()
          .from(portals)
          .where(eq(portals.id, params.id))
          .limit(1)

        if (portal.length === 0) {
          return new Response('Portal not found', { status: 404 })
        }

        const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

        // Look up org slug for public URL
        const { sql } = await import('drizzle-orm')
        const orgRow = await db.execute(
          sql`SELECT slug FROM "organization" WHERE id = ${portal[0].organizationId} LIMIT 1`,
        )
        const orgSlug =
          (orgRow.rows[0] as { slug: string } | undefined)?.slug ??
          portal[0].organizationId

        const portalUrl = `${baseUrl}/p/${orgSlug}/${portal[0].slug}?source=qr`

        const pngBuffer = await QRCode.toBuffer(portalUrl, {
          type: 'png',
          width: 300,
          margin: 2,
        })

        // Check if this is an inline request (img tag) or a download
        const acceptHeader = request.headers.get('accept') ?? ''
        const isInline = acceptHeader.includes('image/')

        return new Response(new Uint8Array(pngBuffer), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600',
            ...(isInline
              ? {}
              : {
                  'Content-Disposition': `attachment; filename="qr-${portal[0].slug}.png"`,
                }),
          },
        })
      },
    },
  },
})
