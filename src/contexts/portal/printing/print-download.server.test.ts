import { expect, it } from 'vitest'
import { printKitDownloadOf } from './print-download.server'

it('serializes PDF bytes without changing the file name or type', () => {
  const file = {
    fileName: 'portal.pdf',
    contentType: 'application/pdf' as const,
    pdf: new Uint8Array([0, 127, 255]),
  }
  const download = printKitDownloadOf(file)
  expect(download).toEqual({
    fileName: file.fileName,
    contentType: file.contentType,
    pdfBase64: 'AH//',
  })
  expect(Buffer.from(download.pdfBase64, 'base64')).toEqual(Buffer.from(file.pdf))
})
