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
        {/* The one gradient in the product (DESIGN.md names it): the primary violet to a lighter mix of itself. */}
        <span className="size-2 rounded-full bg-[linear-gradient(90deg,var(--primary),color-mix(in_oklch,var(--primary)_82%,white))]" />
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
          {/* `Dashboard` pointed at the fleet page, which was the same list
              `Properties` already showed (redesign row 3). One entry now. */}
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
  // Public pages need session identity even when their route context has none.
  // The active Organization keeps this bell in the manager shell's cache scope.
  const organizationId = session?.session.activeOrganizationId ?? null
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/80 px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center justify-between gap-3 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          <LogoLink />
          {isLoggedIn && (
            <div className="hidden items-center gap-1 sm:flex">
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
          {session?.user && organizationId !== null && (
            <NotificationPanel
              scope={{ userId: session.user.id, organizationId }}
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
