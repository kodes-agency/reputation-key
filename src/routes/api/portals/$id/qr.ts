import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { getPortalForQR } from '#/contexts/portal/server/portals'

export const Route = createFileRoute('/api/portals/$id/qr')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const result = await getPortalForQR({ data: { portalId: params.id } })

        if (!result) {
          return new Response('Portal not found', { status: 404 })
        }

        const { portalUrl, slug } = result

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
                  'Content-Disposition': `attachment; filename="qr-${slug}.png"`,
                }),
          },
        })
      },
    },
  },
})
