// Saving the print kit as a PDF. The server makes the file (and records that the
// code's address was fetched, as "Download again" does); this decodes it and
// hands it to the browser. A failure is the mutation's own error, which the
// section shows under the button, so this resolves instead of throwing into a
// click handler.

import { useCallback } from 'react'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import type { PrintKitChoice } from '#/shared/domain/portal-print-kit'
import type { PortalPrintKitResources } from './portal-print-kit-types'
import { saveBlob } from './save-file'

type Input = Readonly<{
  portalId: string
  choice: PrintKitChoice | null
  downloadMutation: PortalPrintKitResources['downloadMutation'] | undefined
}>

/** The bytes of a base64 string. */
function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function usePrintKitDownload({ portalId, choice, downloadMutation }: Input) {
  const download = useCallback(async () => {
    if (choice === null || downloadMutation === undefined) return
    try {
      const file = await downloadMutation({
        data: {
          portalId,
          piece: choice.piece,
          languages: [...choice.languages],
          callToAction: choice.callToAction,
        },
      })
      saveBlob(
        new Blob([decodeBase64(file.pdfBase64)], { type: file.contentType }),
        file.fileName,
      )
    } catch {
      // The mutation holds the error; the section shows it.
    }
  }, [portalId, choice, downloadMutation])

  return {
    download,
    isWorking: downloadMutation?.isPending ?? false,
    errorMessage:
      downloadMutation?.error == null ? null : actionErrorMessage(downloadMutation.error),
  } as const
}
