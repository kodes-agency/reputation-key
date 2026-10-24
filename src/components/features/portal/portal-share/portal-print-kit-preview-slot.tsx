// Where the print kit's preview sits: one preview, in one of two places. From
// `lg` it is a column beside the section; below it, the section holds it between
// the choices and the download, so a phone shows the print before the button
// that makes it. Both places are rendered from the same props and each decides
// for itself whether it is the one that shows, so exactly one preview mounts.

import { useIsBelowLarge } from '#/components/hooks/use-mobile'
import { PortalPrintKitPreview } from './portal-print-kit-preview'
import type { usePrintKit } from './use-print-kit'

type Props = Readonly<{
  where: 'column' | 'inline'
  printKit: ReturnType<typeof usePrintKit>
}>

export function PortalPrintKitPreviewSlot({ where, printKit }: Props) {
  const stacked = useIsBelowLarge()
  if ((where === 'inline') !== stacked) return null
  return (
    <PortalPrintKitPreview
      choice={printKit.choice}
      view={printKit.view}
      faces={printKit.faces}
      mode={printKit.mode}
      onModeChange={printKit.setMode}
      side={printKit.side}
      onSideChange={printKit.setSide}
      code={printKit.code}
      sample={printKit.sample}
      tile={printKit.tile}
      isError={printKit.isError}
      onRetry={printKit.retry}
      isRetrying={printKit.isRetrying}
      placement={where}
    />
  )
}
