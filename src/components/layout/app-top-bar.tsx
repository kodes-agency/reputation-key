import { useNavigate, useRouterState } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { SidebarTrigger } from '#/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useSignOut } from '#/components/hooks/use-sign-out'
import { NotificationPanel } from '#/contexts/feed/feed/ui/notification-panel'
import type { NotificationServerFns } from '#/contexts/feed/feed/ui/types'
import { useThemeMode } from '#/components/hooks/use-theme-mode'
import { ThemeModeMenuControl } from '#/components/layout/theme-mode-menu-control'
import { BetaFeedbackLauncher } from '#/contexts/identity/feedback/ui/beta-feedback-launcher'
import type {
  ListMyBetaFeedback,
  SubmitBetaFeedback,
} from '#/contexts/identity/feedback/ui/beta-feedback-form-context'
import { IconButton } from '#/components/ui/icon-button'
import { lazy, Suspense, useEffect, useId, useState } from 'react'
import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import {
  AccountButtonUpdatesDot,
  WhatsNewMenuItem,
} from '#/contexts/identity/updates/ui/whats-new-menu-item'

const ProductUpdatesIdle = lazy(
  () => import('#/contexts/identity/updates/ui/product-updates-idle'),
)

type Props = Readonly<{
  user: { id: string; name: string; email: string; image: string | null }
  organizationId: string
  notificationFns: NotificationServerFns
  submitBetaFeedback?: SubmitBetaFeedback
  /** Whether the shell draws a sidebar for this person; with none, the trigger is not drawn either. */
  hasSidebar?: boolean
  /** The page is a full-bleed surface: the phone bar is 44 px, as the Inbox grid is. */
  isFullBleed?: boolean
  listBetaFeedback?: ListMyBetaFeedback
  getProductUpdatesClient?: ProductUpdatesClientGetter
}>

export function AppTopBar({
  user,
  organizationId,
  notificationFns,
  submitBetaFeedback,
  hasSidebar = true,
  isFullBleed = false,
  listBetaFeedback,
  getProductUpdatesClient,
}: Props) {
  const navigate = useNavigate()
  const signOut = useSignOut({ onSignedOut: () => navigate({ to: '/login' }) })
  // Mounted as long as the shell is, so it keeps the document in step with the
  // stored theme (and the device in System mode); the menu's control mounts only while open.
  useThemeMode()
  // Names the "New updates" hint the account button points at when it shows its dot.
  const updatesHintId = useId()
  const initials = user.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    // Below md full-bleed surfaces (`isFullBleed`) use a 44 px bar like the phone
    // grid; other pages keep h-13 (52 px). Controls are 44 px on a phone, and
    // the two edge ghost buttons are pulled out by half of (44 - glyph) so the
    // glyph sits on the 16 px gutter: the trigger's 16 px glyph by 14 px, the
    // account button's 28 px circle by 8 px. The sidebar trigger shows
    // on every page from md up. The progress bar lies on the bar's lower edge, which
    // is why the header is positioned.
    <header
      data-full-bleed={isFullBleed ? 'true' : undefined}
      className="sticky top-0 z-20 flex h-(--app-top-bar-height) shrink-0 items-center gap-2 border-b bg-background px-4"
    >
      {hasSidebar && <SidebarTrigger className="-ml-1 max-md:-ml-3.5" />}

      <div className="flex-1" />

      {/* Notifications + User menu */}
      {submitBetaFeedback && (
        <BetaFeedbackLauncher
          submitFeedback={submitBetaFeedback}
          listFeedback={listBetaFeedback}
        />
      )}
      <NotificationPanel
        scope={{ userId: user.id, organizationId }}
        notificationFns={notificationFns}
        organizationId={organizationId}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="ghost"
            size="icon-sm"
            className="relative rounded-full max-md:-mr-2"
            label="Account menu"
            aria-describedby={getProductUpdatesClient ? updatesHintId : undefined}
          >
            {user.image ? (
              <img src={user.image} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </div>
            )}
            {getProductUpdatesClient && (
              <AccountButtonUpdatesDot
                getClient={getProductUpdatesClient}
                hintId={updatesHintId}
              />
            )}
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <ThemeModeMenuControl />
          {getProductUpdatesClient && (
            <WhatsNewMenuItem getClient={getProductUpdatesClient} />
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={signOut.isPending}
            onClick={() => void signOut().catch(() => undefined)}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {getProductUpdatesClient && (
        <Suspense fallback={null}>
          <ProductUpdatesIdle
            userId={user.id}
            organizationId={organizationId}
            getClient={getProductUpdatesClient}
          />
        </Suspense>
      )}
      <RouteProgress />
    </header>
  )
}

/** How long a navigation may take before the bar appears, so fast clicks stay calm. */
export const ROUTE_PROGRESS_DELAY_MS = 150

/** Calls `show` once `delayMs` has passed, unless the returned cancel runs first. */
export function showAfterDelay(show: () => void, delayMs: number): () => void {
  const timer = setTimeout(show, delayMs)
  return () => clearTimeout(timer)
}

/**
 * A 2 px bar on the top bar's lower edge while the router loads the next page.
 * Decoration, so hidden from assistive technology. It moves with `transform`
 * only; under reduced motion it is a still bar.
 */
function RouteProgress() {
  const isPending = useRouterState({ select: (s) => s.status === 'pending' })
  const [isShown, setIsShown] = useState(false)

  useEffect(() => {
    if (!isPending) return undefined
    const cancel = showAfterDelay(() => setIsShown(true), ROUTE_PROGRESS_DELAY_MS)
    return () => {
      cancel()
      setIsShown(false)
    }
  }, [isPending])

  if (!isPending || !isShown) return null

  return (
    <div
      aria-hidden="true"
      data-slot="route-progress"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-route-progress bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  )
}
