// Saving the code as a file. The address is in memory after a code is made or
// fetched again. When it is not, and the manager can have it again, the file is
// made from a fresh fetch (which the server records). A download that silently
// does nothing cannot be noticed, so a failure is reported, not swallowed.

import { useCallback, useState } from 'react'
import { qrDownloadFileName, renderQrPngDataUrl, renderQrSvg } from './portal-qr'
import type { QrFormat } from './portal-qr'
import { saveBlob, saveFile } from './save-file'

async function saveCode(address: string, portalName: string, format: QrFormat) {
  const fileName = qrDownloadFileName(portalName, format)
  if (format === 'png') {
    saveFile(await renderQrPngDataUrl(address), fileName)
    return
  }
  saveBlob(new Blob([await renderQrSvg(address)], { type: 'image/svg+xml' }), fileName)
}

/** Fetches the QR address again; null when it could not be (the tab says why). */
export type ResolveQrAddress = () => Promise<string | null>

export function usePortalCodeDownload(
  address: string | null,
  portalName: string,
  resolveAddress: ResolveQrAddress | null = null,
) {
  const [status, setStatus] = useState<'idle' | 'working' | 'failed'>('idle')

  const download = useCallback(
    async (format: QrFormat) => {
      setStatus('working')
      try {
        const target = address ?? (await resolveAddress?.()) ?? null
        // Nothing to save: the reveal failed and its own error says so.
        if (target === null) {
          setStatus('idle')
          return
        }
        await saveCode(target, portalName, format)
        setStatus('idle')
      } catch {
        setStatus('failed')
      }
    },
    [address, portalName, resolveAddress],
  )

  return { download, isWorking: status === 'working', failed: status === 'failed' }
}
