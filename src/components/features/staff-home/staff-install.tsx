import { useEffect, useState, useRef } from 'react'
import { Share, SquarePlus } from 'lucide-react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Button } from '#/components/ui/button'

export const STAFF_INSTALL_SEEN = 'repkey:staff-install-seen'
/** Later than this after opening, the step would take the screen from a guest who is scanning. */
const INSTALL_OFFER_WINDOW_MS = 5_000
type InstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}
export type InstallKind = 'iphone' | 'android' | null

export function staffInstallKind(userAgent: string, standalone: boolean): InstallKind {
  if (standalone) return null
  return /iPhone/iu.test(userAgent) &&
    /Version\//iu.test(userAgent) &&
    /Safari\//iu.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS/iu.test(userAgent)
    ? 'iphone'
    : null
}

export function StaffInstallContent({
  kind,
  pending = false,
  onInstall,
  onSkip,
  onShown,
  error,
}: Readonly<{
  kind: Exclude<InstallKind, null>
  pending?: boolean
  onInstall: () => void
  onSkip: () => void
  onShown?: () => void
  error?: unknown
}>) {
  useEffect(() => {
    onShown?.()
  }, [onShown])
  return (
    <section className="staff-step staff-step--center">
      <div className="staff-step__app">
        <img src="/icons/apple-touch-icon.png" alt="" width={180} height={180} />
        My code
      </div>
      <h1 className="staff-step__title">Keep your code one tap away</h1>
      {kind === 'iphone' ? (
        <ol className="staff-step__steps">
          <li>
            <span className="staff-step__num">1</span>
            <span>
              Tap <Share aria-label="Share" /> at the bottom of Safari
            </span>
          </li>
          <li>
            <span className="staff-step__num">2</span>
            <span>
              Tap <SquarePlus aria-hidden="true" /> Add to Home Screen
            </span>
          </li>
        </ol>
      ) : (
        <div className="m-auto" />
      )}
      <div className="staff-step__foot">
        <FormErrorBanner error={error} />
        {kind === 'iphone' ? (
          <Button onClick={onSkip}>Done</Button>
        ) : (
          <Button pending={pending} pendingLabel="Opening…" onClick={onInstall}>
            Install
          </Button>
        )}
        {kind === 'iphone' ? null : (
          <Button variant="ghost" onClick={onSkip}>
            Not now
          </Button>
        )}
      </div>
    </section>
  )
}

/** Device memory only; a new phone offers the step again. Off inside the manager shell. */
export function useStaffInstall(enabled = true) {
  const dismissed = useRef(false)
  const [error, setError] = useState<unknown>(null)
  const [kind, setKind] = useState<InstallKind>(null)
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const installed =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Reflect.get(navigator, 'standalone') === true
    let seen = false
    try {
      seen = localStorage.getItem(STAFF_INSTALL_SEEN) === 'yes'
    } catch {
      /* Device storage can be disabled. */
    }
    if (installed || seen) return
    // Browser install support has no server value; read it once after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKind(staffInstallKind(navigator.userAgent, false))
    const openedAt = Date.now()
    const offered = (event: Event) => {
      if (dismissed.current || Date.now() - openedAt > INSTALL_OFFER_WINDOW_MS) return
      event.preventDefault()
      setPrompt(event as InstallPrompt)
      setKind('android')
    }
    window.addEventListener('beforeinstallprompt', offered)
    return () => window.removeEventListener('beforeinstallprompt', offered)
  }, [enabled])
  const remember = () => {
    try {
      localStorage.setItem(STAFF_INSTALL_SEEN, 'yes')
    } catch {
      /* This visit can still continue. */
    }
  }
  const finish = () => {
    dismissed.current = true
    remember()
    setKind(null)
    setPrompt(null)
  }
  const install = async () => {
    if (!prompt) return
    setError(null)
    setPending(true)
    try {
      await prompt.prompt()
      await prompt.userChoice
      finish()
    } catch {
      setError(new Error('Installation could not open. Please try again.'))
    } finally {
      setPending(false)
    }
  }
  return { kind, pending, finish, install, remember, error }
}
