import { usePortalQrPreview } from '#/components/features/portal/portal-share/use-portal-qr-preview'
import { Skeleton } from '#/components/ui/skeleton'
import { RetryButton } from '#/components/ui/region-error'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { useStaffCode } from './use-staff-code'
import { useScreenWakeLock } from './use-screen-wake-lock'
import { StaffPass } from './staff-pass'
import type { StaffHomeFns, StaffParticipation } from './types'

type Look = StaffParticipation['look']
type LiveCode = Extract<Awaited<ReturnType<StaffHomeFns['getMyCode']>>, { state: 'live' }>

const PAUSED = 'Your code is paused. Ask your manager.'

function PassNote({
  look,
  name,
  children,
}: Readonly<{ look: Look; name: string; children: React.ReactNode }>) {
  return (
    <div className="staff-code">
      <StaffPass look={look} name={name}>
        <div className="staff-pass__note">{children}</div>
      </StaffPass>
    </div>
  )
}

/** The card at its final size, so nothing jumps when the code arrives. */
function PassLoading({ look, name }: Readonly<{ look: Look; name: string }>) {
  return (
    <div className="staff-code">
      <StaffPass look={look} name={name} cue={'\u00a0'}>
        <div className="staff-pass__words">
          <Skeleton className="staff-pass__bone" />
          <Skeleton className="staff-pass__bone" data-short />
        </div>
        <div className="staff-pass__slot">
          <Skeleton className="staff-pass__code" />
        </div>
      </StaffPass>
    </div>
  )
}

export function StaffCodeTile({
  code,
  look,
  name,
}: Readonly<{ code: LiveCode & { preview?: string }; look: Look; name: string }>) {
  const { qrDataUrl, generationError } = usePortalQrPreview(code.preview ? null : code.qr)
  if (generationError)
    return (
      <PassNote look={look} name={name}>
        <p className="mb-3">The code couldn’t be drawn.</p>
        <RetryButton onRetry={() => window.location.reload()} />
      </PassNote>
    )
  const picture = code.preview ?? qrDataUrl
  return (
    <div className="staff-code">
      <StaffPass look={look} name={name} cue={code.cue} lang={code.wordingKey}>
        <div className="staff-pass__words" lang={code.wordingKey}>
          <p className="staff-pass__headline">{code.headline}</p>
          {code.subline ? <p className="staff-pass__sub">{code.subline}</p> : null}
        </div>
        <div className="staff-pass__slot">
          {picture ? (
            <img
              className="staff-pass__code"
              src={picture}
              alt="Code for guests to scan"
            />
          ) : (
            <Skeleton className="staff-pass__code" />
          )}
        </div>
      </StaffPass>
    </div>
  )
}

export function StaffCode({
  participationId,
  look,
  name,
  read,
  paused = false,
}: Readonly<{
  participationId: string
  look: Look
  name: string
  read: StaffHomeFns['getMyCode']
  paused?: boolean
}>) {
  useScreenWakeLock()
  const code = useStaffCode(read, participationId, paused)
  if (paused)
    return (
      <PassNote look={look} name={name}>
        {PAUSED}
      </PassNote>
    )
  if (code.isPending) return <PassLoading look={look} name={name} />
  if (code.isError && !code.data)
    return (
      <PassNote look={look} name={name}>
        <p className="mb-3">{actionErrorMessage(code.error)}</p>
        <RetryButton onRetry={() => void code.refetch()} />
      </PassNote>
    )
  return code.data ? <StaffCodeView code={code.data} look={look} name={name} /> : null
}

export function StaffCodeView({
  code,
  look,
  name,
}: Readonly<{
  code: Awaited<ReturnType<StaffHomeFns['getMyCode']>> & { preview?: string }
  look: Look
  name: string
}>) {
  if (code.state === 'paused')
    return (
      <PassNote look={look} name={name}>
        {PAUSED}
      </PassNote>
    )
  return <StaffCodeTile code={code} look={look} name={name} />
}
