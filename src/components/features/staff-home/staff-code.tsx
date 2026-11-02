import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PRINT_FINAL_COPY } from '#/shared/domain/portal-print-final-copy'
import { QR_INK, QR_PAPER } from '#/components/features/portal/portal-share/portal-qr'
import { usePortalQrPreview } from '#/components/features/portal/portal-share/use-portal-qr-preview'
import { Skeleton } from '#/components/ui/skeleton'
import { RetryButton } from '#/components/ui/region-error'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import { useScreenWakeLock } from './use-screen-wake-lock'
import type { StaffHomeFns } from './types'

export function StaffCodeTile({
  qr,
  wordingKey,
  propertyName,
}: Readonly<{
  qr: string
  wordingKey: keyof typeof PRINT_FINAL_COPY
  propertyName: string
}>) {
  const { qrDataUrl, generationError } = usePortalQrPreview(qr)
  if (generationError)
    return (
      <div className="space-y-3">
        <p>The code couldn’t be drawn.</p>
        <RetryButton onRetry={() => window.location.reload()} />
      </div>
    )
  return (
    <div
      className="w-full rounded-xl p-4 text-center"
      style={{ backgroundColor: QR_PAPER, color: QR_INK }}
    >
      <p className="text-xl font-semibold" lang={wordingKey}>
        {PRINT_FINAL_COPY[wordingKey].how_was_stay.headline}
      </p>
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="Code for guests to scan"
          className="aspect-square w-full"
        />
      ) : (
        <Skeleton className="aspect-square w-full" />
      )}
      <p className="break-words text-sm">{propertyName}</p>
    </div>
  )
}

export function StaffCode({
  participationId,
  propertyName,
  read,
}: Readonly<{
  participationId: string
  propertyName: string
  read: StaffHomeFns['getMyCode']
}>) {
  useScreenWakeLock()
  const code = useQuery({
    queryKey: staffSelfKeys.code(participationId),
    queryFn: () => read({ data: { participationId } }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: 'always',
  })
  const { refetch } = code
  useEffect(() => {
    const refresh = () => {
      void refetch({ cancelRefetch: false })
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refetch])
  // A refresh never leaves an old, possibly replaced symbol on screen.
  if (code.isFetching || code.isPending)
    return <Skeleton className="aspect-square w-full" />
  if (code.isError)
    return (
      <div className="space-y-3">
        <p>{actionErrorMessage(code.error)}</p>
        <RetryButton onRetry={() => void code.refetch()} />
      </div>
    )
  return <StaffCodeView code={code.data} propertyName={propertyName} />
}

export function StaffCodeView({
  code,
  propertyName,
}: Readonly<{
  code: Awaited<ReturnType<StaffHomeFns['getMyCode']>>
  propertyName: string
}>) {
  if (code.state === 'paused')
    return <p className="text-sm">Your code is paused. Ask your manager.</p>
  return (
    <StaffCodeTile
      qr={code.qr}
      wordingKey={code.wordingKey}
      propertyName={propertyName}
    />
  )
}
