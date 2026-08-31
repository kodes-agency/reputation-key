import { Link } from '@tanstack/react-router'
import { authClient } from '#/shared/auth/auth-client'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '#/components/ui/dropdown-menu'
import { ThemeToggle } from '#/components/layout/theme-toggle'
import { NotificationPanel } from '#/components/features/notification/notification-panel'
import type { NotificationServerFns } from '#/components/features/notification/types'

// ── Sub-components ───────────────────────────────────────────────────

function LogoLink() {
  return (
    <Button variant="outline" size="sm" className="rounded-full gap-2" asChild>
      <Link to="/">
        <span className="size-2 rounded-full bg-[linear-gradient(90deg,oklch(0.42_0.18_290),oklch(0.52_0.19_290))]" />
        Reputation Key
      </Link>
    </Button>
  )
}

function AuthActions({
  isLoggedIn,
  onSignOut,
}: Readonly<{
  isLoggedIn: boolean
  onSignOut: () => void
}>) {
  if (isLoggedIn) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Account
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/dashboard">Dashboard</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/properties">Properties</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link to="/login">Sign in</Link>
      </Button>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────

export function Header({
  onSignOut,
  notificationFns,
}: Readonly<{ onSignOut: () => void; notificationFns: NotificationServerFns }>) {
  const { data: session } = authClient.useSession()
  const isLoggedIn = !!session?.user
  // The bell used to mount without an organizationId, so it fell back to the
  // literal 'no-active-organization' sentinel and a signed-in user on a public
  // route read and wrote a DIFFERENT cache namespace than the app shell — two
  // unread counts for one user. Better Auth carries the active org on the
  // session, which is the same value _authenticated.tsx passes to AppTopBar.
  const organizationId = session?.session.activeOrganizationId ?? null
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center justify-between gap-3 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          <LogoLink />
          {isLoggedIn && (
            <div className="hidden sm:flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/dashboard"
                  activeOptions={{ exact: true }}
                  className="[&.active]:font-semibold"
                >
                  Dashboard
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/properties"
                  activeOptions={{ exact: true }}
                  className="[&.active]:font-semibold"
                >
                  Properties
                </Link>
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLoggedIn && organizationId !== null && (
            <NotificationPanel
              notificationFns={notificationFns}
              organizationId={organizationId}
            />
          )}
          <ThemeToggle />
          <AuthActions isLoggedIn={isLoggedIn} onSignOut={onSignOut} />
        </div>
      </nav>
    </header>
  )
}
