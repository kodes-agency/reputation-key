// Saving the code as a file. The address exists only in memory, so a download
// that silently does nothing cannot be retried after a reload: report a failure
// instead of swallowing it.

import { useCallback, useState } from 'react'
import { qrDownloadFileName, renderQrPngDataUrl, renderQrSvg } from './portal-qr'
import type { QrFormat } from './portal-qr'

const OBJECT_URL_LIFETIME_MS = 10_000

/**
 * Detached anchors still activate in current browsers, but that is not
 * guaranteed, so the anchor is attached for the click.
 */
function saveFile(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function saveCode(address: string, portalName: string, format: QrFormat) {
  const fileName = qrDownloadFileName(portalName, format)
  if (format === 'png') {
    saveFile(await renderQrPngDataUrl(address), fileName)
    return
  }
  const svg = await renderQrSvg(address)
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  saveFile(objectUrl, fileName)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS)
}

export function usePortalCodeDownload(address: string | null, portalName: string) {
  const [status, setStatus] = useState<'idle' | 'working' | 'failed'>('idle')

  const download = useCallback(
    async (format: QrFormat) => {
      if (address === null) return
      setStatus('working')
      try {
        await saveCode(address, portalName, format)
        setStatus('idle')
      } catch {
        setStatus('failed')
      }
    },
    [address, portalName],
  )

  return { download, isWorking: status === 'working', failed: status === 'failed' }
}
