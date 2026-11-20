// A picture opened once and drawn on every page that shows it.
//
// A table tent shows the same photo on both of its panels. Handed the bytes
// twice, PDFKit embeds them twice; handed an opened image, it embeds one copy
// and references it. Its typings leave `openImage` out, so the one call that
// needs it is wrapped here, and nothing else in the print kit reaches past the
// typings.

declare const openedImageBrand: unique symbol

export type OpenedImage = Readonly<{
  [openedImageBrand]: true
  width: number
  height: number
}>

type ImageOpener = (source: Buffer) => OpenedImage

export function openImage(doc: PDFKit.PDFDocument, bytes: Buffer): OpenedImage {
  const opener: unknown = Reflect.get(doc, 'openImage')
  if (typeof opener !== 'function') {
    throw new Error('This PDFKit cannot open an image ahead of drawing it')
  }
  return (opener as ImageOpener).call(doc, bytes)
}

export function drawImage(
  doc: PDFKit.PDFDocument,
  image: OpenedImage,
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  // PDFKit takes an opened image anywhere it takes bytes; the typings only say bytes.
  doc.image(image as unknown as Buffer, box.x, box.y, {
    width: box.width,
    height: box.height,
  })
}
