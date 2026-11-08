import { createCanvas } from '@napi-rs/canvas'
import jsQR from 'jsqr'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Decode pixels from the completed PDF, independently of the QR encoder and layout. */
export async function decodePrintQr(pdf: Uint8Array): Promise<string | null> {
  const loading = getDocument({ data: pdf.slice(), useSystemFonts: false })
  try {
    const document = await loading.promise
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      intent: 'print',
    }).promise
    // Repeated symbols on office sheets can confuse a single-symbol locator.
    // Overlapping image windows isolate a complete code without using layout data.
    for (const divisions of [1, 2, 4]) {
      const width = Math.floor(canvas.width / divisions)
      const height = Math.floor(canvas.height / divisions)
      for (let row = 0; row <= 2 * (divisions - 1); row += 1) {
        for (let column = 0; column <= 2 * (divisions - 1); column += 1) {
          const pixels = context.getImageData(
            Math.floor((column * width) / 2),
            Math.floor((row * height) / 2),
            width,
            height,
          )
          const decoded = jsQR(pixels.data, pixels.width, pixels.height)
          if (decoded !== null) return decoded.data
        }
      }
    }
    return null
  } finally {
    await loading.destroy()
  }
}
