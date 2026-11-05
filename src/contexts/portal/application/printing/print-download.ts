export type PrintKitPhoto = Readonly<{
  bytes: Uint8Array
  focalX: number
  focalY: number
}>

export type PortalPrintKitFile = Readonly<{
  fileName: string
  contentType: 'application/pdf'
  pdf: Uint8Array
}>

/** What the server function answers: a server function speaks JSON, so the file is base64. */
export type PortalPrintKitDownload = Readonly<{
  fileName: string
  contentType: 'application/pdf'
  pdfBase64: string
}>
