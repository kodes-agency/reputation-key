// The portal's code as a picture: one place decides the quiet zone, the colours
// and the pixels per module, so the preview on screen and both downloads are the
// same symbol.
//
// `qrcode` is imported here only, and the import is dynamic: the symbol is drawn
// on demand (when a code has just been made or replaced), so the library stays
// out of the route's first load.

export const QR_QUIET_ZONE_MODULES = 4

/** Whole pixels per module keep the PNG's module edges sharp at any print size. */
export const PNG_PIXELS_PER_MODULE = 24
const PREVIEW_PIXELS_PER_MODULE = 6

// Near-black on near-white: enough contrast for a phone to read it in dim light,
// and the colours the modal this replaced already used.
// Exported because the tile the image sits on must be the same paper, in either
// colour scheme, or the quiet zone stops reading as white.
export const QR_INK = '#16151a'
export const QR_PAPER = '#faf9fc'
const COLORS = { dark: QR_INK, light: QR_PAPER } as const

export type QrFormat = 'png' | 'svg'

async function qrcode() {
  const module = await import('qrcode')
  return module.default
}

/** The code as a standalone SVG document, with its quiet zone drawn in. */
export async function renderQrSvg(
  address: string,
  quietZoneModules: number = QR_QUIET_ZONE_MODULES,
): Promise<string> {
  const QRCode = await qrcode()
  return QRCode.toString(address, {
    type: 'svg',
    margin: quietZoneModules,
    color: COLORS,
  })
}

type PngOptions = Readonly<{ pixelsPerModule?: number }>

/** The code as a PNG data URL; the download size unless told otherwise. */
export async function renderQrPngDataUrl(
  address: string,
  options: PngOptions = {},
): Promise<string> {
  const QRCode = await qrcode()
  return QRCode.toDataURL(address, {
    margin: QR_QUIET_ZONE_MODULES,
    scale: options.pixelsPerModule ?? PNG_PIXELS_PER_MODULE,
    color: COLORS,
  })
}

export function renderQrPreviewDataUrl(address: string): Promise<string> {
  return renderQrPngDataUrl(address, { pixelsPerModule: PREVIEW_PIXELS_PER_MODULE })
}

/** `pool-terrace-code.png`: the portal's name, made safe for a file system. */
export function qrDownloadFileName(portalName: string, format: QrFormat): string {
  const slug = portalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug === '' ? 'portal' : slug}-code.${format}`
}
